"""Agentic tool-calling loop for LabelChat (Elsa + vLLM + Gemini compatible).

Uses native function/tool calling across Elsa, vLLM, and Gemini, isolates
pre-tool-call preamble text from final answers, and builds deterministic
permission-gated Action Buttons from tool outputs.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Generator, List, Optional, Tuple

import httpx
from google import genai
from google.genai import types as genai_types
from openai import OpenAI

from dashboard.services.ai_handler import AIClientFactory, _record_usage
from dashboard.services.ai_preferences import (
    allowed_providers,
    connection_config,
    normalize_provider,
    provider_display_name,
    resolve_provider,
)
from dashboard.services.feature_gates import is_allowed
from search.mcp_tools import DEFAULT_REGISTRY, validate_and_filter_actions

logger = logging.getLogger(__name__)

MAX_TOOL_STEPS = 5
_PREAMBLE_BUFFER_CHARS = 120

SYSTEM_PROMPT = """You are Label Copilot, the FDA drug labeling assistant for askFDALabel.
You help FDA reviewers, clinicians, and researchers search drug labels, read specific SPL sections, trace label version history, inspect FAERS adverse event signals, and check DrugTox toxicity data.

Guidelines:
1. Ground all factual claims about drug labels, NDCs, application numbers, sections, version history, FAERS, or toxicity in tool outputs. Never fabricate label text or identifiers.
2. When a user asks about a drug, start by calling `search_labels`. ONLY call `query_drugtox` when the user explicitly asks about toxicity, DILI (liver injury), DICT (cardiotoxicity), DIRI (renal injury), or PGx (pharmacogenomics).
3. RLD / Reference Priority: When `search_labels` returns multiple records for a drug, prioritize the RLD or NDA/BLA reference product for clinical summaries, and briefly note how many other versions or generics were found.
4. Spell Correction: If `search_labels` returns 0 results for a drug name and you suspect a typo (e.g., "Ozempc" -> "Ozempic"), automatically call `search_labels` once more with the corrected spelling. Only briefly note a spelling fix if the user's current input actually had a typo.
5. Missing Full Text: If `read_label_sections` reports that full XML text is unavailable, clearly summarize the registration metadata you did find (brand/generic name, manufacturer, application number, NDC, revised date).
6. Citations & Readability: Always cite the specific **Section Title** and **Revised Date** when summarizing label content. Refer to labels by **Drug Name, Manufacturer, Application Number, and Revised Date** — do NOT expose raw `set_id` or `spl_id` UUIDs in your prose.
7. Progressive Disclosure (Default Concise, Detailed When Requested):
   - By default, optimize for low reading burden: lead with a 1-2 sentence direct takeaway, followed by 3-5 short bullet points covering only the highest-signal facts (~150-250 words). Do not dump entire SPL sections or exhaustive lists unprompted; the user can click Open SPL View or ask to expand.
   - When the user explicitly asks for depth or completeness (e.g., "in detail", "full", "all", "list every", "compare", "table", "详细", "完整", "全部") or the task inherently requires thorough analysis (such as multi-version diffs or full safety/dosing schedules), provide a complete, well-structured breakdown without artificially cutting off important details.
   - Respond in clean Markdown. Do NOT use `<annotation>` XML/HTML tags. Match the user's language (English or Chinese) naturally.
8. Never include meta-commentary such as "Correction of last reply", "Note on previous response", or narration of your internal tool calls/retries. Answer the user's current question directly."""


def _pick_provider_chain(user: Any, requested_provider: Optional[str]) -> List[str]:
    """Returns ordered list of providers to try, defaulting to Elsa when available."""
    from dashboard.services.deployment import is_rapid

    allowed = allowed_providers()
    if not allowed:
        return []

    if is_rapid():
        return ["elsa"] if "elsa" in allowed else []

    req = normalize_provider(requested_provider) if requested_provider else ""
    if req and req in allowed:
        primary = req
    elif "elsa" in allowed:
        primary = "elsa"
    else:
        primary, _ = resolve_provider(user)

    return [primary] + [p for p in allowed if p != primary]


