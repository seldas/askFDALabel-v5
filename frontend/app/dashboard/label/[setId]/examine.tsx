'use client';

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { withApiBase } from '../../../utils/appPaths';
import type { ProductData } from './types';

interface ExaminePrompt {
  id: number | 'custom';
  title: string;
  description: string;
  display_order: number;
  is_custom?: boolean;
  is_similar?: boolean;
}

interface ExamineResult {
  answer: string;
  model_used: string;
  from_cache: boolean;
  created_at: string;
  history_id: number;
}

interface ExamineViewProps {
  activeTab: string;
  setId: string;
  productData: ProductData[];
}

function AppTypeBadge({ appType }: { appType: string }) {
  const badgeColors: Record<string, { bg: string; color: string }> = {
    NDA:   { bg: 'var(--fdl-blue-100)', color: 'var(--fdl-blue-700)' },
    ANDA:  { bg: 'var(--fdl-green-050)', color: 'var(--fdl-green)' },
    BLA:   { bg: 'var(--fdl-blue-050)', color: 'var(--fdl-blue-700)' },
    OTC:   { bg: 'var(--fdl-amber-050)', color: 'var(--fdl-amber)' },
    BIOLOGIC: { bg: 'var(--fdl-blue-050)', color: 'var(--fdl-blue-700)' },
  };
  const style = badgeColors[appType?.toUpperCase()] ?? { bg: 'var(--fdl-line-soft)', color: 'var(--fdl-muted)' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--fdl-radius-sm, 2px)',
      fontSize: '0.72rem',
      fontWeight: 700,
      letterSpacing: '0.05em',
      backgroundColor: style.bg,
      color: style.color,
    }}>
      {appType || 'N/A'}
    </span>
  );
}

