'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import HistoryIcon from '@mui/icons-material/History';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckIcon from '@mui/icons-material/Check';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useUser } from '../../context/UserContext';
import { ActionButtons } from './ActionButtons';
import { McpConnectModal } from './McpConnectModal';
import type { ActionButton, ActiveFocus, ChatMessage, HistoryItem, ModelOption, ToolStep } from '../types';

const STARTER_PROMPTS = [
  {
    title: 'Safety & Dosing Summary',
    prompt: 'What are the Boxed Warning and recommended dosing for Ozempic?',
  },
  {
    title: 'Toxicity & Label Comparison',
    prompt: 'Check the liver toxicity (DILI) profile for Acetaminophen and find its labels to compare.',
  },
];

const FRIENDLY_TOOL_LABELS: Record<string, { running: string; done: string }> = {
  search_labels: {
    running: 'Searching drug labels',
    done: 'Searched drug labels',
  },
  read_label_sections: {
    running: 'Reading labeling sections',
    done: 'Read labeling sections',
  },
  query_drugtox: {
    running: 'Checking DrugTox safety data',
    done: 'Checked DrugTox safety data',
  },
  get_label_history: {
    running: 'Checking label version history',
    done: 'Checked label version history',
  },
  query_faers_signals: {
    running: 'Checking FAERS adverse event reports',
    done: 'Checked FAERS adverse event reports',
  },
  emit_action_buttons: {
    running: 'Preparing quick links',
    done: 'Prepared quick links',
  },
};