def _trim_history(raw_history: List[Dict[str, Any]], max_msgs: int = 16, max_chars: int = 120000) -> List[Dict[str, str]]:
    """Keeps recent user/assistant turns within safe context bounds."""
    cleaned: List[Dict[str, str]] = []
    for m in (raw_history or [])[-max_msgs:]:
        role = m.get("role")
        content = str(m.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            cleaned.append({"role": role, "content": content})

    total = sum(len(m["content"]) for m in cleaned)
    while cleaned and total > max_chars:
        removed = cleaned.pop(0)
        total -= len(removed["content"])
    return cleaned


def _friendly_status(tool_name: str) -> str:
    return {
        "search_labels": "Searching drug labels...",
        "read_label_sections": "Reading labeling sections...",
        "query_drugtox": "Checking DrugTox safety data...",
        "get_label_history": "Checking label version history...",
        "compare_labels": "Comparing drug label sections...",
        "query_orange_book": "Checking FDA Orange Book...",
        "query_faers_signals": "Checking FAERS adverse event reports...",
    }.get(tool_name, "Looking up information...")


def _summarize_tool_result(tool_name: str, result: Dict[str, Any]) -> str:
    if result.get("error"):
        return "No matching data found"
    if tool_name == "search_labels":
        count = result.get("total_count", 0)
        return f"Found {count} matching label{'s' if count != 1 else ''}"
    if tool_name == "read_label_sections":
        if "sections_toc" in result:
            return f"Listed {len(result['sections_toc'])} label sections"
        titles = [s.get("title") for s in (result.get("sections") or []) if s.get("title")]
        if titles:
            preview = ", ".join(titles[:3])
            if len(titles) > 3:
                preview += f" (+{len(titles) - 3} more)"
            return f"Read {preview}"
        count = result.get("matched_count", 0)
        return f"Read {count} section{'s' if count != 1 else ''}"
    if tool_name == "query_drugtox":
        count = result.get("count", 0)
        return f"Found {count} DrugTox record{'s' if count != 1 else ''}"
    if tool_name == "get_label_history":
        count = result.get("total_versions", 0)
        return f"Found {count} version{'s' if count != 1 else ''}"
    if tool_name == "compare_labels":
        changed = result.get("changed_count", 0)
        return f"Compared labels ({changed} changed section{'s' if changed != 1 else ''})"
    if tool_name == "query_orange_book":
        count = result.get("total_matches", result.get("returned_count", 0))
        return f"Found {count} Orange Book record{'s' if count != 1 else ''}"
    if tool_name == "query_faers_signals":
        count = result.get("count", 0)
        return f"Loaded top {count} reported reaction{'s' if count != 1 else ''}"
    return "Completed"


def _extract_focus(
    tool_outputs: List[Tuple[str, Dict[str, Any]]],
    prior_focus: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Extracts the primary drug/label focus from tool outputs for multi-turn continuity."""
    focus = dict(prior_focus) if isinstance(prior_focus, dict) else None
    for tname, out in tool_outputs:
        if not isinstance(out, dict) or out.get("error"):
            continue
        if tname == "search_labels":
            results = out.get("results") or []
            if results:
                r0 = results[0]
                focus = {
                    "set_id": r0.get("set_id") or "",
                    "spl_id": r0.get("spl_id") or "",
                    "brand_name": r0.get("brand_name") or "",
                    "generic_name": r0.get("generic_name") or "",
                    "application_number": r0.get("application_number") or "",
                    "manufacturer": r0.get("manufacturer") or "",
                    "revised_date": r0.get("revised_date") or "",
                }
        elif tname == "get_label_history":
            versions = out.get("versions") or []
            if versions:
                v0 = versions[0]
                focus = {
                    "set_id": v0.get("set_id") or out.get("set_id") or "",
                    "spl_id": v0.get("spl_id") or "",
                    "brand_name": v0.get("product_names") or (focus or {}).get("brand_name") or "",
                    "generic_name": v0.get("generic_names") or (focus or {}).get("generic_name") or "",
                    "application_number": out.get("application_number") or (focus or {}).get("application_number") or "",
                    "manufacturer": (focus or {}).get("manufacturer") or "",
                    "revised_date": v0.get("revised_date") or "",
                }
    return focus if (focus and (focus.get("set_id") or focus.get("brand_name") or focus.get("generic_name"))) else None


def _build_follow_ups(
    tool_outputs: List[Tuple[str, Dict[str, Any]]],
    focus: Optional[Dict[str, Any]],
    user: Any,
) -> List[str]:
    """Generates 2-3 context-aware follow-up questions so users discover related capabilities."""
    ran = {tname for tname, out in tool_outputs if isinstance(out, dict) and not out.get("error")}
    drug_label = ""
    if focus:
        drug_label = (focus.get("brand_name") or focus.get("generic_name") or "").split(";")[0].strip()

    if not drug_label:
        return []

    suggestions: List[str] = []
    if "read_label_sections" not in ran:
        suggestions.append(f"Summarize the Warnings & Precautions and Indications for {drug_label}.")
    if "get_label_history" not in ran:
        suggestions.append(f"What changed in recent label revisions for {drug_label}?")
    if "query_faers_signals" not in ran and is_allowed(user, "tool_faers"):
        suggestions.append(f"What are the top FAERS adverse events reported for {drug_label}?")
    if "query_drugtox" not in ran:
        suggestions.append(f"Check the DrugTox liver toxicity (DILI) status for {drug_label}.")

    if not suggestions:
        suggestions.append(f"Show the full Table of Contents for {drug_label}.")

    return suggestions[:3]


def _derive_actions(
    tool_outputs: List[Tuple[str, Dict[str, Any]]],
    focus: Optional[Dict[str, Any]],
    user: Any,
) -> List[Dict[str, Any]]:
    """Deterministically builds permission-gated Action Buttons from tool outputs."""
    candidates: List[Dict[str, Any]] = []
    focus_sid = (focus or {}).get("set_id") or ""

    for tname, out in tool_outputs:
        if not isinstance(out, dict) or out.get("error"):
            continue
        if tname == "search_labels":
            results = out.get("results") or []
            total = out.get("total_count") or 0
            wq = out.get("wire_query")
            tdb = out.get("target_db") or "oracle"
            if len(results) == 1 and results[0].get("set_id"):
                r = results[0]
                candidates.append({
                    "type": "spl_view",
                    "label": f"Open SPL View: {r.get('brand_name') or r.get('generic_name') or 'Label'}",
                    "set_id": r["set_id"],
                    "spl_id": r.get("spl_id") or None,
                })
            elif len(results) >= 2:
                if results[0].get("set_id"):
                    r0 = results[0]
                    candidates.append({
                        "type": "spl_view",
                        "label": f"Open Reference SPL: {r0.get('brand_name') or r0.get('generic_name') or 'Label'}",
                        "set_id": r0["set_id"],
                        "spl_id": r0.get("spl_id") or None,
                    })
                top_sids = [r["set_id"] for r in results[:2] if r.get("set_id")]
                if len(top_sids) >= 2:
                    candidates.append({
                        "type": "labelcomp",
                        "label": f"Compare Top {len(top_sids)} Labels",
                        "set_ids": top_sids,
                    })
            if wq and total > 0:
                candidates.append({
                    "type": "labelquery",
                    "label": f"View All {total} Results in LabelQuery",
                    "wire_query": wq,
                    "target_db": tdb,
                })
        elif tname == "read_label_sections" and out.get("set_id"):
            candidates.append({
                "type": "spl_view",
                "label": "Open Full Label in SPL View",
                "set_id": out["set_id"],
            })
        elif tname == "query_drugtox" and (out.get("count") or 0) > 0:
            q = out.get("query") or ""
            recs = out.get("records") or []
            sid = (recs[0].get("set_id") if recs else None) or focus_sid
            if sid:
                candidates.append({
                    "type": "drugtox",
                    "label": "Open DILI Agent",
                    "set_id": sid,
                    "agent": "dili",
                    "query": q,
                })
        elif tname == "get_label_history" and (out.get("total_versions") or 0) > 0:
            sid = out.get("set_id") or focus_sid
            appr = out.get("application_number")
            candidates.append({
                "type": "label_history",
                "label": f"View Version History ({out.get('total_versions')} versions)",
                **({"set_id": sid} if sid else {}),
                **({"application_number": appr} if appr else {}),
            })
        elif tname == "query_faers_signals" and not out.get("error"):
            sid = out.get("set_id") or focus_sid
            if sid:
                candidates.append({
                    "type": "faers",
                    "label": "Open FAERS Analysis",
                    "set_id": sid,
                })

    return validate_and_filter_actions(candidates, user)[:5]



_UUID_EXTRACT_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def _seed_known_set_ids(messages: List[Dict[str, Any]], prior_focus: Optional[Dict[str, Any]]) -> set:
    known = set()
    if isinstance(prior_focus, dict) and prior_focus.get("set_id"):
        known.add(str(prior_focus["set_id"]).strip().lower())
    for m in messages:
        for uid in _UUID_EXTRACT_RE.findall(str(m.get("content") or "")):
            known.add(uid.lower())
    return known


def _execute_tool_guarded(
    tname: str,
    targs: Dict[str, Any],
    user: Any,
    seen_calls: set,
    known_set_ids: set,
) -> Dict[str, Any]:
    """Runs a tool with duplicate-call deduplication and set_id allowlist verification."""
    call_key = (tname, json.dumps(targs or {}, sort_keys=True, default=str))
    if call_key in seen_calls:
        return {"error": "Duplicate tool call with identical arguments. Use the previous result to answer the user."}
    seen_calls.add(call_key)

    if tname == "read_label_sections":
        sid = str((targs or {}).get("set_id") or "").strip().lower()
        if not sid or sid not in known_set_ids:
            return {"error": "Unverified set_id. Call search_labels first to obtain a valid set_id."}

    result = DEFAULT_REGISTRY.call(tname, targs, user)
    if isinstance(result, dict):
        for r in result.get("results") or []:
            if isinstance(r, dict) and r.get("set_id"):
                known_set_ids.add(str(r["set_id"]).strip().lower())
        for v in result.get("versions") or []:
            if isinstance(v, dict) and v.get("set_id"):
                known_set_ids.add(str(v["set_id"]).strip().lower())
        if result.get("set_id"):
            known_set_ids.add(str(result["set_id"]).strip().lower())
    return result


def _extract_json_tool_call(text: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Fallback parser when an OpenAI-compatible gateway rejects native tools."""
    m = re.search(r"```json\s*(\{.*?\})\s*```", text or "", re.DOTALL)
    raw = m.group(1) if m else None
    if not raw:
        stripped = (text or "").strip()
        if stripped.startswith("{") and stripped.endswith("}") and '"tool"' in stripped:
            raw = stripped
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict) and isinstance(obj.get("tool"), str):
            return obj["tool"], obj.get("arguments") or {}
    except Exception:
        return None
    return None


def _build_provider_client(provider: str, user: Any):
    """Builds or fetches a cached client + model name for the requested provider."""
    cfg = connection_config(provider, user)
    if provider == "elsa":
        client, model = AIClientFactory._get_elsa_client({"elsa": cfg})
        return "elsa", client, model
    if provider in ("local-1", "local-2"):
        if not cfg.get("url") or not cfg.get("model_name"):
            raise ValueError(f"{provider} connection URL and model are not configured.")
        cache_key = (provider, cfg.get("api_key", ""), cfg["url"])
        if cache_key not in AIClientFactory._clients:
            AIClientFactory._clients[cache_key] = OpenAI(
                api_key=cfg.get("api_key") or "not-required",
                base_url=cfg["url"],
                timeout=httpx.Timeout(600.0, connect=30.0),
            )
        return "llama", AIClientFactory._clients[cache_key], cfg["model_name"]
    cache_key = ("gemini", cfg.get("api_key", ""))
    if cache_key not in AIClientFactory._clients:
        AIClientFactory._clients[cache_key] = genai.Client(api_key=cfg.get("api_key", ""))
    return "gemini", AIClientFactory._clients[cache_key], cfg["model_name"]


def _run_gemini_loop(
    client: Any,
    model: str,
    user: Any,
    messages: List[Dict[str, Any]],
    openai_tools: List[Dict[str, Any]],
    prior_focus: Optional[Dict[str, Any]],
) -> Generator[Dict[str, Any], None, None]:
    """Runs native Gemini FunctionDeclaration / FunctionResponse loop with live streaming."""
    fn_decls = [
        genai_types.FunctionDeclaration(
            name=t["function"]["name"],
            description=t["function"]["description"],
            parameters_json_schema=t["function"]["parameters"],
        )
        for t in openai_tools
    ]
    gemini_tools = [genai_types.Tool(function_declarations=fn_decls)] if fn_decls else None
    sys_prompt = messages[0]["content"]

    contents: List[genai_types.Content] = []
    for m in messages[1:]:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append(
            genai_types.Content(
                role=role,
                parts=[genai_types.Part.from_text(text=str(m.get("content") or ""))],
            )
        )

    tool_outputs: List[Tuple[str, Dict[str, Any]]] = []
    seen_calls: set = set()
    known_set_ids = _seed_known_set_ids(messages, prior_focus)

    for step in range(MAX_TOOL_STEPS):
        yield {"type": "status", "text": "Thinking..." if step == 0 else "Synthesizing results..."}

        stream = client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=genai_types.GenerateContentConfig(
                system_instruction=sys_prompt,
                tools=gemini_tools,
                temperature=0.0,
                max_output_tokens=2048,
            ),
        )

        text_buf = ""
        flushed = False
        collected_fcs: List[Any] = []
        raw_model_parts: List[genai_types.Part] = []
        last_usage = None

        for chunk in stream:
            if getattr(chunk, "usage_metadata", None):
                last_usage = chunk.usage_metadata

            cands = getattr(chunk, "candidates", None) or []
            if cands and getattr(cands[0], "content", None) and getattr(cands[0].content, "parts", None):
                for part in cands[0].content.parts:
                    if getattr(part, "function_call", None) or getattr(part, "thought_signature", None) or getattr(part, "thought", False):
                        raw_model_parts.append(part)

            chunk_fcs = getattr(chunk, "function_calls", None) or []
            if chunk_fcs:
                collected_fcs.extend(chunk_fcs)

            delta = getattr(chunk, "text", None) or ""
            if delta and not collected_fcs:
                text_buf += delta
                if flushed:
                    yield {"type": "token", "text": delta}
                elif len(text_buf) >= _PREAMBLE_BUFFER_CHARS:
                    flushed = True
                    yield {"type": "token", "text": text_buf}
                    text_buf = ""

        if last_usage:
            _record_usage(
                user,
                model,
                getattr(last_usage, "prompt_token_count", 0) or 0,
                getattr(last_usage, "candidates_token_count", 0) or 0,
            )

        if collected_fcs:
            # Preserve raw model parts (including thought_signature) for Gemini 2.5/3.x
            if not raw_model_parts:
                raw_model_parts = [
                    genai_types.Part.from_function_call(
                        name=fc.name,
                        args=dict(fc.args) if fc.args else {},
                    )
                    for fc in collected_fcs
                ]
            contents.append(genai_types.Content(role="model", parts=raw_model_parts))

            resp_parts: List[genai_types.Part] = []
            for fc in collected_fcs:
                tname = fc.name
                targs = dict(fc.args) if fc.args else {}
                yield {"type": "status", "text": _friendly_status(tname), "tool": tname}
                yield {"type": "tool_call", "tool": tname, "arguments": targs}
                result = _execute_tool_guarded(tname, targs, user, seen_calls, known_set_ids)
                tool_outputs.append((tname, result))
                yield {"type": "tool_result", "tool": tname, "summary": _summarize_tool_result(tname, result)}
                resp_parts.append(
                    genai_types.Part.from_function_response(
                        name=tname,
                        response={"result": result},
                    )
                )

            contents.append(genai_types.Content(role="user", parts=resp_parts))
            continue

        if text_buf:
            yield {"type": "token", "text": text_buf}

        focus = _extract_focus(tool_outputs, prior_focus)
        if focus:
            yield {"type": "focus", "focus": focus}

        final_actions = _derive_actions(tool_outputs, focus, user)
        if final_actions:
            yield {"type": "actions", "actions": final_actions}

        follow_ups = _build_follow_ups(tool_outputs, focus, user)
        if follow_ups:
            yield {"type": "follow_ups", "items": follow_ups}

        yield {"type": "done", "provider": "gemini", "model": model, "grounded": len(tool_outputs) > 0}
        return

    yield {"type": "token", "text": "I gathered the available information; please refine your question if you need more details."}
    focus = _extract_focus(tool_outputs, prior_focus)
    if focus:
        yield {"type": "focus", "focus": focus}
    final_actions = _derive_actions(tool_outputs, focus, user)
    if final_actions:
        yield {"type": "actions", "actions": final_actions}
    yield {"type": "done", "provider": "gemini", "model": model, "grounded": len(tool_outputs) > 0}