function IngredientsList({ ingredients }: { ingredients: ProductData['ingredients'] }) {
  const active   = ingredients.filter(i => i.type === 'ACTIB' || i.type === 'ACTIM' || i.type === 'active');
  const inactive = ingredients.filter(i => i.type === 'IACT'  || i.type === 'inactive');
  return (
    <div style={{ fontSize: '0.78rem', lineHeight: 1.5 }}>
      {active.length > 0 && (
        <div>
          <span style={{ fontWeight: 700, color: 'var(--fdl-navy-950)', display: 'block', marginBottom: '2px' }}>Active</span>
          {active.map((ing, i) => (
            <div key={i} style={{ color: 'var(--fdl-blue-700)' }}>
              {ing.name}{ing.strength ? <span style={{ color: 'var(--fdl-muted)', fontWeight: 400 }}> — {ing.strength}</span> : ''}
            </div>
          ))}
        </div>
      )}
      {inactive.length > 0 && (
        <div style={{ marginTop: active.length > 0 ? '6px' : 0 }}>
          <span style={{ fontWeight: 600, color: 'var(--fdl-muted)', display: 'block', marginBottom: '2px' }}>
            Inactive ({inactive.length})
          </span>
          <span style={{ color: 'var(--fdl-muted)', fontSize: '0.73rem' }}>
            {inactive.map(i => i.name).filter(Boolean).join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}

export function ProductSpecsTable({ productData }: { productData: ProductData[] }) {
  if (!productData || productData.length === 0) {
    return (
      <div style={{
        padding: '20px 24px', background: 'var(--fdl-canvas)', borderRadius: 'var(--fdl-radius-sm, 2px)',
        border: '1px solid var(--fdl-line)', color: 'var(--fdl-muted)', fontSize: '0.85rem', textAlign: 'center',
      }}>
        No structured product data found in this SPL document.
      </div>
    );
  }
  const headers = ['Product Name', 'NDC Number', 'Dosage Form', 'Application No.', 'Category', 'Ingredients'];
  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: 'var(--fdl-canvas)', borderBottom: '2px solid var(--fdl-line)' }}>
            {headers.map(h => (
              <th key={h} style={{
                padding: '10px 14px', textAlign: 'left', fontWeight: 700,
                fontSize: '0.7rem', textTransform: 'uppercase' as const,
                letterSpacing: '0.06em', color: 'var(--fdl-muted)', whiteSpace: 'nowrap' as const,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {productData.map((prod, idx) => (
            <tr key={idx} style={{ borderBottom: idx < productData.length - 1 ? '1px solid var(--fdl-line-soft)' : 'none', background: idx % 2 === 0 ? 'var(--fdl-paper)' : 'var(--fdl-canvas)' }}>
              <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--fdl-navy-950)', whiteSpace: 'nowrap' as const }}>{prod.name || '—'}</td>
              <td style={{ padding: '12px 14px' }}>
                {prod.ndc ? (
                  <span style={{ display: 'inline-block', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', fontWeight: 600, color: 'var(--fdl-navy-950)', background: 'var(--fdl-line-soft)', padding: '2px 7px', borderRadius: '2px', letterSpacing: '0.04em' }}>
                    {prod.ndc}
                  </span>
                ) : '—'}
              </td>
              <td style={{ padding: '12px 14px', color: 'var(--fdl-ink-soft)', whiteSpace: 'nowrap' as const }}>
                {prod.form ? prod.form.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '—'}
              </td>
              <td style={{ padding: '12px 14px' }}>
                {prod.app_num ? (
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: 'var(--fdl-blue-700)', fontSize: '0.8rem' }}>{prod.app_num}</span>
                ) : '—'}
              </td>
              <td style={{ padding: '12px 14px' }}><AppTypeBadge appType={prod.app_type} /></td>
              <td style={{ padding: '12px 14px', maxWidth: '280px' }}><IngredientsList ingredients={prod.ingredients} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClinicalQueryEngine({ setId }: { setId: string }) {
  const [prompts, setPrompts]               = useState<ExaminePrompt[]>([]);
  const [selectedPromptId, setSelected]     = useState<number | 'custom' | null>(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [result, setResult]                 = useState<ExamineResult | null>(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [promptsLoading, setPromptsLoading] = useState(true);

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) ?? null;

  useEffect(() => {
    if (!setId) return;
    setPromptsLoading(true);
    fetch(withApiBase(`/api/dashboard/examine/prompts?set_id=${setId}`))
      .then(r => r.json())
      .then(d => {
        const list: ExaminePrompt[] = d.prompts ?? [];
        setPrompts(list);
        if (list.length > 0) setSelected(list[0].id);
      })
      .catch(() => setError('Failed to load clinical queries.'))
      .finally(() => setPromptsLoading(false));
  }, [setId]);

  useEffect(() => {
    if (selectedPromptId === 'custom') {
      setResult(null);
      setError(null);
      return;
    }
    if (!selectedPromptId || !setId) return;
    setResult(null);
    setError(null);
    setLoading(true);
    fetch(withApiBase('/api/dashboard/examine/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set_id: setId, prompt_id: selectedPromptId, force_refresh: false }),
    })
      .then(r => r.json())
      .then(d => { if (d.error) { setError(d.error); return; } setResult(d); })
      .catch(() => setError('Error loading result.'))
      .finally(() => setLoading(false));
  }, [selectedPromptId, setId]);

  const handleRun = useCallback((forceRefresh: boolean) => {
    if (!selectedPromptId || !setId) return;
    if (selectedPromptId === 'custom' && !customQuestion.trim()) {
      setError('Please enter a custom question.');
      return;
    }
    setResult(null); setError(null); setLoading(true);

    const body: any = {
      set_id: setId,
      prompt_id: selectedPromptId,
      force_refresh: forceRefresh,
    };
    if (selectedPromptId === 'custom') {
      body.custom_question = customQuestion.trim();
    }

    fetch(withApiBase('/api/dashboard/examine/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setResult(d);
        if (selectedPromptId === 'custom' && d.prompt_id) {
          fetch(withApiBase(`/api/dashboard/examine/prompts?set_id=${setId}`))
            .then(r2 => r2.json())
            .then(d2 => {
              const list: ExaminePrompt[] = d2.prompts ?? [];
              setPrompts(list);
              setSelected(d.prompt_id);
              setCustomQuestion('');
            });
        }
      })
      .catch(() => setError('Error running query.'))
      .finally(() => setLoading(false));
  }, [selectedPromptId, setId, customQuestion]);

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--fdl-navy-950)', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '4px', height: '24px', background: 'var(--fdl-blue-700)', borderRadius: '2px' }} />
          Task-Specific Summarization
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--fdl-muted)', lineHeight: 1.5 }}>
          Select a pre-defined or custom task question and the AI will analyze the labeling document to generate a structured task summary.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' as const, marginBottom: '16px' }}>
        {promptsLoading ? (
          <div style={{ padding: '10px', color: 'var(--fdl-muted)', fontSize: '0.82rem' }}>Loading queries…</div>
        ) : (
          <div style={{ flex: 1, minWidth: '260px' }}>
            <select
              value={selectedPromptId ?? ''}
              onChange={e => {
                const val = e.target.value;
                setSelected(val === 'custom' ? 'custom' : Number(val));
              }}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid var(--fdl-line, var(--fdl-line))',
                borderRadius: 'var(--fdl-radius-sm, 2px)', fontSize: '0.85rem', fontWeight: 600,
                color: 'var(--fdl-text, var(--fdl-navy-950))', background: 'var(--fdl-surface, var(--fdl-paper))', cursor: 'pointer',
                outline: 'none',
              }}
            >
              {prompts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.is_similar ? `[Similar Drug] ${p.title}` : p.title}
                </option>
              ))}
              <option value="custom">✏️ Ask a custom question...</option>
            </select>
            {selectedPrompt?.description && (
              <p style={{ margin: '6px 0 0 2px', fontSize: '0.75rem', color: 'var(--fdl-muted)', fontStyle: 'italic' }}>{selectedPrompt.description}</p>
            )}
            {selectedPrompt?.is_similar && (
              <p style={{
                margin: '6px 0 0 2px',
                fontSize: '0.75rem',
                color: 'var(--fdl-amber)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span>ℹ️ A similar question has been asked for another drug with the same generic name.</span>
              </p>
            )}
            {selectedPromptId === 'custom' && (
              <div style={{ marginTop: '10px' }}>
                <textarea
                  value={customQuestion}
                  onChange={e => setCustomQuestion(e.target.value)}
                  placeholder="Type your customized question here (e.g., Does this drug cause QTc prolongation?)..."
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '8px 10px',
                    border: '1px solid var(--fdl-line, var(--fdl-line))',
                    borderRadius: 'var(--fdl-radius-sm, 2px)',
                    fontSize: '0.85rem',
                    color: 'var(--fdl-text, var(--fdl-navy-950))',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', paddingTop: '1px', flexShrink: 0 }}>
          <button
            id="examine-run-btn"
            onClick={() => handleRun(false)}
            disabled={loading || !selectedPromptId}
            style={{
              padding: '8px 16px', background: loading ? 'var(--fdl-muted)' : 'var(--fdl-accent, #1a56db)',
              color: '#ffffff', border: '1px solid transparent', borderRadius: 'var(--fdl-radius-sm, 2px)', fontWeight: 700,
              fontSize: '0.82rem', cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '7px',
              transition: 'all 0.15s ease',
            }}
          >
            {loading ? (
              <><span style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.4)', borderTop: '2px solid var(--fdl-paper)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Analyzing…</>
            ) : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Run Summarization</>
            )}
          </button>
          {result && (
            <button
              id="examine-refresh-btn"
              onClick={() => handleRun(true)}
              disabled={loading}
              title="Force a fresh AI generation (bypass cache)"
              style={{
                padding: '8px 12px', background: 'var(--fdl-surface, #ffffff)', color: 'var(--fdl-text, var(--fdl-ink-soft))',
                border: '1px solid var(--fdl-line, var(--fdl-line))', borderRadius: 'var(--fdl-radius-sm, 2px)', fontWeight: 700,
                fontSize: '0.82rem', cursor: loading ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s ease',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Refresh
            </button>
          )}
        </div>
      </div>
      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--fdl-red-050)', border: '1px solid var(--fdl-red-050)', borderRadius: 'var(--fdl-radius-sm, 2px)', color: 'var(--fdl-red)', fontSize: '0.84rem', marginBottom: '16px' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ background: 'var(--fdl-surface, var(--fdl-paper))', border: '1px solid var(--fdl-line, var(--fdl-line))', borderRadius: 'var(--fdl-radius-sm, 2px)', overflow: 'hidden' }}>
          <div style={{
            padding: '10px 18px',
            background: result.from_cache ? 'var(--fdl-green-050)' : 'var(--fdl-canvas, var(--fdl-blue-050))',
            borderBottom: '1px solid var(--fdl-line, var(--fdl-line))',
            display: 'flex', alignItems: 'center', gap: '16px',
            fontSize: '0.75rem', flexWrap: 'wrap' as const,
          }}>
            <span style={{ fontWeight: 700, color: result.from_cache ? 'var(--fdl-green)' : 'var(--fdl-blue-700)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              {result.from_cache ? 'Loaded from cache' : 'Freshly generated'}
            </span>
            <span style={{ color: 'var(--fdl-muted)' }}>Model: <strong style={{ color: 'var(--fdl-ink-soft)' }}>{result.model_used}</strong></span>
            <span style={{ color: 'var(--fdl-muted)' }}>{new Date(result.created_at).toLocaleString()}</span>
          </div>
          <div style={{ padding: '20px 24px' }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({children}) => <h1 style={{fontSize:'1.1rem',fontWeight:800,color:'var(--fdl-navy-950)',margin:'0 0 12px',borderBottom:'1px solid var(--fdl-line, var(--fdl-line))',paddingBottom:'6px'}}>{children}</h1>,
                h2: ({children}) => <h2 style={{fontSize:'0.98rem',fontWeight:700,color:'var(--fdl-ink)',margin:'18px 0 8px'}}>{children}</h2>,
                h3: ({children}) => <h3 style={{fontSize:'0.88rem',fontWeight:700,color:'var(--fdl-ink-soft)',margin:'14px 0 6px'}}>{children}</h3>,
                p:  ({children}) => <p  style={{margin:'0 0 10px',lineHeight:1.7,color:'var(--fdl-ink-soft)',fontSize:'0.87rem'}}>{children}</p>,
                ul: ({children}) => <ul style={{margin:'0 0 10px',paddingLeft:'18px',color:'var(--fdl-ink-soft)',fontSize:'0.87rem'}}>{children}</ul>,
                ol: ({children}) => <ol style={{margin:'0 0 10px',paddingLeft:'18px',color:'var(--fdl-ink-soft)',fontSize:'0.87rem'}}>{children}</ol>,
                li: ({children}) => <li style={{marginBottom:'4px',lineHeight:1.65}}>{children}</li>,
                strong: ({children}) => <strong style={{fontWeight:700,color:'var(--fdl-navy-950)'}}>{children}</strong>,
                blockquote: ({children}) => <blockquote style={{margin:'12px 0',padding:'12px 16px',borderLeft:'3px solid var(--fdl-accent, var(--fdl-blue-600))',background:'var(--fdl-canvas, var(--fdl-blue-050))',borderRadius:'0 2px 2px 0',color:'var(--fdl-text, var(--fdl-blue-700))',fontSize:'0.84rem',fontStyle:'italic'}}>{children}</blockquote>,
                code: ({children, ...props}) => {
                  const text = String(children);
                  if (text.startsWith('MDD::')) {
                    const value = text.slice(5);
                    return (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        background: 'var(--fdl-amber-050)', color: 'var(--fdl-amber)',
                        border: '1px solid var(--fdl-amber)',
                        borderRadius: 'var(--fdl-radius-sm, 2px)', padding: '1px 8px',
                        fontWeight: 700, fontSize: '0.85rem',
                        fontFamily: 'inherit', letterSpacing: '0.01em',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        {value}
                      </span>
                    );
                  }
                  return <code {...props}>{children}</code>;
                },
              }}
            >
              {result.answer.replace(/<MDD>(.*?)<\/MDD>/g, '`MDD::$1`')}
            </ReactMarkdown>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function ExamineView({ activeTab, setId, productData }: ExamineViewProps) {
  if (activeTab !== 'examine-view') return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0', animation: 'fadeIn 0.25s ease' }}>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <ClinicalQueryEngine setId={setId} />
    </div>
  );
}