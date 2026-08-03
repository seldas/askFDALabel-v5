import React, { useState, useEffect } from 'react';
import { useSearchContext } from '../context/SearchContext';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { saveAs } from 'file-saver';
import { withAppBase } from '../../utils/appPaths';
import { ExportWorkspaceModal } from '../../components/ExportWorkspaceModal';
import { useUser } from '../../context/UserContext';

const section: { [code: string]: string } = {
  "34066-1": "BOXED WARNING",
  "34067-9": "1 INDICATIONS AND USAGE",
  "34068-7": "2 DOSAGE AND ADMINISTRATION",
  "43678-2": "3 DOSAGE FORMS & STRENGTHS",
  "34070-3": "4 CONTRAINDICATIONS",
  "43685-7": "5 WARNINGS & PRECAUTIONS",
  "34084-4": "6 ADVERSE REACTIONS",
  "34073-7": "7 DRUG INTERACTIONS",
  "43684-0": "8 USE IN SPECIFIC POPULATIONS",
  "42227-9": "9 DRUG ABUSE AND DEPENDENCE",
  "34088-5": "10 OVERDOSAGE",
  "34089-3": "11 DESCRIPTION",
  "34090-1": "12 CLINICAL PHARMACOLOGY",
  "43680-8": "13 NONCLINICAL TOXICOLOGY",
  "34092-7": "14 CLINICAL STUDIES",
  "34093-5": "15 REFERENCES",
  "34069-5": "16 HOW SUPPLIED",
  "34076-0": "17 PATIENT COUNSELING",
};

const sectionOptions = Object.entries(section).map(([code, name]) => ({
  code,
  name
}));


interface ResultsProps {
  hasSearched: boolean;
}

interface ResultItem {
  PRODUCT_NAMES: string;
  GENERIC_NAMES: string;
  COMPANY: string;
  APPR_NUM: string;
  ACT_INGR_NAMES: string;
  MARKET_CATEGORIES: string;
  DOCUMENT_TYPE: string;
  Routes: string;
  DOSAGE_FORMS: string;
  EPC: string;
  NDC_CODES: string;
  set_id: string;
  similarity_score: number;
  keywords: string;
  section_code: string;
  section_content: string;
  RLD?: string;   // 'Yes' means RLD (may be missing)
  is_combination?: boolean;
  is_metadata_only?: boolean;
}

const SQLHighlighter = ({ sql }: { sql: string }) => {
  const tokens = sql.split(/(\s+|\(|\)|'[^']*'|,|\bAND\b|\bOR\b|\bLIKE\b|=|>|<|\bNOT\b|\bCONTAINS\b)/i);

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 6px',
      alignItems: 'center',
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      padding: '8px',
      backgroundColor: 'var(--afl-n-50)',
      borderRadius: '6px',
      lineHeight: '1.6'
    }}>
      {tokens.map((token, i) => {
        const t = token.trim();
        if (!t) return null;

        const upperT = t.toUpperCase();

        if (upperT === 'AND' || upperT === 'OR' || upperT === 'NOT') {
          const isOr = upperT === 'OR';
          return (
            <span key={i} style={{
              backgroundColor: isOr ? 'var(--afl-danger-50)' : 'var(--afl-n-50)',
              color: isOr ? 'var(--afl-danger-500)' : 'var(--afl-n-600)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: 700,
              fontSize: '0.7rem',
              border: `1px solid ${isOr ? 'var(--afl-danger-100)' : 'var(--afl-n-200)'}`,
              boxShadow: '0 1px 1px rgba(0,0,0,0.02)'
            }}>{upperT}</span>
          );
        }

        if (t === '(' || t === ')') {
          return (
            <span key={i} style={{
              color: 'var(--afl-info-500)',
              fontWeight: 800,
              fontSize: '1.1rem',
              padding: '0 2px'
            }}>{t}</span>
          );
        }

        if (t.startsWith("'") && t.endsWith("'")) {
          return (
            <span key={i} style={{
              color: 'var(--afl-success-700)',
              backgroundColor: 'var(--afl-success-50)',
              padding: '0 4px',
              borderRadius: '4px',
              border: '1px solid var(--afl-success-50)',
              fontSize: '0.85rem'
            }}>{t}</span>
          );
        }

        if (['=', 'LIKE', '>', '<', 'CONTAINS'].includes(upperT)) {
          return (
            <span key={i} style={{
              color: 'var(--afl-a-700)',
              fontWeight: 600,
              fontSize: '0.8rem',
              textTransform: 'uppercase'
            }}>{upperT}</span>
          );
        }

        if (t.includes('.') || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) {
          const isField = t.includes('.');
          return (
            <span key={i} style={{
              color: isField ? 'var(--afl-info-700)' : 'var(--afl-n-700)',
              fontWeight: isField ? 600 : 400,
              fontSize: '0.85rem'
            }}>{t}</span>
          );
        }

        return <span key={i} style={{ color: 'var(--afl-n-500)', fontSize: '0.85rem' }}>{t}</span>;
      })}
    </div>
  );
};