def _is_compat_fallback_error(exc: Exception) -> bool:
    """Returns True when an OpenAI-compatible gateway rejects tools or streaming."""
    status = getattr(exc, "status_code", None)
    if status in (400, 422, 500, 502):
        return True
    err_l = str(exc).lower()
    return any(
        k in err_l
        for k in ("tool", "function", "unsupported", "stream", "internal server error", "400", "422", "500", "502")
    )


def _run_with_provider(
    provider: str,
    user: Any,
    messages: List[Dict[str, Any]],
    openai_tools: List[Dict[str, Any]],
    prior_focus: Optional[Dict[str, Any]],
) -> Generator[Dict[str, Any], None, None]:
    """Runs the multi-step tool loop on Elsa / vLLM (with native streaming) or Gemini."""
    kind, client, model = _build_provider_client(provider, user)

    if kind == "gemini":
        yield from _run_gemini_loop(client, model, user, messages, openai_tools, prior_focus)
        return

    tool_outputs: List[Tuple[str, Dict[str, Any]]] = []
    seen_calls: set = set()
    known_set_ids = _seed_known_set_ids(messages, prior_focus)
    working_msgs = list(messages)
    use_native_tools = bool(openai_tools)
    use_streaming = True
    json_tools_injected = False

    def _inject_json_tools_prompt() -> None:
        nonlocal json_tools_injected
        if json_tools_injected or not openai_tools:
            return
        tool_desc = json.dumps(
            [
                {
                    "name": t["function"]["name"],
                    "description": t["function"]["description"],
                    "parameters": t["function"]["parameters"],
                }
                for t in openai_tools
            ],
            ensure_ascii=False,
        )
        working_msgs[0] = {
            "role": "system",
            "content": messages[0]["content"]
            + f'\n\nAvailable tools (respond with ```json {{"tool": "name", "arguments": {{...}}}}``` to call one):\n{tool_desc}',
        }
        json_tools_injected = True

    for step in range(MAX_TOOL_STEPS):
        yield {
            "type": "status",
            "text": "Thinking..." if step == 0 else "Synthesizing results...",
        }

        full_content = ""
        preamble_buf = ""
        flushed = False
        tc_acc: Dict[int, Dict[str, str]] = {}

        while True:
            req_kwargs: Dict[str, Any] = {
                "model": model,
                "messages": working_msgs,
                "temperature": 0.0,
                "max_tokens": 2048,
                "stream": use_streaming,
            }
            if use_native_tools:
                req_kwargs["tools"] = openai_tools
                req_kwargs["tool_choice"] = "auto"

            full_content = ""
            preamble_buf = ""
            flushed = False
            tc_acc = {}

            try:
                if use_streaming:
                    stream = client.chat.completions.create(**req_kwargs)
                    for chunk in stream:
                        if not getattr(chunk, "choices", None):
                            continue
                        delta = chunk.choices[0].delta

                        d_tcs = getattr(delta, "tool_calls", None)
                        if d_tcs:
                            for tc in d_tcs:
                                idx = getattr(tc, "index", 0) or 0
                                entry = tc_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                                if getattr(tc, "id", None):
                                    entry["id"] = tc.id
                                fn = getattr(tc, "function", None)
                                if fn:
                                    if getattr(fn, "name", None):
                                        entry["name"] += fn.name
                                    if getattr(fn, "arguments", None):
                                        entry["arguments"] += fn.arguments

                        d_content = getattr(delta, "content", None)
                        if d_content:
                            full_content += d_content
                            if use_native_tools and not tc_acc:
                                preamble_buf += d_content
                                if flushed:
                                    yield {"type": "token", "text": d_content}
                                elif len(preamble_buf) >= _PREAMBLE_BUFFER_CHARS:
                                    flushed = True
                                    yield {"type": "token", "text": preamble_buf}
                                    preamble_buf = ""
                else:
                    resp = client.chat.completions.create(**req_kwargs)
                    if getattr(resp, "choices", None):
                        msg = resp.choices[0].message
                        full_content = getattr(msg, "content", None) or ""
                        m_tcs = getattr(msg, "tool_calls", None)
                        if m_tcs:
                            for idx, tc in enumerate(m_tcs):
                                fn = getattr(tc, "function", None)
                                tc_acc[idx] = {
                                    "id": getattr(tc, "id", None) or "",
                                    "name": getattr(fn, "name", "") if fn else "",
                                    "arguments": getattr(fn, "arguments", "") if fn else "",
                                }
                break
            except Exception as exc:
                if not flushed and _is_compat_fallback_error(exc):
                    if use_native_tools:
                        logger.warning(
                            "Provider %s rejected native tools (%s); retrying with JSON tool prompt.",
                            provider,
                            exc,
                        )
                        use_native_tools = False
                        _inject_json_tools_prompt()
                        continue
                    if use_streaming:
                        logger.warning(
                            "Provider %s failed in streaming mode (%s); retrying with stream=False.",
                            provider,
                            exc,
                        )
                        use_streaming = False
                        continue
                raise

        est_in = sum(len(str(m.get("content") or "")) for m in working_msgs) // 4
        _record_usage(user, model, est_in, len(full_content) // 4)

        if tc_acc:
            # Discard any short pre-tool preamble in preamble_buf
            ordered_tcs = [tc_acc[i] for i in sorted(tc_acc.keys())]
            working_msgs.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": tc["id"] or f"call_{i}",
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for i, tc in enumerate(ordered_tcs)
                ],
            })

            for i, tc in enumerate(ordered_tcs):
                tname = tc["name"]
                try:
                    targs = json.loads(tc["arguments"] or "{}")
                except Exception:
                    targs = {}

                yield {"type": "status", "text": _friendly_status(tname), "tool": tname}
                yield {"type": "tool_call", "tool": tname, "arguments": targs}
                result = _execute_tool_guarded(tname, targs, user, seen_calls, known_set_ids)
                tool_outputs.append((tname, result))
                yield {"type": "tool_result", "tool": tname, "summary": _summarize_tool_result(tname, result)}

                working_msgs.append({
                    "role": "tool",
                    "tool_call_id": tc["id"] or f"call_{i}",
                    "content": json.dumps(result, ensure_ascii=False, default=str)[:30000],
                })
            continue

        if not use_native_tools:
            parsed = _extract_json_tool_call(full_content)
            if parsed:
                tname, targs = parsed
                yield {"type": "status", "text": _friendly_status(tname), "tool": tname}
                yield {"type": "tool_call", "tool": tname, "arguments": targs}
                result = _execute_tool_guarded(tname, targs, user, seen_calls, known_set_ids)
                tool_outputs.append((tname, result))
                yield {"type": "tool_result", "tool": tname, "summary": _summarize_tool_result(tname, result)}
                working_msgs.append({"role": "assistant", "content": full_content})
                working_msgs.append({
                    "role": "user",
                    "content": f"Tool `{tname}` result:\n```json\n{json.dumps(result, ensure_ascii=False, default=str)[:24000]}\n```\nNow continue answering the user.",
                })
                continue

        if use_native_tools:
            if preamble_buf and not flushed:
                yield {"type": "token", "text": preamble_buf}
        elif full_content:
            yield {"type": "token", "text": full_content}

        focus = _extract_focus(tool_outputs, prior_focus)
        if focus:
            yield {"type": "focus", "focus": focus}

        final_actions = _derive_actions(tool_outputs, focus, user)
        if final_actions:
            yield {"type": "actions", "actions": final_actions}

        follow_ups = _build_follow_ups(tool_outputs, focus, user)
        if follow_ups:
            yield {"type": "follow_ups", "items": follow_ups}

        yield {"type": "done", "provider": provider, "model": model, "grounded": len(tool_outputs) > 0}
        return

    yield {"type": "status", "text": "Finalizing answer..."}
    if use_streaming:
        final_yielded = False
        try:
            stream = client.chat.completions.create(
                model=model,
                messages=working_msgs,
                temperature=0.0,
                max_tokens=2048,
                stream=True,
            )
            for chunk in stream:
                if getattr(chunk, "choices", None) and getattr(chunk.choices[0].delta, "content", None):
                    final_yielded = True
                    yield {"type": "token", "text": chunk.choices[0].delta.content}
        except Exception as exc:
            if not final_yielded and _is_compat_fallback_error(exc):
                use_streaming = False
            else:
                raise
    if not use_streaming:
        resp = client.chat.completions.create(
            model=model,
            messages=working_msgs,
            temperature=0.0,
            max_tokens=2048,
            stream=False,
        )
        if getattr(resp, "choices", None):
            text = getattr(resp.choices[0].message, "content", None) or ""
            if text:
                yield {"type": "token", "text": text}

    focus = _extract_focus(tool_outputs, prior_focus)
    if focus:
        yield {"type": "focus", "focus": focus}
    final_actions = _derive_actions(tool_outputs, focus, user)
    if final_actions:
        yield {"type": "actions", "actions": final_actions}
    follow_ups = _build_follow_ups(tool_outputs, focus, user)
    if follow_ups:
        yield {"type": "follow_ups", "items": follow_ups}
    yield {"type": "done", "provider": provider, "model": model, "grounded": len(tool_outputs) > 0}