const SourcesDisclosure: React.FC<{ steps: ToolStep[] }> = ({ steps }) => {
  const [expanded, setExpanded] = useState(false);
  const visibleSteps = steps.filter((s) => s.tool !== 'emit_action_buttons');
  if (visibleSteps.length === 0) return null;

  return (
    <div className="lc-sources-box">
      <button
        type="button"
        className="lc-sources-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <CheckCircleOutlineIcon sx={{ fontSize: 14, color: '#15803d' }} />
        <span>
          Checked {visibleSteps.length} source{visibleSteps.length > 1 ? 's' : ''}
        </span>
        {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </button>
      {expanded && (
        <ul className="lc-sources-list">
          {visibleSteps.map((step, sIdx) => {
            const labelInfo = FRIENDLY_TOOL_LABELS[step.tool];
            const friendlyName = labelInfo
              ? step.status === 'running'
                ? labelInfo.running
                : labelInfo.done
              : step.tool;
            return (
              <li key={sIdx} className="lc-sources-item">
                {step.status === 'running' ? (
                  <BuildOutlinedIcon sx={{ fontSize: 13 }} />
                ) : (
                  <CheckCircleOutlineIcon sx={{ fontSize: 13, color: '#15803d' }} />
                )}
                <span className="lc-tool-name">{friendlyName}</span>
                {step.summary && <span className="lc-tool-summary">— {step.summary}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export const LabelChatWorkspace: React.FC = () => {
  const searchParams = useSearchParams();
  const { session } = useUser();
  const canPersistHistory = Boolean(session?.is_authenticated && !session?.is_guest);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('elsa');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('');

  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [histories, setHistories] = useState<HistoryItem[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<number | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [activeFocus, setActiveFocus] = useState<ActiveFocus | null>(null);
  const [mcpModalOpen, setMcpModalOpen] = useState<boolean>(false);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const initialQueryHandledRef = useRef<boolean>(false);

  // Load model catalog (defaults to Elsa / Haiku 5.5 from .env)
  useEffect(() => {
    let active = true;
    fetch('/api/search/models')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (Array.isArray(data.models)) {
          setModels(data.models);
        }
        if (data.default_provider) {
          setSelectedModel(data.default_provider);
        }
      })
      .catch(() => {
        // Fallback to default 'elsa'
      });
    return () => {
      active = false;
    };
  }, []);

  const loadHistories = useCallback(async () => {
    if (!canPersistHistory) return;
    try {
      const res = await fetch('/api/search/history');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.histories)) {
        setHistories(data.histories);
      }
    } catch {
      // ignore
    }
  }, [canPersistHistory]);

  useEffect(() => {
    loadHistories();
  }, [loadHistories]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusText]);

  const saveHistory = useCallback(
    async (updatedMessages: ChatMessage[], existingId: number | null) => {
      if (!canPersistHistory || updatedMessages.length === 0) return;
      const firstUser = updatedMessages.find((m) => m.role === 'user');
      const title = (firstUser?.content || 'Label Copilot Session').slice(0, 60);
      try {
        const res = await fetch('/api/search/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: existingId,
            title,
            chat_history: updatedMessages,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.id) {
          setCurrentHistoryId(data.id);
          loadHistories();
        }
      } catch {
        // ignore
      }
    },
    [canPersistHistory, loadHistories],
  );

  const sendMessage = useCallback(
    async (textOverride?: string) => {
      const query = (textOverride ?? input).trim();
      if (!query || isStreaming) return;

      if (!textOverride) {
        setInput('');
      }

      const priorHistory = messages.map((m) => ({ role: m.role, content: m.content }));
      const userMsg: ChatMessage = { role: 'user', content: query };
      const assistantPlaceholder: ChatMessage = {
        role: 'assistant',
        content: '',
        toolSteps: [],
        actions: [],
      };

      const baseMessages = [...messages, userMsg];
      setMessages([...baseMessages, assistantPlaceholder]);
      setIsStreaming(true);
      setStatusText('Looking up your request...');

      const controller = new AbortController();
      abortRef.current = controller;

      let accContent = '';
      let accSteps: ToolStep[] = [];
      let accActions: ActionButton[] = [];
      let accFollowUps: string[] = [];
      let accFocus: ActiveFocus | undefined = activeFocus || undefined;
      let modelUsed = '';
      let isGrounded: boolean | undefined = undefined;

      const updateAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.role !== 'assistant') return prev;
          next[next.length - 1] = { ...last, ...patch };
          return next;
        });
      };

      try {
        const res = await fetch('/api/search/agent_stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            chat_history: priorHistory,
            ai_provider: selectedModel,
            active_focus: activeFocus,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const rawBody = await res.text();
          let friendly = 'Unable to process your request right now. Please try again in a moment.';
          try {
            const parsed = JSON.parse(rawBody);
            if (parsed?.error && typeof parsed.error === 'string' && parsed.error.length < 200) {
              friendly = parsed.error;
            }
          } catch {
            // Raw HTML or non-JSON error (e.g. 500 debugger page): keep friendly message
            console.error('LabelChat HTTP error:', res.status, rawBody.slice(0, 500));
          }
          throw new Error(friendly);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const evt = JSON.parse(jsonStr);
              if (evt.type === 'status') {
                setStatusText(evt.text || '');
              } else if (evt.type === 'tool_call') {
                accSteps = [...accSteps, { tool: evt.tool, status: 'running' }];
                updateAssistant({ toolSteps: accSteps });
              } else if (evt.type === 'tool_result') {
                accSteps = accSteps.map((s, i) =>
                  i === accSteps.length - 1 && s.tool === evt.tool
                    ? { ...s, status: 'done', summary: evt.summary }
                    : s,
                );
                updateAssistant({ toolSteps: accSteps });
              } else if (evt.type === 'token') {
                accContent += evt.text || '';
                updateAssistant({ content: accContent });
              } else if (evt.type === 'actions') {
                accActions = Array.isArray(evt.actions) ? evt.actions : [];
                updateAssistant({ actions: accActions });
              } else if (evt.type === 'focus') {
                if (evt.focus && typeof evt.focus === 'object') {
                  accFocus = evt.focus;
                  setActiveFocus(evt.focus);
                }
              } else if (evt.type === 'follow_ups') {
                accFollowUps = Array.isArray(evt.items) ? evt.items : [];
                updateAssistant({ followUps: accFollowUps });
              } else if (evt.type === 'done') {
                modelUsed = evt.model || evt.provider || '';
                isGrounded = typeof evt.grounded === 'boolean' ? evt.grounded : undefined;
                updateAssistant({ modelUsed, grounded: isGrounded });
              } else if (evt.type === 'error') {
                console.error('LabelChat stream error:', evt.error);
                accContent =
                  accContent ||
                  'Sorry, I ran into a problem while looking that up. Please try again.';
                updateAssistant({ content: accContent });
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          accContent = accContent || '*(Generation stopped)*';
        } else {
          const msg = err instanceof Error ? err.message : 'Request failed';
          accContent = accContent || `Error: ${msg}`;
        }
        updateAssistant({ content: accContent });
      } finally {
        setIsStreaming(false);
        setStatusText('');
        abortRef.current = null;

        const finalAssistant: ChatMessage = {
          role: 'assistant',
          content: accContent,
          toolSteps: accSteps,
          actions: accActions,
          followUps: accFollowUps,
          focus: accFocus,
          modelUsed,
          grounded: isGrounded,
        };
        const finalThread = [...baseMessages, finalAssistant];
        saveHistory(finalThread, currentHistoryId);
      }
    },
    [input, isStreaming, messages, selectedModel, activeFocus, currentHistoryId, saveHistory],
  );

  // Support /search?q=... deep-linking
  useEffect(() => {
    const initialQ = searchParams.get('q');
    if (initialQ && !initialQueryHandledRef.current) {
      initialQueryHandledRef.current = true;
      sendMessage(initialQ);
    }
  }, [searchParams, sendMessage]);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleNewChat = () => {
    if (isStreaming) handleStop();
    setMessages([]);
    setCurrentHistoryId(null);
    setActiveFocus(null);
    setStatusText('');
  };

  const handleSelectHistory = (item: HistoryItem) => {
    if (isStreaming) handleStop();
    const loaded = Array.isArray(item.chat_data) ? item.chat_data : [];
    setMessages(loaded);
    setCurrentHistoryId(item.id);
    const lastWithFocus = [...loaded].reverse().find((m) => m.focus && (m.focus.set_id || m.focus.brand_name));
    setActiveFocus(lastWithFocus?.focus || null);
    setHistoryOpen(false);
  };

  const handleRenameHistory = async (id: number) => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingHistoryId(null);
      return;
    }
    try {
      const res = await fetch(`/api/search/history/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setHistories((prev) => prev.map((h) => (h.id === id ? { ...h, title: trimmed } : h)));
      }
    } finally {
      setEditingHistoryId(null);
    }
  };

  const handleDeleteHistory = async (id: number) => {
    try {
      const res = await fetch(`/api/search/history/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setHistories((prev) => prev.filter((h) => h.id !== id));
        if (currentHistoryId === id) {
          setCurrentHistoryId(null);
        }
      }
    } catch {
      // ignore
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="lc-shell">
      {canPersistHistory && (
        <aside className={`lc-history-drawer ${historyOpen ? 'is-open' : ''}`}>
          <div className="lc-history-header">
            <span>Chat History</span>
            <button
              type="button"
              className="lc-icon-btn"
              onClick={() => setHistoryOpen(false)}
              aria-label="Close history"
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </button>
          </div>
          <div className="lc-history-list">
            {histories.length === 0 ? (
              <div className="lc-history-empty">No saved conversations yet.</div>
            ) : (
              histories.map((h) => (
                <div
                  key={h.id}
                  className={`lc-history-item ${currentHistoryId === h.id ? 'is-active' : ''}`}
                >
                  {editingHistoryId === h.id ? (
                    <div className="lc-history-edit-row">
                      <input
                        type="text"
                        className="lc-history-edit-input"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameHistory(h.id);
                          if (e.key === 'Escape') setEditingHistoryId(null);
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="lc-icon-btn"
                        onClick={() => handleRenameHistory(h.id)}
                        aria-label="Save title"
                      >
                        <CheckIcon sx={{ fontSize: 16 }} />
                      </button>
                    </div>
                  ) : (
                    <div className="lc-history-row">
                      <button
                        type="button"
                        className="lc-history-select"
                        onClick={() => handleSelectHistory(h)}
                      >
                        <div className="lc-history-title">{h.title || 'Untitled'}</div>
                        <div className="lc-history-date">
                          {new Date(h.timestamp).toLocaleDateString()}
                        </div>
                      </button>
                      <div className="lc-history-actions">
                        <button
                          type="button"
                          className="lc-icon-btn"
                          onClick={() => {
                            setEditingHistoryId(h.id);
                            setEditingTitle(h.title || '');
                          }}
                          title="Rename"
                          aria-label="Rename conversation"
                        >
                          <EditOutlinedIcon sx={{ fontSize: 15 }} />
                        </button>
                        <button
                          type="button"
                          className="lc-icon-btn lc-icon-btn--danger"
                          onClick={() => handleDeleteHistory(h.id)}
                          title="Delete"
                          aria-label="Delete conversation"
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      <main className="lc-main">
        <div className="lc-topbar">
          <div className="lc-topbar-left">
            {canPersistHistory && (
              <button
                type="button"
                className="lc-topbar-btn"
                onClick={() => setHistoryOpen((v) => !v)}
                title="Conversation history"
              >
                <HistoryIcon sx={{ fontSize: 18 }} />
                <span>History</span>
              </button>
            )}
            <button
              type="button"
              className="lc-topbar-btn"
              onClick={handleNewChat}
              title="Start a new chat"
            >
              <AddCommentOutlinedIcon sx={{ fontSize: 18 }} />
              <span>New Chat</span>
            </button>
            <button
              type="button"
              className="lc-topbar-btn"
              onClick={() => setMcpModalOpen(true)}
              title="Connect askFDALabel MCP to Claude Desktop or Claude Code"
            >
              <HubOutlinedIcon sx={{ fontSize: 18 }} />
              <span>Use in Claude</span>
            </button>
          </div>

          <div className="lc-topbar-center">
            <span className="lc-brand-title">Label Copilot</span>
          </div>

          <div className="lc-topbar-right">
            <label htmlFor="lc-model-select" className="lc-model-label">
              Model
            </label>
            <select
              id="lc-model-select"
              className="lc-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isStreaming || models.length <= 1}
            >
              {models.length > 0 ? (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              ) : (
                <option value="elsa">ELSA</option>
              )}
            </select>
          </div>
        </div>

        <div className="lc-messages-scroll">
          <div className="lc-messages-container">
            {messages.length === 0 ? (
              <div className="lc-welcome">
                <h1>FDA Drug Labeling Assistant</h1>
                <p>
                  Ask questions about drug labels, safety warnings, dosing, or liver toxicity in
                  plain language. You&apos;ll get grounded answers with one-click buttons to open
                  full labels, search results, or side-by-side comparisons.
                </p>
                <div className="lc-starter-grid">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      className="lc-starter-card"
                      onClick={() => sendMessage(item.prompt)}
                    >
                      <div className="lc-starter-title">{item.title}</div>
                      <div className="lc-starter-prompt">{item.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isLastAssistant =
                  msg.role === 'assistant' && idx === messages.length - 1 && isStreaming;
                return (
                  <div key={idx} className={`lc-msg lc-msg--${msg.role}`}>
                    <div className="lc-msg-bubble">
                      {msg.role === 'assistant' && msg.content && msg.toolSteps && msg.toolSteps.length > 0 && (
                        <SourcesDisclosure steps={msg.toolSteps} />
                      )}
                      {msg.role === 'assistant' && msg.content && msg.grounded === false && (!msg.toolSteps || msg.toolSteps.length === 0) && (
                        <div className="lc-sources-box">
                          <span className="lc-sources-toggle" style={{ cursor: 'default', color: '#92400e', background: '#fffbeb', borderColor: '#fde68a' }}>
                            General response · No FDA label queried
                          </span>
                        </div>
                      )}

                      {msg.content ? (
                        <div className="lc-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      ) : isLastAssistant ? (
                        <div className="lc-streaming-status">
                          <span className="lc-spinner" />
                          <span>{statusText || 'Thinking...'}</span>
                        </div>
                      ) : null}

                      {msg.role === 'assistant' && isLastAssistant && msg.content && statusText && (
                        <div className="lc-streaming-status" style={{ marginTop: 8 }}>
                          <span className="lc-spinner" />
                          <span>{statusText}</span>
                        </div>
                      )}

                      {msg.role === 'assistant' && (
                        <ActionButtons actions={msg.actions} />
                      )}

                      {msg.role === 'assistant' &&
                        idx === messages.length - 1 &&
                        !isStreaming &&
                        msg.followUps &&
                        msg.followUps.length > 0 && (
                          <div className="lc-followups">
                            <span className="lc-followups-label">Suggested follow-ups:</span>
                            <div className="lc-followups-list">
                              {msg.followUps.map((qText, qIdx) => (
                                <button
                                  key={qIdx}
                                  type="button"
                                  className="lc-followup-chip"
                                  onClick={() => sendMessage(qText)}
                                >
                                  {qText}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="lc-composer-wrap">
          {activeFocus && (activeFocus.brand_name || activeFocus.generic_name) && (
            <div className="lc-focus-bar">
              <span className="lc-focus-pill">
                <span>
                  Focusing on:{' '}
                  <strong>
                    {(activeFocus.brand_name || activeFocus.generic_name || '').split(';')[0]}
                  </strong>
                  {activeFocus.application_number ? ` (${activeFocus.application_number})` : ''}
                  {activeFocus.revised_date ? ` · Revised ${activeFocus.revised_date}` : ''}
                </span>
                <button
                  type="button"
                  className="lc-focus-clear"
                  onClick={() => setActiveFocus(null)}
                  title="Clear current drug focus"
                  aria-label="Clear current drug focus"
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </button>
              </span>
            </div>
          )}
          <div className="lc-composer">
            <textarea
              className="lc-textarea"
              placeholder="Ask about a drug label, boxed warning, NDA/NDC, DrugTox DILI status, or compare versions..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={isStreaming}
            />
            {isStreaming ? (
              <button
                type="button"
                className="lc-send-btn lc-send-btn--stop"
                onClick={handleStop}
                title="Stop generation"
              >
                <StopCircleOutlinedIcon sx={{ fontSize: 20 }} />
              </button>
            ) : (
              <button
                type="button"
                className="lc-send-btn"
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                title="Send message"
              >
                <SendRoundedIcon sx={{ fontSize: 19 }} />
              </button>
            )}
          </div>
        </div>
      </main>
      <McpConnectModal
        open={mcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
        canUseApiKey={canPersistHistory}
      />
    </div>
  );
};
