from google import genai
from google.genai import types
from openai import OpenAI
import requests
from urllib.parse import quote_plus
import json
import logging
import os
import time
import urllib3
from dashboard.prompts import SEARCH_HELPER_PROMPT
from dashboard.services.fdalabel_db import FDALabelDBService
from database import db
from database.models import TokenUsage
from dashboard.services.env_service import EnvService

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

def _record_usage(user, model_name, input_tokens, output_tokens):
    if not user or not hasattr(user, 'is_authenticated') or not user.is_authenticated:
        return
    try:
        usage = TokenUsage(
            user_id=user.id,
            model_name=model_name,
            input_tokens=input_tokens or 0,
            output_tokens=output_tokens or 0,
            total_tokens=(input_tokens or 0) + (output_tokens or 0)
        )
        db.session.add(usage)
        db.session.commit()
    except Exception as e:
        logger.error(f"Failed to record token usage: {e}")
        db.session.rollback()

def _check_is_internal():
    """
    Returns True when running in internal FDA / CDER-CBER environment
    (e.g. ELSA_API_NAME is configured or Oracle is reachable).
    """
    try:
        from flask import current_app
        if current_app:
            elsa_api = (os.environ.get('ELSA_API_NAME') or current_app.config.get('ELSA_API_NAME') or '').strip()
            if elsa_api:
                return True
    except Exception:
        pass
    elsa_api = (os.environ.get('ELSA_API_NAME') or '').strip()
    return bool(elsa_api)

class AIClientFactory:
    _clients = {} # Cache for clients: (provider, api_key) -> client

    @staticmethod
    def get_client(user=None):
        """
        Returns the appropriate client and model based on user preferences.
        Caches clients to avoid 'client closed' errors during streaming.
        In internal environment (CDER-CBER available), Gemini is strictly disabled.
        """
        is_internal = _check_is_internal()

        # Read allowed providers and global default
        allowed_raw = os.getenv("ALLOWED_AI_PROVIDERS", "gemini,elsa,llama,vllm,ollama,customized")
        allowed_providers = [p.strip().lower() for p in allowed_raw.split(',') if p.strip()]
        if is_internal:
            allowed_providers = [p for p in allowed_providers if p != 'gemini']

        if is_internal:
            default_provider = "elsa" if "elsa" in allowed_providers else (allowed_providers[0] if allowed_providers else "elsa")
        else:
            default_provider = os.getenv("DEFAULT_AI_MODEL", "elsa" if "elsa" in allowed_providers else (allowed_providers[0] if allowed_providers else "gemini"))

        provider = EnvService.get_setting("ai_model_provider") or default_provider
        if is_internal and provider == 'gemini':
            provider = default_provider
        if provider not in allowed_providers:
            provider = default_provider
        use_llama = False
        
        # User override logic: custom AI settings and provider overrides are restricted to admins
        is_admin = bool(user and user.is_authenticated and getattr(user, 'is_admin', False))
        if is_admin and user.ai_provider:
            if user.ai_provider in allowed_providers and (not is_internal or user.ai_provider != 'gemini'):
                provider = user.ai_provider
                
        # Load user settings if available (admins only)
        user_settings = {}
        if is_admin and user.ai_settings:
            try:
                import json
                user_settings = json.loads(user.ai_settings)
            except Exception as e:
                logger.error(f"Failed to parse user.ai_settings: {e}")

        if provider == "llama" or provider == "vllm" or provider == "ollama" or provider == "customized":
             use_llama = True
             
        if use_llama:
             if provider == "customized":
                 api_key = EnvService.get_setting("custom_llm_key") or ""
                 base_url = EnvService.get_setting("custom_llm_url") or ""
                 model = os.getenv("LLM_MODEL", "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8")
             elif provider == "vllm" or provider == "llama":
                 # Check user customized options: url, api_key, model_name
                 vllm_opts = user_settings.get("vllm", {}) if provider == "vllm" else user_settings.get("llama", {})
                 api_key = vllm_opts.get("api_key") or (user.openai_api_key if user else None) or os.getenv("LLM_KEY", "")
                 base_url = vllm_opts.get("url") or (user.openai_base_url if user else None) or os.getenv("LLM_URL", "")
                 model = vllm_opts.get("model_name") or (user.openai_model_name if user else None) or os.getenv("LLM_MODEL", "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8")
             elif provider == "ollama":
                 ollama_opts = user_settings.get("ollama", {})
                 base_url = ollama_opts.get("url") or "http://localhost:11434/v1"
                 model = ollama_opts.get("model_name") or "llama3"
                 api_key = "ollama"
             else:
                 api_key = os.getenv("LLM_KEY", "")
                 base_url = os.getenv("LLM_URL", "")
                 model = os.getenv("LLM_MODEL", "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8")

             # Force v1 suffix for Ollama if url doesn't end with /v1
             if provider == "ollama" and base_url and not base_url.endswith("/v1") and not base_url.endswith("/v1/"):
                 base_url = base_url.rstrip("/") + "/v1"

             cache_key = (provider, api_key, base_url)
             if cache_key not in AIClientFactory._clients:
                 AIClientFactory._clients[cache_key] = OpenAI(api_key=api_key, base_url=base_url, timeout=30.0)
             return "llama", AIClientFactory._clients[cache_key], model

        if provider == 'rapid':
             api_key = os.getenv("RAPID_KEY", "")
             base_url = os.getenv("RAPID_URL", "")
             model = os.getenv("RAPID_MODEL", "")

             rapid_config = {
                 'api_key': api_key,
                 'base_url': base_url
             }
             return "rapid", rapid_config, model

        if provider == 'elsa' or is_internal or 'gemini' not in allowed_providers:
            elsa_opts = user_settings.get("elsa", {})
            elsa_config = {
                'username': elsa_opts.get("user") or os.getenv("ELSA_API_NAME"),
                'password': elsa_opts.get("key") or os.getenv("ELSA_API_KEY"),
                'base_url': elsa_opts.get("url") or os.getenv("ELSA_API_URL"),
                'model_engine_id': elsa_opts.get("model_id") or os.getenv("ELSA_MODEL_ID"),
                'model_name': elsa_opts.get("model_name") or os.getenv("ELSA_MODEL_NAME") or "CLAUDE_4_SONNET"
            }
            return "elsa", elsa_config, elsa_config['model_name']

        # Default: Gemini (external/public environments only)
        gemini_key = user_settings.get("gemini", {}).get("api_key") or (user.custom_gemini_key if user else None) or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if (provider, gemini_key) not in AIClientFactory._clients:
            AIClientFactory._clients[(provider, gemini_key)] = genai.Client(api_key=gemini_key)
        return "gemini", AIClientFactory._clients[(provider, gemini_key)], os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")