def run_agent_stream(
    user: Any,
    query: str,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    provider_override: Optional[str] = None,
    active_focus: Optional[Dict[str, Any]] = None,
) -> Generator[Dict[str, Any], None, None]:
    """Entry point for LabelChat SSE streaming with provider fallback."""
    chain = _pick_provider_chain(user, provider_override)
    if not chain:
        yield {"type": "error", "error": "No AI models are enabled for this deployment."}
        return

    sys_content = SYSTEM_PROMPT
    if isinstance(active_focus, dict) and (active_focus.get("set_id") or active_focus.get("brand_name")):
        focus_label = active_focus.get("brand_name") or active_focus.get("generic_name") or "Selected Label"
        sys_content += (
            f"\n\n[Pronoun Fallback Context: {focus_label} | "
            f"Application: {active_focus.get('application_number') or 'N/A'} | "
            f"Manufacturer: {active_focus.get('manufacturer') or 'N/A'} | "
            f"Revised: {active_focus.get('revised_date') or 'N/A'} | "
            f"set_id: {active_focus.get('set_id') or ''}. "
            "Use this ONLY when the user uses a pronoun ('it', 'this drug', 'its warnings') without naming a drug. "
            "If the user names a different drug, ignore this context and search the newly named drug.]"
        )

    history_msgs = _trim_history(chat_history or [])
    messages: List[Dict[str, Any]] = [{"role": "system", "content": sys_content}]
    messages.extend(history_msgs)
    messages.append({"role": "user", "content": query})

    openai_tools = DEFAULT_REGISTRY.openai_tools(user)

    last_err: Optional[Exception] = None
    for idx, provider in enumerate(chain):
        try:
            yielded_token = False
            for evt in _run_with_provider(provider, user, messages, openai_tools, active_focus):
                if evt.get("type") == "token":
                    yielded_token = True
                yield evt
            return
        except Exception as exc:
            last_err = exc
            logger.warning("LabelChat provider %s failed: %s", provider, exc)
            if yielded_token or idx == len(chain) - 1:
                break
            yield {
                "type": "status",
                "text": f"{provider_display_name(provider)} unavailable, switching to {provider_display_name(chain[idx + 1])}...",
            }

    yield {"type": "error", "error": f"AI request failed: {last_err}"}
