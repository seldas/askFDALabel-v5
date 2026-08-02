import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSearchContext } from '../context/SearchContext';
import { useUser } from '../../context/UserContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { withAppBase } from '../../utils/appPaths';

interface ChatPanelProps {
  onSearch: () => void;
}

const semanticSuggestions = [
  { title: "Adverse Events", query: "What are the most common adverse events reported in the labeling for Humira?" },
  { title: "Indications", query: "What are the approved indications and usage for Keytruda?" },
  { title: "Boxed Warning", query: "Does the labeling for Ozempic contain a boxed warning? If so, what does it state?" },
  { title: "Contraindications", query: "What are the specific contraindications listed in the labeling for Mounjaro?" }
];

const PROGRESS_STEPS = [
  { key: "plan", label: "Planning" },
  { key: "db", label: "Searching labels" },
  { key: "evidence", label: "Fetching evidence" },
  { key: "answer", label: "Writing answer" },
  { key: "finalize", label: "Finalizing" },
];

function inferStage(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("planning")) return 0;
  if (s.includes("searching") || s.includes("database") || s.includes("query")) return 1;
  if (s.includes("fetching") || s.includes("evidence") || s.includes("excerpts")) return 2;
  if (s.includes("writing") || s.includes("generating") || s.includes("answer")) return 3;
  if (s.includes("finalizing") || s.includes("reasoning")) return 4;
  return 0;
}

const Spinner = () => (
  <span className="afd-progress__spinner" aria-hidden />
);

const StepIcon = ({ state }: { state: "todo" | "active" | "done" }) => {
  if (state === "done") return <span className="afd-progress__icon afd-progress__icon--done">✓</span>;
  if (state === "active") return <span className="afd-progress__icon afd-progress__icon--active"><Spinner /></span>;
  return <span className="afd-progress__icon afd-progress__icon--todo" />;
};