def call_llm(user, system_prompt, user_message, history=None, model_override=None, **kwargs):
    provider, client, model = AIClientFactory.get_client(user)
    if model_override:
        model = model_override

    temperature = kwargs.get("temperature", 0.1)
    max_tokens = kwargs.get("max_tokens", 20000)
    top_p = kwargs.get("top_p", 0.95)

    if provider == "llama":
        messages = []
        supports_system = kwargs.get("supports_system", True)
        if system_prompt:
            if supports_system: messages.append({"role": "system", "content": system_prompt})
            else: user_message = f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\nUSER MESSAGE:\n{user_message}"
        if history:
            for turn in history: messages.append({"role": turn.get('role', 'user'), "content": turn.get('content', '')})
        messages.append({"role": "user", "content": user_message})

        try:
            vllm_extras = {"repetition_penalty": kwargs.get("repetition_penalty", 1.1), "top_k": kwargs.get("top_k", 50)}
            response = client.chat.completions.create(
                model=model, messages=messages, temperature=temperature, 
                max_tokens=max_tokens, top_p=top_p, extra_body=vllm_extras, 
                stream=kwargs.get("stream", False)
            )
            if kwargs.get("stream", False): return response
            
            if hasattr(response, 'usage') and response.usage:
                _record_usage(user, model, response.usage.prompt_tokens, response.usage.completion_tokens)
            else:
                # Fallback to estimate if usage isn't provided
                est_input = sum(len(m.get("content", "")) for m in messages) // 4
                est_output = len(response.choices[0].message.content) // 4
                _record_usage(user, model, est_input, est_output)
                
            return response.choices[0].message.content
        except Exception as e:
            allowed_raw = os.getenv("ALLOWED_AI_PROVIDERS", "gemini,elsa,llama,vllm,ollama,customized")
            allowed_providers = [p.strip().lower() for p in allowed_raw.split(',') if p.strip()]
            
            # 1. Try Elsa fallback if allowed
            if "elsa" in allowed_providers and provider != "elsa":
                logger.warning(f"LLM error ({provider}): {e}. Attempting fallback to Elsa.")
                try:
                    _, elsa_cfg, elsa_mod = AIClientFactory.get_client(user)
                    if not isinstance(elsa_cfg, dict) or 'model_engine_id' not in elsa_cfg:
                        # Direct Elsa config fetch
                        elsa_cfg = {
                            'username': os.getenv("ELSA_API_NAME"),
                            'password': os.getenv("ELSA_API_KEY"),
                            'base_url': os.getenv("ELSA_API_URL"),
                            'model_engine_id': os.getenv("ELSA_MODEL_ID"),
                            'model_name': os.getenv("ELSA_MODEL_NAME") or "CLAUDE_4_SONNET"
                        }
                    full_prompt = f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\n" if system_prompt else ""
                    if history:
                        full_prompt += "CONVERSATION HISTORY:\n"
                        for turn in history: full_prompt += f"{turn.get('role', 'user').upper()}: {turn.get('content', '')}\n"
                        full_prompt += "\n"
                    full_prompt += f"USER: {user_message}"
                    cmd = f'''LLM(engine = "{elsa_cfg['model_engine_id']}", command = "<encode>{full_prompt}</encode>", paramValues = [{{"max_completion_tokens": {max_tokens}, "temperature": {temperature}}}])'''
                    res = requests.post(elsa_cfg['base_url'], headers={"Content-Type": "application/x-www-form-urlencoded"}, data=f'expression={quote_plus(cmd)}', auth=(elsa_cfg['username'], elsa_cfg['password']), verify=False, timeout=(120, 600))
                    if res.status_code == 200:
                        ret = json.loads(res.text).get("pixelReturn", [{}])[0].get("output", "")
                        if isinstance(ret, dict): ret = ret.get("response", "")
                        if ret:
                            _record_usage(user, elsa_cfg.get('model_name', 'ELSA'), len(full_prompt) // 4, len(ret) // 4)
                            return ret
                except Exception as elsa_err:
                    logger.error(f"Elsa fallback failed: {elsa_err}")

            # 2. Try Gemini fallback only if explicitly allowed and not in internal env
            if "gemini" in allowed_providers and not _check_is_internal():
                logger.warning(f"LLM error ({provider}): {e}. Attempting fallback to Gemini.")
                try:
                    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
                    if ("gemini", gemini_key) not in AIClientFactory._clients:
                        AIClientFactory._clients[("gemini", gemini_key)] = genai.Client(api_key=gemini_key)
                    
                    fallback_client = AIClientFactory._clients[("gemini", gemini_key)]
                    fallback_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
                    
                    config = types.GenerateContentConfig(
                        temperature=temperature, top_p=top_p, max_output_tokens=max_tokens,
                        system_instruction=system_prompt if system_prompt else None
                    )
                    contents = []
                    if history:
                        for turn in history:
                            role = "model" if turn.get('role') in ['assistant', 'ai'] else "user"
                            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=turn.get('content', ''))]))
                    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_message)]))
                    
                    resp = fallback_client.models.generate_content(model=fallback_model, contents=contents, config=config)
                    if hasattr(resp, 'usage_metadata') and resp.usage_metadata:
                        _record_usage(user, fallback_model, getattr(resp.usage_metadata, 'prompt_token_count', 0), getattr(resp.usage_metadata, 'candidates_token_count', 0))
                    return resp.text
                except Exception as fallback_err:
                    logger.error(f"Fallback to Gemini also failed: {fallback_err}")
            raise e

    elif provider == "rapid":
        messages = []
        if history:
            for turn in history: messages.append({"role": turn.get('role', 'user'), "content": turn.get('content', '')})
        messages.append({"role": "user", "content": user_message})

        payload = {
            "model": model,
            "messages": messages,
            "system_prompt": system_prompt if system_prompt else "",
            "max_completion_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": kwargs.get("top_k", 50)
        }
        
        try:
            url = f"{client['base_url'].rstrip('/')}/generate"
            headers = {"X-API-Key": client['api_key'], "Content-Type": "application/json"}
            
            response = requests.post(url, headers=headers, json=payload, timeout=(120, 600), verify=False)
            response.raise_for_status()
            
            result = response.json()
            response_text = result.get("message", "")
            
            _record_usage(user, model, result.get("prompt_tokens", 0), result.get("completion_tokens", 0))
            return response_text
            
        except Exception as e:
            if not _check_is_internal() and "gemini" in os.getenv("ALLOWED_AI_PROVIDERS", ""):
                logger.error(f"LLM error (RAPID): {e}. Attempting fallback to Gemini.")
                try:
                    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
                    if ("gemini", gemini_key) not in AIClientFactory._clients:
                        AIClientFactory._clients[("gemini", gemini_key)] = genai.Client(api_key=gemini_key)
                    
                    fallback_client = AIClientFactory._clients[("gemini", gemini_key)]
                    fallback_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
                    
                    config = types.GenerateContentConfig(
                        temperature=temperature, top_p=top_p, max_output_tokens=max_tokens,
                        system_instruction=system_prompt if system_prompt else None
                    )
                    contents = []
                    if history:
                        for turn in history:
                            role = "model" if turn.get('role') in ['assistant', 'ai'] else "user"
                            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=turn.get('content', ''))]))
                    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_message)]))
                    
                    resp = fallback_client.models.generate_content(model=fallback_model, contents=contents, config=config)
                    if hasattr(resp, 'usage_metadata') and resp.usage_metadata:
                        _record_usage(user, fallback_model, getattr(resp.usage_metadata, 'prompt_token_count', 0), getattr(resp.usage_metadata, 'candidates_token_count', 0))
                    return resp.text
                except Exception as fallback_err:
                    logger.error(f"Fallback to Gemini also failed: {fallback_err}")
            raise e

    elif provider == "elsa":
        full_prompt = f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\n" if system_prompt else ""
        if history:
            full_prompt += "CONVERSATION HISTORY:\n"
            for turn in history: full_prompt += f"{turn.get('role', 'user').upper()}: {turn.get('content', '')}\n"
            full_prompt += "\n"
        full_prompt += f"USER: {user_message}"

        try:
            command = f'''LLM(engine = "{client['model_engine_id']}", command = "<encode>{full_prompt}</encode>", paramValues = [{{"max_completion_tokens": {max_tokens}, "temperature": {temperature}}}])'''
            response = requests.post(client['base_url'], 
                                     headers={"Content-Type": "application/x-www-form-urlencoded"}, 
                                     data=f'expression={quote_plus(command)}', 
                                     auth=(client['username'], client['password']), 
                                     verify=False,
                                     timeout=(120, 600))
            if response.status_code != 200:
                raise Exception(f"Elsa API error: status={response.status_code}, body={response.text[:500]}")

            result = json.loads(response.text)

            pixel_return = result.get("pixelReturn")
            if not isinstance(pixel_return, list) or not pixel_return:
                raise Exception(f"Invalid Elsa response: {result}")

            pixel = pixel_return[0]
            if not isinstance(pixel, dict):
                raise Exception(f"Invalid Elsa pixelReturn item: {pixel!r}")

            operation_type = pixel.get("operationType", [])
            output = pixel.get("output")

            if isinstance(operation_type, list) and "ERROR" in operation_type:
                raise Exception(f"Elsa error: {output}")

            display_model_name = client.get('model_name') or os.getenv("ELSA_MODEL_NAME") or "CLAUDE_4_SONNET"

            if isinstance(output, dict):
                response_text = output.get("response")
                prompt_tokens = output.get("numberOfTokensInPrompt")
                completion_tokens = output.get("numberOfTokensInResponse")

                if isinstance(response_text, str):
                    if prompt_tokens is not None and completion_tokens is not None:
                        _record_usage(user, display_model_name, prompt_tokens, completion_tokens)
                    else:
                        _record_usage(user, display_model_name, len(full_prompt) // 4, len(response_text) // 4)
                    return response_text
                raise Exception(f"Unexpected Elsa output dict: {output!r}")

            if isinstance(output, str):
                _record_usage(user, display_model_name, len(full_prompt) // 4, len(output) // 4)
                return output

            raise Exception(f"Unexpected Elsa output type: {type(output).__name__}, value={output!r}")

        except requests.exceptions.Timeout:
            logger.error("Elsa request timed out")
            raise Exception("Elsa request timed out")
        except Exception as e:
            logger.error(f"Elsa error: {e}")
            raise

    elif provider == "gemini":
        if _check_is_internal():
            raise RuntimeError("Gemini model is disabled in internal environment.")
        config = types.GenerateContentConfig(
            temperature=temperature, top_p=top_p, max_output_tokens=max_tokens,
            system_instruction=system_prompt if system_prompt else None,
            safety_settings=[types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_ONLY_HIGH")]
        )
        contents = []
        if history:
            for turn in history:
                role = "model" if turn.get('role') in ['assistant', 'ai'] else "user"
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=turn.get('content', ''))]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_message)]))

        try:
            if kwargs.get("stream", False):
                return client.models.generate_content_stream(model=model, contents=contents, config=config)
            response = client.models.generate_content(model=model, contents=contents, config=config)
            if hasattr(response, 'usage_metadata') and response.usage_metadata:
                _record_usage(user, model, getattr(response.usage_metadata, 'prompt_token_count', 0), getattr(response.usage_metadata, 'candidates_token_count', 0))
            return response.text
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                try:
                    fallback_model = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-pro")
                    logger.warning(f"Gemini quota exceeded. Switching to {fallback_model} fallback.")
                    response = client.models.generate_content(model=fallback_model, contents=contents, config=config)
                    
                    if hasattr(response, 'usage_metadata') and response.usage_metadata:
                        _record_usage(user, fallback_model, getattr(response.usage_metadata, 'prompt_token_count', 0), getattr(response.usage_metadata, 'candidates_token_count', 0))

                    result_text = response.text
                    if "STRICTLY ONLY a single, raw JSON" in (system_prompt or "") or "{" in result_text: return result_text
                    return result_text + f"\n\n(Note: Switched to {fallback_model} due to usage limits.)"
                except Exception as fallback_error:
                    logger.error(f"Fallback failed: {fallback_error}")
                    return f"Gemini is currently not available (usage limit) and fallback failed. Please try later."
            logger.error(f"Gemini error: {e}"); raise e