const SavedHistoriesView = () => {
  const { setChatHistory, setCurrentHistoryId, setHasUnsavedChanges } = useSearchContext();
  const [histories, setHistories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/search/history')
      .then(res => res.json())
      .then(data => {
        if (data.histories) setHistories(data.histories);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--afl-n-500)' }}>Loading saved histories...</div>;

  return (
    <div className="intro-section" style={{ padding: '40px 24px', maxWidth: '980px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '24px', color: 'var(--afl-n-900)' }}>Saved Conversations</h2>
      {histories.length === 0 ? (
        <div style={{ color: 'var(--afl-n-500)', fontSize: '1rem', background: 'var(--afl-n-50)', padding: '24px', borderRadius: '12px', border: '1px solid var(--afl-n-200)' }}>
          No saved conversations found. Start a search and click "Save Chat" to save your progress.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {histories.map(h => (
            <div key={h.id} 
              style={{
                padding: '20px', background: 'var(--afl-n-0)', borderRadius: '12px',
                border: '1px solid var(--afl-n-200)', cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
              }}
              onClick={() => {
                if (h.chat_data && h.chat_data.length > 0) {
                  setChatHistory(h.chat_data);
                  setCurrentHistoryId(h.id);
                  setHasUnsavedChanges(false);
                }
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--afl-info-500)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--afl-n-200)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05)'; }}
            >
              <div style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--afl-n-900)', marginBottom: '8px' }}>{h.title}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--afl-n-500)', display: 'flex', gap: '16px' }}>
                <span>📅 {new Date(h.timestamp + (h.timestamp.endsWith('Z') ? '' : 'Z')).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })}</span>
                <span>💬 {h.chat_data.length} messages</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


const Results: React.FC<ResultsProps> = ({ hasSearched }) => {
  const {
    setIds,
    setSetIds,
    setResults,
    setTotalResults,
    medAnswer,
    results: resultsRaw,
    totalResults: totalResultsRaw,
    currentPage,
    setCurrentPage,
    searchTerm,
    chatHistory,
    generatedSql,
    setGeneratedSql,
    setMedAnswer,
    highlightedSetId,
    searchMode,
    setSearchMode,
    agentFlow,
    reasoning,

    filters,
    setFilters,
    toggleFilterTerm,
    toggleFilterFlag,
    resultsLimit,
    setResultsLimit,
    resultsMessage,
    loadingStatus,

    isRefining,
    lastRefId,
    refineResponseWithLabel,

    // optional richer debug payloads (won’t break if not populated)
    debugIntent,
    debugPlan,
    debugStats,
    traceLog,
  } = useSearchContext();

  const isAgentic = searchMode === 'v2' || searchMode === 'v3';
  const isStandard = searchMode === 'v1';

  const baseResults = (resultsRaw as ResultItem[]);
  const results = baseResults.slice(0, resultsLimit);
  const totalResults = (totalResultsRaw > resultsLimit ? resultsLimit : totalResultsRaw);

  // --- Result limit warning (only show when we hit the backend cap) ---
  const inferredLimitRaw =
    (debugPlan && (debugPlan.limit ?? debugPlan.retrieval?.limit)) ??
    (debugStats && (debugStats.limit ?? debugStats.retrieval_limit)) ??
    null;

  const inferredLimit = (() => {
    const n = Number(inferredLimitRaw);
    return Number.isFinite(n) && n > 0 ? n : 100; // fallback to your common cap
  })();

  // "Hit the limit" = backend returned as many rows as it's willing to return
  const hitResultLimit = results.length >= inferredLimit;
  const [localResultsPerPage, setLocalResultsPerPage] = useState(10);
  const handlePerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = parseInt(e.target.value, 10);
    setLocalResultsPerPage(next);
    setCurrentPage(1);
  };

  const [viewStyle, setViewStyle] = useState('table');

  const [showReasoningPanel, setShowReasoningPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  const [editingComplexIndex, setEditingComplexIndex] = useState<number | null>(null);

  const { session } = useUser();
  const [showExportWorkspaceModal, setShowExportWorkspaceModal] = useState(false);

  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const handleItemSelection = (setId: string) => {
    setSelectedItems(prev => prev.includes(setId) ? prev.filter(id => id !== setId) : [...prev, setId]);
  };
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const [refError, setRefError] = useState<string | null>(null);

  const RefineButton = ({ setId, productName }: { setId: string, productName: string }) => {
    const isThisRefining = isRefining && loadingStatus.includes(productName);
    
    const handleRefineClick = () => {
      if (window.confirm(`Are you sure you want to refine the AI's last response using the document for ${productName}?`)) {
        refineResponseWithLabel(setId, productName);
      }
    };

    return (
      <button
        onClick={handleRefineClick}
        disabled={isRefining || chatHistory.length === 0}
        title={chatHistory.length === 0 ? "Send a message first to refine" : "Refine last response using this reference"}
        style={{
          background: isThisRefining ? 'var(--afl-warn-50)' : 'none',
          border: 'none',
          cursor: (isRefining || chatHistory.length === 0) ? 'not-allowed' : 'pointer',
          fontSize: '1.2rem',
          padding: '4px',
          borderRadius: '6px',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: (isRefining && !isThisRefining) ? 0.3 : 1
        }}
        className={isThisRefining ? "sparkle-animate" : ""}
      >
        {isThisRefining ? '⏳' : '✨'}
      </button>
    );
  };

  // Manual Filter Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const [newType, setNewType] = useState<'drugNames' | 'adverseEvents' | 'ndcs'>('drugNames');

  const AddFilterModal = () => {
    if (!isAddModalOpen) return null;

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(2px)'
      }}>
        <div style={{
          background: 'white',
          padding: '24px',
          borderRadius: '12px',
          width: '350px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
          border: '1px solid var(--afl-n-200)'
        }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 900, color: 'var(--afl-n-900)' }}>Add Manual Filter</h3>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: 'var(--afl-n-500)', textTransform: 'uppercase', marginBottom: '6px' }}>Filter Type</label>
            <select 
              value={newType} 
              onChange={(e) => setNewType(e.target.value as any)}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--afl-n-300)' }}
            >
              <option value="drugNames">💊 Drug Name</option>
              <option value="adverseEvents">⚠️ Adverse Event</option>
              <option value="ndcs">🔢 NDC Code</option>
            </select>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: 'var(--afl-n-500)', textTransform: 'uppercase', marginBottom: '6px' }}>Search Term</label>
            <input 
              type="text"
              autoFocus
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (newTerm.trim()) {
                    toggleFilterTerm(newType, newTerm.trim());
                    setIsAddModalOpen(false);
                    setNewTerm('');
                  }
                }
              }}
              placeholder="Enter keyword..."
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--afl-n-300)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button 
              onClick={() => { setIsAddModalOpen(false); setNewTerm(''); }}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--afl-n-200)', background: 'white', fontWeight: 700, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                if (newTerm.trim()) {
                  toggleFilterTerm(newType, newTerm.trim());
                  setIsAddModalOpen(false);
                  setNewTerm('');
                }
              }}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'var(--afl-n-700)', color: 'white', fontWeight: 700, cursor: 'pointer' }}
            >
              Add Filter
            </button>
          </div>
        </div>
      </div>
    );
  };

  const LimitControl = () => {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--afl-n-500)' }}>
        <span>Max results:</span>
        <select 
          value={resultsLimit} 
          onChange={(e) => setResultsLimit(parseInt(e.target.value))}
          style={{ padding: '2px 4px', borderRadius: '4px', border: '1px solid var(--afl-n-300)' }}
        >
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
          <option value={10000}>10000</option>
        </select>
      </div>
    );
  };

  const FilterChips = () => {
    const activeDrugNames = filters.drugNames || [];
    const activeAEs = filters.adverseEvents || [];
    const activeNDCs = filters.ndcs || [];

    // We always show the bar now, so users can add filters or toggle flags.
    // if (!hasFilters) return null;

    return (
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '16px',
        padding: '12px',
        background: 'var(--afl-n-50)',
        borderRadius: '10px',
        border: '1px solid var(--afl-n-200)'
      }}>
        <div style={{ width: '100%', fontSize: '0.75rem', fontWeight: 800, color: 'var(--afl-n-500)', textTransform: 'uppercase', marginBottom: '4px' }}>
          Active Search Filters
        </div>
        
        {activeDrugNames.map(term => (
          <div key={`drug-${term}`} className="filter-chip highlight-drug" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '4px 10px' }}>
            <span>💊 {term}</span>
            <button onClick={() => toggleFilterTerm('drugNames', term)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1 }}>×</button>
          </div>
        ))}

        {activeAEs.map(term => (
          <div key={`ae-${term}`} className="filter-chip highlight-adverse_events" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '4px 10px' }}>
            <span>⚠️ {term}</span>
            <button onClick={() => toggleFilterTerm('adverseEvents', term)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1 }}>×</button>
          </div>
        ))}

        {activeNDCs.map(term => (
          <div key={`ndc-${term}`} className="filter-chip highlight-ndc" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '4px 10px' }}>
            <span>🔢 {term}</span>
            <button onClick={() => toggleFilterTerm('ndcs', term)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1 }}>×</button>
          </div>
        ))}

        {/* Hard-coded Flags Row */}
        <div style={{ width: '100%', borderTop: '1px solid var(--afl-n-200)', margin: '4px 0', paddingTop: '8px', display: 'flex', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 700, color: 'var(--afl-n-700)', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={filters.isRx} 
              onChange={() => toggleFilterFlag('isRx')} 
              style={{ cursor: 'pointer' }}
            />
            Rx Only
          </label>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <LimitControl />
          <button 
            onClick={() => setIsAddModalOpen(true)}
            style={{
              background: 'var(--afl-n-700)',
              border: 'none',
              color: 'white',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '4px 12px',
              borderRadius: '6px'
            }}
          >
            + Add Filter
          </button>

          <button 
            onClick={() => {
              // @ts-ignore
              setFilters(prev => ({ 
                ...prev, 
                drugNames: [], 
                adverseEvents: [], 
                ndcs: [],
                isRx: false
              }));
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--afl-danger-500)',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Clear All
          </button>
        </div>
      </div>
    );
  };

  
  // Highlighting with pagination support
  useEffect(() => {
    if (highlightedSetId && results.length > 0) {
      const index = results.findIndex(r => r.set_id === highlightedSetId);

      if (index !== -1) {
        setRefError(null);
        const targetPage = Math.ceil((index + 1) / localResultsPerPage);

        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        }

        const tryScroll = (attempts = 0) => {
          const element = document.getElementById(`result-${highlightedSetId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('highlight-pulse');
            setTimeout(() => element.classList.remove('highlight-pulse'), 2000);
          } else if (attempts < 5) {
            setTimeout(() => tryScroll(attempts + 1), 100);
          }
        };

        setTimeout(tryScroll, 100);
      } else {
        setRefError(`The reference (ID: ${highlightedSetId}) is no longer available in the current search results due to a recent query update.`);
        const timer = setTimeout(() => setRefError(null), 8000);
        return () => clearTimeout(timer);
      }
    }
  }, [highlightedSetId, results, localResultsPerPage, currentPage, setCurrentPage]);

  // -----------------------
  // SQL Editor State (V1 only)
  // -----------------------
  const [localSql, setLocalSql] = useState('');
  const [isSqlRunning, setIsSqlRunning] = useState(false);

  const [baseQuery, setBaseQuery] = useState('');
  const [sqlSuffix, setSqlSuffix] = useState(''); // preserve ORDER BY / outer WHERE etc
  const [conditions, setConditions] = useState<any[]>([]);

  useEffect(() => {
    // Only parse/build conditions for V1 filter editing.
    if (!isStandard) return;

    if (generatedSql) {
      setLocalSql(generatedSql);
      parseSqlToConditions(generatedSql);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedSql, isStandard]);

  const ensureLabelSectionCondition = (conds: any[]) => {
    const has = conds.some(c => c.type === 'simple' && (c.field || '').toUpperCase() === 'S.LOINC_CODE');
    if (has) return conds;

    return [
      ...conds,
      {
        id: conds.length,
        type: 'simple',
        field: 's.LOINC_CODE',
        operator: 'IN',
        value: [],
        raw: '',
        disabled: true
      }
    ];
  };

  /**
   * Improved SQL parsing:
   * - edits only the *first* WHERE block
   * - preserves suffix like "ORDER BY ... ) WHERE ROWNUM <= ..."
   */
  const parseSqlToConditions = (sql: string) => {
    try {
      const whereIndex = sql.search(/\bWHERE\b/i);
      if (whereIndex === -1) {
        setBaseQuery(sql);
        setSqlSuffix('');
        setConditions([]);
        return;
      }

      const base = sql.substring(0, whereIndex).trim();
      const afterWhere = sql.substring(whereIndex + 5); // after "WHERE"

      // Find end of the editable WHERE region
      const endCandidates: number[] = [];
      const orderIdx = afterWhere.search(/\bORDER\s+BY\b/i);
      const groupIdx = afterWhere.search(/\bGROUP\s+BY\b/i);
      const outerWhereIdx = afterWhere.search(/\)\s*WHERE\b/i);

      if (orderIdx !== -1) endCandidates.push(orderIdx);
      if (groupIdx !== -1) endCandidates.push(groupIdx);
      if (outerWhereIdx !== -1) endCandidates.push(outerWhereIdx);

      const endRel = endCandidates.length ? Math.min(...endCandidates) : afterWhere.length;

      const whereOnly = afterWhere.substring(0, endRel).trim();
      const suffix = afterWhere.substring(endRel); // keep everything else
      setBaseQuery(base);
      setSqlSuffix(suffix || '');

      const parts = whereOnly.split(/\s+AND\s+(?![^()]*\))/i);

      const parsedConditions = parts.map((part, index) => {
        const trimmed = part.trim();

        const simpleMatch = trimmed.match(/^(?:UPPER\s*\(\s*)?([a-zA-Z0-9_.]+)(?:\s*\))?\s+(=|LIKE|NOT\s+LIKE)\s+(?:UPPER\s*\(\s*)?'([^']*)'(?:\s*\))?$/i);
        if (simpleMatch) {
          return {
            id: index,
            type: 'simple',
            field: simpleMatch[1],
            operator: simpleMatch[2].toUpperCase(),
            value: simpleMatch[3],
            raw: trimmed
          };
        }

        const inMatch = trimmed.match(/^(?:UPPER\s*\(\s*)?([a-zA-Z0-9_.]+)(?:\s*\))?\s+IN\s*\(\s*([^)]+?)\s*\)\s*$/i);
        if (inMatch) {
          const field = inMatch[1];
          const listRaw = inMatch[2];
          const values = Array.from(listRaw.matchAll(/'([^']*)'/g)).map(m => m[1]);
          return {
            id: index,
            type: 'simple',
            field,
            operator: 'IN',
            value: values,
            raw: trimmed
          };
        }

        const containsMatch = trimmed.match(/^CONTAINS\s*\(\s*s\.CONTENT_XML\s*,\s*'([^']*)'\s*\)\s*>\s*0$/i);
        if (containsMatch) {
          return {
            id: index,
            type: 'contains',
            field: 's.CONTENT_XML',
            operator: 'CONTAINS',
            value: containsMatch[1],
            raw: trimmed
          };
        }

        return { id: index, type: 'complex', raw: trimmed };
      });

      setConditions(ensureLabelSectionCondition(parsedConditions));
    } catch (e) {
      console.error("Failed to parse SQL:", e);
      setBaseQuery(sql);
      setSqlSuffix('');
      setConditions([]);
    }
  };

  const reconstructSql = (base: string, currentConditions: any[]) => {
    const activeConditions = currentConditions.filter(c => c.raw && c.raw.trim() && !c.disabled);

    if (activeConditions.length === 0) {
      const newSql = base + (sqlSuffix ? ` ${sqlSuffix.trimStart()}` : '');
      setLocalSql(newSql);
      setGeneratedSql(newSql);
      return;
    }

    const whereString = activeConditions.map(c => c.raw.trim()).join(' AND ');
    const newSql = `${base} WHERE ${whereString}${sqlSuffix ? ` ${sqlSuffix.trimStart()}` : ''}`;
    setLocalSql(newSql);
    setGeneratedSql(newSql);
  };

  const updateCondition = (index: number, updates: any) => {
    const newConditions = [...conditions];
    const oldCond = newConditions[index];
    const newCond = { ...oldCond, ...updates };

    if (newCond.type === 'simple') {
      if (newCond.operator === 'IN' && Array.isArray(newCond.value)) {
        const vals = Array.isArray(newCond.value) ? newCond.value : [];
        if (vals.length === 0) {
          newCond.disabled = true;
          newCond.raw = '';
        } else {
          newCond.disabled = false;
          const quoted = vals.map((v: string) => `'${v}'`).join(',');
          newCond.raw = `${newCond.field} IN (${quoted})`;
        }
      } else if ((newCond.operator || '').includes('LIKE')) {
        newCond.raw = `UPPER(${newCond.field}) ${newCond.operator} UPPER('${newCond.value}')`;
      } else {
        newCond.raw = `${newCond.field} ${newCond.operator} '${newCond.value}'`;
      }
    } else if (newCond.type === 'contains') {
      newCond.raw = `CONTAINS(s.CONTENT_XML, '${newCond.value}') > 0`;
    } else {
      newCond.raw = updates.raw;
    }

    newConditions[index] = newCond;
    setConditions(newConditions);
    reconstructSql(baseQuery, newConditions);
  };

  const removeCondition = (index: number) => {
    const newConditions = conditions.filter((_, i) => i !== index);
    setConditions(newConditions);
    reconstructSql(baseQuery, newConditions);
  };

  const handleRunSql = async () => {
    if (!localSql.trim()) return;
    setIsSqlRunning(true);
    setRefError(null);

    try {
      const response = await fetch("/api/search/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual_sql: localSql }),
      });

      const jsonData = await response.json();

      if (jsonData.error) {
        if (jsonData.error.includes("internet environment")) {
            setMedAnswer(jsonData.error);
        } else {
            alert(`Error: ${jsonData.error}`);
        }
        setIsSqlRunning(false);
        return;
      }

      if (jsonData.results) {
        const extractedIds = (jsonData.results || []).map((r: any) => r?.SET_ID || r?.set_id || "");
        setSetIds(extractedIds);
        setTotalResults(jsonData.total_counts);
        setMedAnswer(jsonData.med_answer || "Query executed successfully.");
        setGeneratedSql(localSql);
        await fetchMetadata(1, jsonData.results);
      } else {
        setResults([]);
        setTotalResults(0);
        setSetIds([]);
        setMedAnswer("No results found for this SQL query.");
      }
    } catch (error) {
      console.error("Error running manual SQL:", error);
      alert("An unexpected error occurred.");
    } finally {
      setIsSqlRunning(false);
    }
  };

  const fetchMetadata = async (page: number, allSetIds: string[]) => {
    try {
      const response = await fetch("/api/search/get_metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set_ids: allSetIds }),
      });

      const data = await response.json();
      if (data && data.results) {
        setResults(data.results);
        setTotalResults(data.results.length);
        setCurrentPage(1);
      } else {
        setResults([]);
        setTotalResults(0);
      }
    } catch (error) {
      console.error("Error fetching metadata:", error);
      setResults([]);
      setTotalResults(0);
    }
  };



  const totalPages = Math.ceil(totalResults / localResultsPerPage);
  const startIndex = (currentPage - 1) * localResultsPerPage;
  const paginatedResults = results.slice(startIndex, startIndex + localResultsPerPage);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allPaginatedIds = paginatedResults.map(r => r.set_id);
      setSelectedItems(prev => [...new Set([...prev, ...allPaginatedIds])]);
    } else {
      const paginatedIdsSet = new Set(paginatedResults.map(r => r.set_id));
      setSelectedItems(prev => prev.filter(id => !paginatedIdsSet.has(id)));
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleJsonExport = async () => {
    setIsExporting(true);
    setShowExportMenu(false);

    try {
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');

      const resultsToExport = selectedItems.length > 0
        ? results.filter(r => selectedItems.includes(r.set_id))
        : results;

      if (resultsToExport.length === 0) {
        alert("No items to export. Please select at least one item.");
        setIsExporting(false);
        return;
      }

      const recordsToProcess = resultsToExport.slice(0, 5);
      const setIdsToFetch = recordsToProcess.map(r => r.set_id);

      const response = await fetch('/api/search/export_xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set_ids: setIdsToFetch }),
      });

      if (!response.ok) throw new Error('Failed to fetch XML content from backend.');

      const xmlContentMap = await response.json();

      const exportData = resultsToExport.map(result => ({
        Product: result.PRODUCT_NAMES,
        Generic: result.GENERIC_NAMES,
        Company: result.COMPANY,
        ApplicationNumber: result.APPR_NUM,
        Ingredients: result.ACT_INGR_NAMES,
        MarketCategory: result.MARKET_CATEGORIES,
        DocumentType: result.DOCUMENT_TYPE,
        Routes: result.Routes,
        DosageForms: result.DOSAGE_FORMS,
        EPC: result.EPC,
        NDCCodes: result.NDC_CODES,
        SetID: result.set_id,
        XML_Content: xmlContentMap[result.set_id] || 'Not fetched (only top 5 are included)',
      }));

      const finalExportObject = {
        exportInfo: {
          timestamp: now.toISOString(),
          userQuery: searchTerm,
          aiRationale: medAnswer,
        },
        results: exportData,
      };

      const jsonString = JSON.stringify(finalExportObject, null, 2);
      const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
      saveAs(blob, `askFDALabel_results_${timestamp}.json`);
    } catch (error) {
      console.error("Failed to export results:", error);
      alert("Export failed. See console for details.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExcelExport = async () => {
    setIsExporting(true);
    setShowExportMenu(false);

    try {
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');

      const resultsToExport = selectedItems.length > 0
        ? results.filter(r => selectedItems.includes(r.set_id))
        : results;

      if (resultsToExport.length === 0) {
        alert("No items to export. Please select at least one item.");
        setIsExporting(false);
        return;
      }

      const exportData = resultsToExport.map(result => ({
        Product: result.PRODUCT_NAMES,
        Generic: result.GENERIC_NAMES,
        Company: result.COMPANY,
        ApplicationNumber: result.APPR_NUM,
        Ingredients: result.ACT_INGR_NAMES,
        MarketCategory: result.MARKET_CATEGORIES,
        DocumentType: result.DOCUMENT_TYPE,
        Routes: result.Routes,
        DosageForms: result.DOSAGE_FORMS,
        EPC: result.EPC,
        NDCCodes: result.NDC_CODES,
        SetID: result.set_id,
      }));

      const response = await fetch('/api/search/export_excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ export_data: exportData }),
      });

      if (!response.ok) throw new Error('Failed to fetch Excel content from backend.');

      const blob = await response.blob();
      saveAs(blob, `askFDALabel_export_${timestamp}.xlsx`);
    } catch (error) {
      console.error("Failed to Excel export:", error);
      alert("Excel export failed. See console for details.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDashboardExportClick = () => {
    setShowExportMenu(false);
    setShowExportWorkspaceModal(true);
  };

  const handleDashboardExportConfirm = async (exportData: { taskId?: number; taskName?: string; tags?: string }) => {
    setShowExportWorkspaceModal(false);
    setIsExporting(true);

    const resultsToExport = selectedItems.length > 0
      ? results.filter(r => selectedItems.includes(r.set_id))
      : results;

    if (resultsToExport.length === 0) {
      alert("No items to export.");
      setIsExporting(false);
      return;
    }

    const labelsData = resultsToExport.map(r => ({
        set_id: r.set_id,
        brand_name: r.PRODUCT_NAMES,
        generic_name: r.GENERIC_NAMES,
        manufacturer_name: r.COMPANY,
        market_category: r.MARKET_CATEGORIES,
        application_number: r.APPR_NUM,
        ndc: r.NDC_CODES,
        effective_time: '',
        source: 'OpenFDA'
    }));

    try {
        const payload: any = {
            labels_data: labelsData
        };
        if (exportData.taskId) {
            payload.project_id = exportData.taskId;
        } else if (exportData.taskName) {
            payload.new_project_name = exportData.taskName;
        }
        if (exportData.tags) {
            payload.tags = exportData.tags;
        }

        const response = await fetch('/api/dashboard/favorite_all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.success) {
            const labelText = data.added_count === 1 ? 'label' : 'labels';
            const actionText = exportData.taskId ? 'updated' : 'created';
            if (window.confirm(`Task "${data.project_title}" ${actionText} successfully with ${data.added_count} ${labelText}!\n\nWould you like to open the dashboard in a new window?`)) {
                window.open(withAppBase('/dashboard'), '_blank', 'noopener,noreferrer');
            }
        } else {
            alert(`Error: ${data.error || 'Failed to export to task'}`);
        }
    } catch (error) {
        console.error("Export to Dashboard Error:", error);
        alert("Failed to export to dashboard.");
    } finally {
        setIsExporting(false);
    }
  };

  // Pagination buttons
  const delta = 2;
  const pageNumbers: (number | string)[] = [];

  if (currentPage > 1 + delta) {
    pageNumbers.push(1);
    if (currentPage > 2 + delta) pageNumbers.push("...");
  }

  for (let i = Math.max(1, currentPage - delta); i <= Math.min(totalPages, currentPage + delta); i++) {
    pageNumbers.push(i);
  }

  if (currentPage < totalPages - delta) {
    if (currentPage < totalPages - delta - 1) pageNumbers.push("...");
    pageNumbers.push(totalPages);
  }

  if (chatHistory.length === 0) {
    return <SavedHistoriesView />;
  }

  // Friendly names (for filter panel)
  const getFriendlyName = (field: string) => {
    const map: { [key: string]: string } = {
      'r.PRODUCT_NAMES': 'Brand Name',
      'r.AUTHOR_ORG_NORMD_NAME': 'Manufacturer',
      'r.EPC': 'Pharm. Class',
      's.LOINC_CODE': 'Label Section',
      's.CONTENT_XML': 'Section Text',
      'r.DOCUMENT_TYPE': 'Doc Type'
    };
    return map[field] || field;
  };

  // -----------------------
  // Reasoning Panel (Agentic modes)
  // -----------------------
  const ReasoningPanel = () => {
    const intentType =
      (debugIntent && (debugIntent.type || debugIntent.intent?.type || debugIntent.intent)) ||
      '—';

    const planType =
      (debugPlan && (debugPlan.plan_type || debugPlan.retrieval?.plan_type || (debugPlan.pipeline ? debugPlan.pipeline.join(' -> ') : null))) ||
      '—';

    const templateHint =
      (debugPlan && (debugPlan.sql_template_hint || debugPlan.retrieval?.sql_template_hint)) ||
      '—';

    const snippetsReturned =
      (debugStats && (debugStats.snippets_returned ?? debugStats.snippet_count ?? debugStats.evidence_count)) ??
      null;

    const evidenceFetched =
      snippetsReturned !== null ? (snippetsReturned > 0 ? 'Yes' : 'No') : '—';

    return (
      <div style={{ padding: 16, background: 'var(--afl-n-50)', borderRadius: 10, border: '1px solid var(--afl-n-200)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: 'var(--afl-n-700)' }}>Reasoning</h3>
          <button
            onClick={() => setShowReasoningPanel(prev => !prev)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.85rem',
              color: '#0077cc',
              textDecoration: 'underline'
            }}
          >
            {showReasoningPanel ? '(Hide)' : '(Show)'}
          </button>
        </div>

        {showReasoningPanel && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div style={{ border: '1px solid var(--afl-n-200)', borderRadius: 10, padding: 10, background: 'var(--afl-n-0)' }}>
                <div style={{ fontSize: 12, color: 'var(--afl-n-500)', fontWeight: 800, textTransform: 'uppercase' }}>Intent</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--afl-n-900)' }}>{String(intentType)}</div>
              </div>
              <div style={{ border: '1px solid var(--afl-n-200)', borderRadius: 10, padding: 10, background: 'var(--afl-n-0)' }}>
                <div style={{ fontSize: 12, color: 'var(--afl-n-500)', fontWeight: 800, textTransform: 'uppercase' }}>Evidence fetched</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--afl-n-900)' }}>{evidenceFetched}</div>
              </div>
              <div style={{ border: '1px solid var(--afl-n-200)', borderRadius: 10, padding: 10, background: 'var(--afl-n-0)' }}>
                <div style={{ fontSize: 12, color: 'var(--afl-n-500)', fontWeight: 800, textTransform: 'uppercase' }}>Strategy</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--afl-n-900)' }}>{String(planType)}</div>
              </div>
              <div style={{ border: '1px solid var(--afl-n-200)', borderRadius: 10, padding: 10, background: 'var(--afl-n-0)' }}>
                <div style={{ fontSize: 12, color: 'var(--afl-n-500)', fontWeight: 800, textTransform: 'uppercase' }}>Details</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--afl-n-900)' }}>{templateHint}</div>
              </div>
            </div>

            {/* Agent flow */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--afl-n-500)', fontWeight: 900, textTransform: 'uppercase', marginBottom: 8 }}>
                Agent flow
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(agentFlow || []).map((step, idx) => (
                  <span
                    key={idx}
                    style={{
                      padding: '4px 10px',
                      background: 'var(--afl-info-50)',
                      color: 'var(--afl-info-700)',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 800,
                      border: '1px solid var(--afl-info-100)',
                    }}
                  >
                    {step}
                  </span>
                ))}
              </div>
            </div>

            {/* Narrative */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--afl-n-500)', fontWeight: 900, textTransform: 'uppercase', marginBottom: 8 }}>
                Explanation
              </div>
              <div style={{ background: 'var(--afl-n-0)', border: '1px solid var(--afl-n-200)', borderRadius: 10, padding: 12, lineHeight: 1.6 }}>
                {reasoning
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{reasoning}</ReactMarkdown>
                  : <em>No reasoning available.</em>
                }
              </div>
            </div>

            {/* Trace log (optional) */}
            {(traceLog || []).length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 900, color: 'var(--afl-n-700)' }}>Show trace log</summary>
                <div style={{ marginTop: 10, background: 'var(--afl-n-0)', border: '1px solid var(--afl-n-200)', borderRadius: 10, padding: 12 }}>
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--afl-n-700)' }}>
                    {traceLog.map((t, i) => (
                      <li key={i} style={{ marginBottom: 6, fontSize: 13 }}>{t}</li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            {/* Generated SQL */}
            {generatedSql && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 900, color: 'var(--afl-n-700)' }}>Show generated SQL</summary>
                <div style={{ marginTop: 10 }}>
                  <SQLHighlighter sql={generatedSql} />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    );
  };

  // -----------------------
  // Filter Panel (Standard only)
  // -----------------------
  const FilterPanel = () => {
    return (
      <div className="sql-editor-container">
        <div className="sql-editor-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>Active Filters</span>
            <button
              onClick={() => setShowFilterPanel(prev => !prev)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8rem',
                color: '#0077cc',
                textDecoration: 'underline'
              }}
            >
              {showFilterPanel ? '(Hide)' : '(Show)'}
            </button>
          </div>

          <button
            className="sql-run-btn"
            onClick={handleRunSql}
            disabled={isSqlRunning}
          >
            {isSqlRunning ? 'Running...' : 'Update Results'}
          </button>
        </div>

        {showFilterPanel && (
          <div style={{ padding: '16px', backgroundColor: 'var(--afl-n-50)' }}>
            {conditions.map((cond, i) => (
              <div key={i} style={{ position: 'relative' }}>
                {i > 0 && (
                  <div style={{
                    height: '24px',
                    borderLeft: '2px dashed var(--afl-n-300)',
                    marginLeft: '24px',
                    position: 'relative'
                  }}>
                    <span style={{
                      position: 'absolute',
                      top: '50%',
                      left: '-14px',
                      transform: 'translateY(-50%)',
                      backgroundColor: 'var(--afl-n-0)',
                      padding: '2px 6px',
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      color: 'var(--afl-n-500)',
                      border: '1px solid var(--afl-n-200)',
                      borderRadius: '12px'
                    }}>AND</span>
                  </div>
                )}

                <div style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'center',
                  padding: '12px',
                  backgroundColor: 'var(--afl-n-0)',
                  borderRadius: '8px',
                  border: '1px solid var(--afl-n-200)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: cond.type === 'complex' ? 'var(--afl-warn-50)' : 'var(--afl-info-50)',
                    color: cond.type === 'complex' ? 'var(--afl-warn-700)' : 'var(--afl-info-700)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem'
                  }}>
                    {cond.type === 'contains' ? 'T' : cond.type === 'complex' ? '⚡' : 'F'}
                  </div>

                  {cond.type === 'simple' && (() => {
                    const isLabelSection = (cond.field || '').toUpperCase() === 'S.LOINC_CODE';
                    const selectedCodes: string[] = Array.isArray(cond.value)
                      ? cond.value
                      : (typeof cond.value === 'string' && cond.value ? [cond.value] : []);

                    return (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: '140px' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--afl-n-500)', textTransform: 'uppercase', fontWeight: 600 }}>Field</span>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--afl-n-700)' }}>
                            {getFriendlyName(cond.field)}
                          </span>
                        </div>

                        {isLabelSection ? (
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--afl-n-500)', textTransform: 'uppercase', fontWeight: 600 }}>
                              Sections
                            </span>

                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '8px',
                                padding: '8px',
                                border: '1px solid var(--afl-n-300)',
                                borderRadius: '8px',
                                background: 'var(--afl-n-0)',
                                minHeight: '44px',
                                alignItems: 'flex-start'
                              }}
                            >
                              {sectionOptions.map(({ code, name }) => {
                                const isSelected = selectedCodes.includes(code);

                                return (
                                  <button
                                    key={code}
                                    type="button"
                                    className="section-badge"
                                    data-tooltip={name}
                                    onClick={() => {
                                      const next = isSelected
                                        ? selectedCodes.filter(v => v !== code)
                                        : [...selectedCodes, code];

                                      updateCondition(i, {
                                        operator: 'IN',
                                        value: next,
                                        disabled: next.length === 0
                                      });
                                    }}
                                    style={{
                                      cursor: 'pointer',
                                      borderRadius: '999px',
                                      padding: '6px 10px',
                                      fontSize: '0.85rem',
                                      border: `1px solid ${isSelected ? 'var(--afl-info-500)' : 'var(--afl-n-300)'}`,
                                      backgroundColor: isSelected ? 'var(--afl-info-50)' : 'var(--afl-n-50)',
                                      color: isSelected ? 'var(--afl-info-700)' : 'var(--afl-n-700)',
                                      fontWeight: isSelected ? 700 : 600,
                                      boxShadow: isSelected ? '0 1px 2px rgba(29,78,216,0.15)' : 'none',
                                      transition: 'all 0.15s ease'
                                    }}
                                  >
                                    {code}
                                  </button>
                                );
                              })}

                              {selectedCodes.length === 0 && (
                                <span style={{ color: 'var(--afl-n-400)', fontStyle: 'italic', padding: '6px 4px' }}>
                                  Select one or more sections
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', flexDirection: 'column', width: '110px' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--afl-n-500)', textTransform: 'uppercase', fontWeight: 600 }}>Condition</span>
                              <select
                                value={cond.operator}
                                onChange={(e) => updateCondition(i, { operator: e.target.value })}
                                style={{ padding: '6px', borderRadius: '6px', borderColor: 'var(--afl-n-300)', fontSize: '0.9rem' }}
                              >
                                <option value="=">Equals</option>
                                <option value="LIKE">Contains</option>
                                <option value="NOT LIKE">Excludes</option>
                              </select>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--afl-n-500)', textTransform: 'uppercase', fontWeight: 600 }}>Value</span>
                              <input
                                type="text"
                                value={cond.value}
                                onChange={(e) => updateCondition(i, { value: e.target.value })}
                                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.9rem' }}
                              />
                            </div>
                          </>
                        )}

                        <button
                          onClick={() => removeCondition(i)}
                          title="Remove condition"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--afl-danger-500)', fontSize: '1.2rem', padding: '0 4px', marginLeft: '4px' }}
                        >
                          ✕
                        </button>
                      </>
                    );
                  })()}

                  {cond.type === 'contains' && (
                    <>
                      <div className="filter-textsearch" style={{ flex: 1 }}>
                        <div className="filter-textsearch__label">
                          <span className="filter-textsearch__hint">section content</span>
                        </div>

                        <span className="filter-textsearch__op">contains</span>

                        <div className="filter-textsearch__inputShell">
                          <span className="filter-textsearch__icon">🔎</span>
                          <input
                            className="filter-textsearch__input"
                            type="text"
                            value={cond.value}
                            onChange={(e) => updateCondition(i, { value: e.target.value })}
                            placeholder="ibuprofen, aspirin, nausea..."
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => removeCondition(i)}
                        title="Remove full text filter"
                        className="filter-textsearch__remove"
                      >
                        ✕
                      </button>
                    </>
                  )}

                  {cond.type === 'complex' && (
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--afl-warn-700)', fontWeight: 700, textTransform: 'uppercase' }}>Advanced Logic (OR / Group)</span>
                          <button
                            onClick={() => setEditingComplexIndex(editingComplexIndex === i ? null : i)}
                            style={{
                              background: 'var(--afl-warn-50)',
                              border: '1px solid var(--afl-warn-500)',
                              borderRadius: '4px',
                              padding: '2px 8px',
                              fontSize: '0.7rem',
                              color: 'var(--afl-warn-700)',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            {editingComplexIndex === i ? 'View Logic' : 'Edit Text'}
                          </button>
                        </div>
                        <button
                          onClick={() => removeCondition(i)}
                          title="Remove condition"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--afl-danger-500)', fontSize: '1rem', fontWeight: 'bold' }}
                        >
                          Remove ✕
                        </button>
                      </div>

                      {editingComplexIndex === i ? (
                        <input
                          type="text"
                          value={cond.raw}
                          onChange={(e) => updateCondition(i, { raw: e.target.value })}
                          style={{ width: '100%', fontFamily: 'monospace', padding: '8px', borderRadius: '6px', border: '1px solid var(--afl-warn-500)', backgroundColor: 'var(--afl-warn-50)', color: 'var(--afl-warn-700)', fontSize: '0.85rem' }}
                          autoFocus
                        />
                      ) : (
                        <div onClick={() => setEditingComplexIndex(i)} style={{ cursor: 'pointer' }}>
                          <SQLHighlighter sql={cond.raw} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {conditions.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--afl-n-400)', fontStyle: 'italic', border: '2px dashed var(--afl-n-200)', borderRadius: '8px' }}>
                No active filters. Displaying all records.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="search-results">
      {/* ✅ Agentic modes (V2 & V3): show Reasoning panel ONLY */}
      {isAgentic && <ReasoningPanel />}

      {/* ✅ Standard mode (V1): show Filter panel ONLY */}
      {isStandard && <FilterPanel />}

      <FilterChips />

      {resultsMessage && (
        <div
          style={{
            background: 'var(--afl-warn-50)',
            border: '1px solid var(--afl-warn-500)',
            color: 'var(--afl-warn-700)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            fontWeight: 700
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>⚠️</span>
          <span>{resultsMessage}</span>
        </div>
      )}

      {refError && (
        <div
          className="med-answer-container"
          style={{
            backgroundColor: 'var(--afl-danger-50)',
            color: 'var(--afl-danger-500)',
            border: '1px solid var(--afl-danger-100)',
            borderRadius: '5px',
            padding: '10px 15px',
            marginBottom: '15px',
            fontSize: '0.9rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>⚠️ {refError}</span>
          <button
            onClick={() => setRefError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--afl-n-400)', fontSize: '1.2rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {(setIds.length === 0 && results.length === 0) ? (
        <div
          className="med-answer-container"
          style={{
            backgroundColor: 'var(--afl-warn-50)',
            color: 'var(--afl-warn-700)',
            border: '1px solid var(--afl-warn-500)',
            borderRadius: '5px',
            padding: '15px',
            marginBottom: '20px'
          }}
        >
          <div className="result-count" style={{ fontWeight: 'bold', textAlign: 'center' }}>
            {((filters.drugNames?.length ?? 0) > 0 || (filters.adverseEvents?.length ?? 0) > 0 || (filters.ndcs?.length ?? 0) > 0 || (filters.labelingType?.length ?? 0) > 0)
              ? "No labeling documents found matching your current filters."
              : "Relevant labeling will be displayed here."
            }
          </div>
        </div>
      ) : (
        <>
        <div className="result-count">Displaying {paginatedResults.length} of {totalResults} results</div>

          <div className="pagination-toolbar">
            <div className="pagination">
              {pageNumbers.map((page, i) => (
                <button
                  key={i}
                  className={`page-button ${currentPage === page ? 'active' : ''}`}
                  onClick={() => typeof page === 'number' && handlePageChange(page)}
                  disabled={currentPage === page || page === '...'}
                >
                  {page}
                </button>
              ))}
            </div>

            <div className="controls-wrapper">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--afl-n-600)', fontWeight: 700 }}>Per page</span>
                <select
                  value={localResultsPerPage}
                  onChange={handlePerPageChange}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--afl-n-200)',
                    background: 'var(--afl-n-0)',
                    fontWeight: 700,
                    color: 'var(--afl-n-900)',
                    cursor: 'pointer'
                  }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div className="view-switcher">
                <button
                  onClick={() => setViewStyle('panel')}
                  className={viewStyle === 'panel' ? 'active' : ''}
                >
                  Panel
                </button>
                <button
                  onClick={() => setViewStyle('table')}
                  className={viewStyle === 'table' ? 'active' : ''}
                >
                  Table
                </button>
              </div>

              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  className="export-button"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={isExporting}
                  title="Export options"
                >
                  {isExporting ? 'Exporting...' : 'Export ▼'}
                </button>

                {showExportMenu && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '4px',
                    backgroundColor: 'white',
                    borderRadius: '6px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    border: '1px solid var(--afl-n-200)',
                    zIndex: 50,
                    minWidth: '160px',
                    overflow: 'hidden'
                  }}>
                    <button
                      onClick={handleJsonExport}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 16px',
                        fontSize: '0.875rem',
                        color: 'var(--afl-n-700)',
                        backgroundColor: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--afl-n-100)'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--afl-n-50)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
                    >
                      JSON (Results + XML)
                    </button>

                    <button
                      onClick={handleExcelExport}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 16px',
                        fontSize: '0.875rem',
                        color: 'var(--afl-n-700)',
                        backgroundColor: 'white',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--afl-n-50)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
                    >
                      Excel (Template)
                    </button>

                    {session?.is_authenticated && (
                      <button
                        onClick={handleDashboardExportClick}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 16px',
                          fontSize: '0.875rem',
                          color: 'var(--afl-info-500)',
                          backgroundColor: 'white',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 600,
                          borderTop: '1px solid var(--afl-n-100)'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--afl-n-50)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
                      >
                        Export to Dashboard
                      </button>
                    )}
                  </div>
                )}

                {showExportMenu && (
                  <div
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
                    onClick={() => setShowExportMenu(false)}
                  />
                )}
              </div>
            </div>
          </div>

          {viewStyle === 'panel' && paginatedResults.map((result, index) => {
            const actualResultNumber = (currentPage - 1) * localResultsPerPage + index + 1;
            const isHighlighted = result.set_id === highlightedSetId;
            const isLastRef = result.set_id === lastRefId;

            return (
              <div
                key={index}
                id={`result-${result.set_id}`}
                className={`result-item p-4 border-b border-gray-200 ${isHighlighted ? 'highlighted-result' : ''} ${isLastRef ? 'reference-popout' : ''}`}
                style={{
                  position: 'relative',
                  cursor: 'default',     // ✅ allow normal cursor + selection
                  userSelect: 'text',    // ✅ ensure selectable
                  border: isHighlighted ? '2px solid #0077cc' : (isLastRef ? '2px solid var(--afl-success-500)' : '1px solid var(--afl-n-200)'),
                  backgroundColor: isHighlighted ? 'var(--afl-info-50)' : (isLastRef ? 'var(--afl-success-50)' : 'var(--afl-n-0)'),
                  boxShadow: isLastRef ? '0 10px 15px -3px rgba(22, 163, 74, 0.1), 0 4px 6px -2px rgba(22, 163, 74, 0.05)' : 'none',
                  transform: isLastRef ? 'scale(1.01)' : 'scale(1)',
                  zIndex: isLastRef ? 10 : 1,
                  transition: 'all 0.3s ease'
                }}
              >
                <div
                  draggable
                  title="Drag this label into the question box"
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/json+drugdata', JSON.stringify(result));
                    // optional but helpful: lets plain inputs accept a text drop too
                    e.dataTransfer.setData('text/plain', `${result.PRODUCT_NAMES} (${result.GENERIC_NAMES}) [SET_ID: ${result.set_id}]`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--afl-n-200)',
                    background: 'var(--afl-n-0)',
                    cursor: 'grab',
                    userSelect: 'none',
                    fontWeight: 800,
                    color: 'var(--afl-n-700)',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)'
                  }}
                >
                  ⠿
                </div>
                <input
                    type="checkbox"
                    className="item-checkbox"
                    checked={selectedItems.includes(result.set_id)}
                    onChange={() => handleItemSelection(result.set_id)}
                    title="Select this item for export"
                />

                <div className="result-header mb-2">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--afl-info-700)', fontWeight: 700, cursor: 'pointer', background: 'var(--afl-info-50)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--afl-info-100)' }}>
                      <input 
                        type="checkbox"
                        checked={false}
                        disabled={isRefining || chatHistory.length === 0}
                        onChange={() => refineResponseWithLabel(result.set_id, result.PRODUCT_NAMES)}
                      />
                      Refine Chat
                    </label>
                    <h3 className="text-xl font-semibold text-blue-700 hover:underline">
                    <a
                      href={`https://fdalabel.fda.gov:8443/fdalabel/services/spl/set-ids/${result.set_id}/spl-doc?hl=${result.keywords}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {actualResultNumber}. {result.PRODUCT_NAMES}
                    </a> - {result.GENERIC_NAMES}
                  </h3>
                  </div>
                </div>

                <div className="result-metadata-fancy">
                  <div className="metadata-grid">
                    <div className="column left-column">
                      <div className="meta-row"><span>Company:</span> {result.COMPANY}</div>
                      <div className="meta-row"><span>Application #:</span> {result.APPR_NUM}</div>
                      <div className="meta-row"><span>Active Ingredients:</span> {result.ACT_INGR_NAMES}</div>
                      <div className="meta-row"><span>Market Categories:</span> {result.MARKET_CATEGORIES}</div>
                      <div className="meta-row"><span>Document Type:</span> {result.DOCUMENT_TYPE}</div>
                      <div className="meta-row">
                        <span>RLD:</span>{' '}
                        {String((result as any).RLD ?? (result as any).rld ?? '').toLowerCase() === 'yes' ? (
                          <span
                            style={{
                              display: 'inline-block',
                              marginLeft: 6,
                              padding: '3px 10px',
                              borderRadius: 999,
                              background: 'var(--afl-success-50)',
                              border: '1px solid var(--afl-success-500)',
                              color: 'var(--afl-success-700)',
                              fontWeight: 900,
                              fontSize: 12
                            }}
                          >
                            Yes
                          </span>
                        ) : (
                          <span style={{ color: 'var(--afl-n-400)', marginLeft: 6 }}>—</span>
                        )}
                      </div>
                    </div>
                    <div className="column right-column">
                      <div className="meta-row"><span>Routes:</span> {result.Routes}</div>
                      <div className="meta-row"><span>Dosage Forms:</span> {result.DOSAGE_FORMS}</div>
                      <div className="meta-row"><span>EPC Class:</span> {result.EPC}</div>
                      <div className="meta-row"><span>NDC Codes:</span> {result.NDC_CODES}</div>
                      <div className="meta-row"><span>FDALabel SET-ID:</span> {result.set_id}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: '15px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    {result.is_combination && (
                      <a
                        href={withAppBase(`/device?q=${encodeURIComponent(result.PRODUCT_NAMES.split(' ')[0])}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--afl-danger-500)',
                          textDecoration: 'none',
                          fontWeight: 600,
                          padding: '4px 12px',
                          borderRadius: '4px',
                          border: '1px solid var(--afl-danger-500)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        🩺 Device Safety
                      </a>
                    )}
                    <a
                      href={withAppBase(`/dashboard/label/${result.set_id}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '0.85rem',
                        color: '#0077cc',
                        textDecoration: 'none',
                        fontWeight: 600,
                        padding: '4px 12px',
                        borderRadius: '4px',
                        border: '1px solid #0077cc'
                      }}
                    >
                      View Label ↗
                    </a>
                  </div>
                </div>
              </div>
            );
          })}

          {viewStyle === 'table' && (
            <div className="table-container">
              <table className="results-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>#</th>
                    <th>Refine</th>
                    <th>Drug Name</th>
                    <th>Company</th>
                    <th>Application #</th>
                    <th>NDC</th>
                    <th style={{
                      backgroundColor: 'var(--afl-info-50)',
                      color: 'var(--afl-info-700)',
                      fontWeight: 'bold',
                      border: '1px solid var(--afl-n-200)'
                    }}>Analysis ↗</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedResults.map((result, index) => {
                    const actualResultNumber = (currentPage - 1) * localResultsPerPage + index + 1;
                    const isHighlighted = result.set_id === highlightedSetId;
                    const isLastRef = result.set_id === lastRefId;

                    return (
                      <tr
                        key={index}
                        id={`result-${result.set_id}`}
                        style={{
                          backgroundColor: isHighlighted ? 'var(--afl-info-50)' : (isLastRef ? 'var(--afl-success-50)' : 'inherit'),
                          fontWeight: (isHighlighted || isLastRef) ? '600' : 'normal',
                          border: isLastRef ? '2px solid var(--afl-success-500)' : 'inherit',
                          boxShadow: isLastRef ? 'inset 0 0 0 1px var(--afl-success-500)' : 'none'
                        }}
                      >
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span
                            draggable
                            title="Drag this label into the question box"
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/json+drugdata', JSON.stringify(result));
                              e.dataTransfer.setData('text/plain', `${result.PRODUCT_NAMES} (${result.GENERIC_NAMES}) [SET_ID: ${result.set_id}]`);
                              e.dataTransfer.effectAllowed = 'copy';
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 22,
                              height: 22,
                              marginRight: 8,
                              borderRadius: 6,
                              border: '1px solid var(--afl-n-200)',
                              background: 'var(--afl-n-0)',
                              cursor: 'grab',
                              userSelect: 'none',
                              fontWeight: 800,
                              color: 'var(--afl-n-700)'
                            }}
                          >
                            ⠿
                          </span>
                        </td>
                        <td>{actualResultNumber}</td>
                        <td>
                          <RefineButton setId={result.set_id} productName={result.PRODUCT_NAMES} />
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: 600, color: 'var(--afl-n-900)' }}>{result.PRODUCT_NAMES}</span>
                              {(() => {
                                const val = (result as any).RLD ?? (result as any).rld ?? (result as any).is_rld;
                                return String(val).toLowerCase() === 'yes' || val === true || val === 1 || String(val) === '1';
                              })() && (
                                <span style={{
                                  display: 'inline-block',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  background: 'var(--afl-a-100)',
                                  border: '1px solid var(--afl-a-100)',
                                  color: 'var(--afl-a-700)',
                                  fontWeight: 800,
                                  fontSize: '0.65rem',
                                  textTransform: 'uppercase'
                                }}>
                                  RLD
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.8rem', color: 'var(--afl-n-500)' }}>{result.GENERIC_NAMES}</span>
                          </div>
                        </td>
                        <td>{result.COMPANY}</td>
                        <td>{result.APPR_NUM}</td>
                        <td>{result.NDC_CODES ? (result.NDC_CODES.length > 25 ? `${result.NDC_CODES.substring(0, 25)}...` : result.NDC_CODES) : ''}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <a
                      href={withAppBase(`/dashboard/label/${result.set_id}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                              View Label
                            </a>
                            {result.is_combination && (
                              <a
                                href={withAppBase(`/device?q=${encodeURIComponent(result.PRODUCT_NAMES.split(' ')[0])}`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--afl-danger-500)', fontWeight: 700, fontSize: '0.75rem' }}
                              >
                                🩺 Device Safety
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Refinement Hint */}
          <div style={{
            marginTop: '20px',
            padding: '12px 16px',
            background: 'var(--afl-info-50)',
            borderRadius: '10px',
            border: '1px solid var(--afl-info-100)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '1.2rem' }}>💡</span>
            <div style={{ fontSize: '0.85rem', color: 'var(--afl-info-700)', lineHeight: 1.4 }}>
              <strong>Pro Tip:</strong> Click the <strong>🔍📄 Document Refinement</strong> icon on any result to refine the AI's last response using that specific labeling as a primary reference.
            </div>
          </div>
        </>
      )}
      <AddFilterModal />
      <ExportWorkspaceModal 
        isOpen={showExportWorkspaceModal}
        onClose={() => setShowExportWorkspaceModal(false)}
        onConfirm={handleDashboardExportConfirm}
      />
    </div>
  );
};

export default Results;