const SimpleProgress = ({ status }: { status: string }) => {
  return (
    <div className="afd-progress afd-progress--simple">
      <div className="afd-progress__card">
        <div className="afd-progress__header">
          <Spinner />
          <div className="afd-progress__headText">
            <div className="afd-progress__title">{status || "AI is thinking..."}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DiffHighlight: React.FC<{ original: string; refined: string }> = ({ original, refined }) => {
  const normalizeWord = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/gi, "");
  const originalWords = new Set(
    original
      .split(/\s+/)
      .map(normalizeWord)
      .filter(Boolean)
  );

  const tokens = refined.split(/(\s+)/).map((token, index) => {
    if (!token.trim()) {
      return <span key={index}>{token}</span>;
    }
    const normalized = normalizeWord(token);
    const isNew = normalized && !originalWords.has(normalized);
    return (
      <span
        key={index}
        style={{
          backgroundColor: isNew ? '#fde68a' : 'transparent',
          borderRadius: 3,
          padding: isNew ? '0 2px' : undefined,
        }}
      >
        {token}
      </span>
    );
  });

  return (
    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.95rem' }}>
      {tokens}
    </div>
  );
};

const ThinkingMessage = ({ status }: { status: string }) => {
  return (
    <div className="chat-message assistant thinking-message">
      <div className="message-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="loading-spinner-small"></div>
          <span style={{ fontStyle: 'italic', color: '#64748b' }}>{status || "AI is thinking..."}</span>
        </div>
      </div>
    </div>
  );
};

const ChatPanel: React.FC<ChatPanelProps> = ({ onSearch }) => {
  const searchParams = useSearchParams();
  const { session } = useUser();
  const {
    searchTerm,
    setSearchTerm,
    setResults,
    setSetIds,
    setTotalResults,
    setCurrentPage,
    filters,
    chatHistory,
    setChatHistory,
    setHighlightedSetId,
    loadingStatus,
    setLoadingStatus,
    searchMode,
    setAgentFlow,
    setReasoning,
    setDebugIntent,
    setDebugPlan,
    setDebugStats,
    setTraceLog,
    toggleFilterTerm,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    currentHistoryId,
    setCurrentHistoryId,
  } = useSearchContext();

  const [isLoading, setIsLoading] = useState(false);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);
  const [comparisonOriginal, setComparisonOriginal] = useState('');
  const [comparisonRefined, setComparisonRefined] = useState('');


  // ── Decision logic has moved to the backend /db_search endpoint ──────────
  // Only kept here for follow-up detection (direct-query pattern on subsequent messages)
  const isDirectQueryPattern = (q: string): boolean => {
    const t = q.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true;
    if (/^\d{4,5}-\d{3,4}(-\d{1,2})?$/.test(t)) return true;  // 2-segment or 3-segment NDC
    if (/^(NDA|ANDA|BLA)?\s*\d{4,6}$/i.test(t)) return true;
    return false;
  };

  const executeSearch = async (queryText: string) => {
    if (!queryText.trim()) return;

    const isFirstMessage = chatHistory.length === 0;
    const isDirect = isDirectQueryPattern(queryText);

    // ── DB-first path: first message OR explicit direct-query pattern ────────
    if (isFirstMessage || isDirect) {
      const updatedHistory = [...chatHistory, { role: 'user' as const, content: queryText }];
      setChatHistory(updatedHistory);
      setHasUnsavedChanges(true);
      setSearchTerm('');
      setIsLoading(true);
      setLoadingStatus('Querying database...');
      onSearch();

      try {
        const dbRes = await fetch('/api/search/db_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: queryText, ai_provider: session?.ai_provider }),
        });
        const dbData = await dbRes.json();

        if (dbData.action === 'db_found' || dbData.action === 'single_label') {
          // Populate Results panel if the backend returned rows (count ≤ 10)
          if (dbData.results && dbData.results.length > 0) {
            setResults(dbData.results);
            setTotalResults(dbData.count ?? dbData.results.length);
            setCurrentPage(1);
          }
          setChatHistory(prev => [...prev, { role: 'assistant' as const, content: dbData.response_text }]);
          setIsLoading(false);
          setLoadingStatus('');
          return;
        }

        // ai_fallback — DB returned 0 results or general question
        setLoadingStatus('Thinking...');
        const chatRes = await fetch('/api/search/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: queryText,
            // Pass only existing history (not including the user msg we already appended)
            chat_history: updatedHistory,
            ai_provider: session?.ai_provider,
            is_failed_keyword_search: dbData.is_keyword ?? false,
          }),
        });
        const chatData = await chatRes.json();
        setChatHistory(prev => [...prev, { role: 'assistant' as const, content: chatData.response_text }]);
        setIsLoading(false);
        setLoadingStatus('');
      } catch (error) {
        console.error('Search error:', error);
        setChatHistory(prev => [...prev, { role: 'assistant', content: 'An unexpected error occurred.' }]);
        setIsLoading(false);
        setLoadingStatus('');
      }
      return;
    }

    // ── Follow-up conversational message: go straight to /chat with history ──
    const updatedHistory = [...chatHistory, { role: 'user' as const, content: queryText }];
    setChatHistory(updatedHistory);
    setHasUnsavedChanges(true);
    setSearchTerm('');
    setIsLoading(true);
    setLoadingStatus('Thinking...');
    onSearch();

    try {
      const response = await fetch('/api/search/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText,
          chat_history: updatedHistory,
          ai_provider: session?.ai_provider,
          is_failed_keyword_search: false,
        }),
      });
      const result = await response.json();
      setChatHistory(prev => [...prev, { role: 'assistant' as const, content: result.response_text }]);
      setIsLoading(false);
      setLoadingStatus('');
    } catch (error) {
      console.error('Chat error:', error);
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'An unexpected error occurred.' }]);
      setIsLoading(false);
      setLoadingStatus('');
    }
  };



  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(searchTerm);
  };

  const handleClear = () => {
      if (!window.confirm("Are you sure you want to clear this conversation? If you haven't saved, you will lose it forever!")) {
          return;
      }
      setChatHistory([]);
      setResults([]);
      setSetIds([]);
      setTotalResults(0);
      setCurrentPage(1);
      setSearchTerm('');
      setHasUnsavedChanges(false);
      setCurrentHistoryId(null);
  };

  const handleSave = async () => {
      if (chatHistory.length === 0 || !hasUnsavedChanges) return;
      try {
          const firstMsg = chatHistory[0].content;
          const title = firstMsg.length > 50 ? firstMsg.substring(0, 50) + '...' : firstMsg;
          
          const res = await fetch('/api/search/history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_history: chatHistory, title, id: currentHistoryId })
          });
          const data = await res.json();
          if (res.ok && data.success) {
              setCurrentHistoryId(data.id);
              setHasUnsavedChanges(false);
          } else {
              alert("Failed to save conversation.");
          }
      } catch (e) {
          console.error("Save error", e);
          alert("Failed to save conversation.");
      }
  };

  // Auto-search or load from cache
  const initialSearchFired = useRef(false);
  useEffect(() => {
    if (chatHistory.length > 0 || isLoading || initialSearchFired.current) return;

    // Check if loading an existing saved conversation
    const cachedHistoryChat = sessionStorage.getItem('initial_history_chat');
    const cachedHistoryId = sessionStorage.getItem('initial_history_id');
    if (cachedHistoryChat) {
      sessionStorage.removeItem('initial_history_chat');
      sessionStorage.removeItem('initial_history_id');
      try {
        const chatData = JSON.parse(cachedHistoryChat);
        const historyId = cachedHistoryId ? parseInt(cachedHistoryId) : null;
        initialSearchFired.current = true;
        setChatHistory(chatData);
        setCurrentHistoryId(historyId);
        setHasUnsavedChanges(false);
        onSearch();
        return;
      } catch (e) {
        console.error("Failed to parse cached history", e);
      }
    }

    const cachedResult = sessionStorage.getItem('initial_search_result');
    if (cachedResult) {
      sessionStorage.removeItem('initial_search_result');
      try {
        const data = JSON.parse(cachedResult);
        initialSearchFired.current = true;
        setChatHistory([
          { role: 'user', content: data.query },
          { role: 'assistant', content: data.response }
        ]);
        // Hydrate Results panel if the DB search returned records (count ≤ 10)
        if (data.results && data.results.length > 0) {
          setResults(data.results);
          setTotalResults(data.results.length);
          setCurrentPage(1);
        }
        setHasUnsavedChanges(true);
        onSearch();
        return;
      } catch(e) {
        console.error("Failed to parse cached result", e);
      }
    }


    const query = searchParams.get('q');
    if (query) {
      initialSearchFired.current = true;
      executeSearch(query);
    }
  }, [searchParams]);

  const ComparisonModal = () => {
    if (!isComparisonModalOpen) return null;
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, backdropFilter: 'blur(4px)'
      }}>
        <div style={{
          background: 'white', padding: '30px', borderRadius: '16px', width: '90%', maxWidth: '1200px', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900 }}>Response Comparison</h2>
            <button onClick={() => setIsComparisonModalOpen(false)} style={{ border: 'none', background: '#f1f5f9', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Close ✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 800, color: '#64748b', textTransform: 'uppercase', fontSize: '0.75rem', marginBottom: '10px' }}>Original Response</div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {comparisonOriginal}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', fontSize: '0.75rem', marginBottom: '10px' }}>Refined with References</div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                <DiffHighlight original={comparisonOriginal} refined={comparisonRefined} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatHistory.length > 2) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [searchTerm]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (searchTerm.trim()) {
        executeSearch(searchTerm);
      }
    }
  };

  return (
    <div className="chat-panel">
      {chatHistory.length === 0 ? (
        <div className="initial-view-container">
            <h1 className="hero-title-animated" style={{ fontSize: '3.5rem', fontWeight: 800, marginBottom: '1rem' }}>
              AI assistant for FDALabel
            </h1>
            
            <form onSubmit={handleSearch} className="centered-search-form">
                <div className="centered-input-wrapper">
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about clinical data, safety, or dosing..."
                        disabled={isLoading}
                        autoFocus
                    />
                    <button type="submit" disabled={isLoading || !searchTerm.trim()} className="send-btn-centered">
                        ➤
                    </button>
                </div>
            </form>

            <div style={{ textAlign: 'center', marginTop: '-0.5rem', marginBottom: '1.5rem' }}>
              <Link 
                href="/localquery" 
                style={{ 
                  fontSize: '0.9rem', 
                  color: '#6366f1', 
                  textDecoration: 'none', 
                  fontWeight: 700, 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                </svg>
                Direct Structured Database Query
              </Link>
            </div>

            <div className="suggestions-grid">
                {semanticSuggestions.map((suggestion, index) => (
                    <div 
                        key={index} 
                        className="suggestion-card" 
                        onClick={() => executeSearch(suggestion.query)}
                    >
                        <span className="suggestion-heading">{suggestion.title}</span>
                        <span className="suggestion-text">{suggestion.query}</span>
                    </div>
                ))}
            </div>
        </div>
      ) : (
        <>
            <div className="chat-history">
                {chatHistory.map((msg, index) => (
                <div key={index} className={`chat-message ${msg.role}`}>
                    <div className="message-content">
                    {msg.role === 'assistant' ? (
                        <>
                        <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw]}
                            components={{
                                // @ts-ignore - custom tag
                                annotation: ({node, className, children}) => {
                                    const cls = className || "";
                                    const content = children?.toString() || "";
                                    
                                    let onClick = undefined;
                                    if (cls === 'drug') {
                                        onClick = () => toggleFilterTerm('drugNames', content);
                                    } else if (cls === 'ndc') {
                                        onClick = () => toggleFilterTerm('ndcs', content);
                                    } else if (cls === 'adverse_events') {
                                        onClick = () => toggleFilterTerm('adverseEvents', content);
                                    }

                                    return (
                                        <span 
                                            className={`highlight-${cls}`} 
                                            onClick={onClick}
                                            style={onClick ? { cursor: 'pointer' } : {}}
                                        >
                                          {children}
                                        </span>
                                    );
                                },
                                p: ({children}) => {
                                    return <p>{children}</p>;
                                },
                                a: ({node, href, children, ...props}) => {
                                    if (href?.startsWith('#cite-')) {
                                        const setId = href.replace('#cite-', '');
                                        return (
                                            <button 
                                                className="citation-btn" 
                                                onClick={() => setHighlightedSetId(setId)}
                                                title="Highlight result"
                                            >
                                                {children}
                                            </button>
                                        );
                                    }
                                    if (href && href.startsWith('/') && !href.startsWith('//')) {
                                        return (
                                            <Link 
                                                href={href} 
                                                className={props.className} 
                                                style={props.style} 
                                                title={props.title}
                                                target={props.target}
                                                rel={props.rel}
                                            >
                                                {children}
                                            </Link>
                                        );
                                    }
                                    return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
                                }
                            }}
                        >
                            {msg.content}
                        </ReactMarkdown>
                        
                        {(msg as any).originalContent && (
                            <details style={{ marginTop: '10px', fontSize: '0.85rem', color: '#64748b', background: '#f8fafc', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 700, userSelect: 'none' }}>
                                    📄 Show Original Response
                                </summary>
                                <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                    {(msg as any).originalContent}
                                </div>
                            </details>
                        )}

                        {(msg as any).relatedSections && (
                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                                <div style={{ fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>
                                    Refinement Source: {(msg as any).refLabel}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {((msg as any).relatedSections || []).map((sec: string, si: number) => (
                                        <span key={si} style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                                            {sec}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        </>
                    ) : (
                        msg.content
                    )}
                    </div>
                </div>
                ))}
                {isLoading && (
                   <ThinkingMessage status={loadingStatus} />
                )}
                <div ref={chatEndRef} />
            </div>

            <div className="chat-input-area">
                <form onSubmit={handleSearch} className="chat-form">
                    <div className="input-wrapper">
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask a follow-up question..."
                            disabled={isLoading}
                        />
                        <button type="submit" disabled={isLoading || !searchTerm.trim()}>
                            ➤
                        </button>
                    </div>
                </form>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                        type="button" 
                        onClick={handleSave} 
                        disabled={!hasUnsavedChanges}
                        style={{ 
                            background: hasUnsavedChanges ? '#10b981' : '#e2e8f0', 
                            color: hasUnsavedChanges ? 'white' : '#94a3b8', 
                            border: 'none',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            cursor: hasUnsavedChanges ? 'pointer' : 'not-allowed',
                            transition: 'all 0.2s',
                            boxShadow: hasUnsavedChanges ? '0 4px 6px -1px rgba(16, 185, 129, 0.2)' : 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                        onMouseEnter={(e) => {
                            if (hasUnsavedChanges) {
                                e.currentTarget.style.background = '#059669';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (hasUnsavedChanges) {
                                e.currentTarget.style.background = '#10b981';
                                e.currentTarget.style.transform = 'none';
                            }
                        }}
                    >
                        {hasUnsavedChanges ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                                    <polyline points="7 3 7 8 15 8"></polyline>
                                </svg>
                                Save Chat
                            </>
                        ) : (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                Saved
                            </>
                        )}
                    </button>
                    <button type="button" onClick={handleClear} className="clear-chat-btn" style={{ padding: '8px 16px', borderRadius: '8px' }}>
                        Clear Chat
                    </button>
                </div>
            </div>
        </>
      )}
    </div>
  );
};

export default ChatPanel;