def chat_with_document(user, user_message, history, xml_content, chat_type="general"):
    if chat_type == 'general':
        system_prompt = f"""
            You are a highly specialized AI assistant for FDA employees, designed to analyze regulatory documents. Your primary function is to provide direct, accurate, and cited answers to questions based on the provided drug labeling document.
            **Core Instructions:**
            -   Answer the user's question directly and concisely. **DO NOT** provide a step-by-step explanation, preamble, or summary of your reasoning (e.g., "Step 1," "To determine...").
            -   You **MUST** cite the specific section number(s) (e.g., (5.1), (7.3)) from the document that support your answer.
            -   At the very end of your response, on a new line, you **MUST** append the exact verbatim phrases (2-6 words) from the document that are most relevant to the answer. Use the hidden format: `[[KEYWORDS: "phrase one", "phrase two"]]`.
            -   If the document does not contain information to answer the question, state that clearly and do not invent an answer.

            **Reference Document:**
            {xml_content}
            """
    elif chat_type == 'TERM_VERIFY': 
        system_prompt = user_message
        user_message = f"###Refences: {xml_content}\n\n###Output: Here is the generated JSON:"
    return call_llm(user, system_prompt, user_message, history)

def summarize_comparison(user, differing_sections, label1_name, label2_name):
    summary_parts = []
    for section in differing_sections:
        summary_parts.append(f"--- Section: {section.get('title', 'Unknown Section')} ---\n{label1_name}:\n{section.get('content1', '')}\n\n{label2_name}:\n{section.get('content2', '')}\n\n")
    system_prompt = """
        You are an expert AI analyst for the FDA. Your sole function is to identify and summarize the key substantive differences between two drug labeling documents.
        Analyze and summarize critical differences focusing on safety, efficacy, indications, contraindications, and warnings.
        Output MUST be ONLY raw HTML starting with <h3>.
    """
    user_message = f"Compare drug labels for '{label1_name}' and '{label2_name}'.\n\n--- DOCUMENT CONTENT ---\n{''.join(summary_parts)}"
    return call_llm(user, system_prompt, user_message)

def generate_assessment(user, prompt, content):
    return call_llm(user, prompt, f"--- DRUG LABEL CONTENT ---\n{content}")

def get_search_helper_response(user, user_message, history):
    return call_llm(user, SEARCH_HELPER_PROMPT, user_message, history)
