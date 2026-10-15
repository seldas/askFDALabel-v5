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

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fdl-muted, #5e6e7c)' }}>Loading saved histories...</div>;

  return (
    <div className="intro-section" style={{ padding: '40px 24px', maxWidth: '980px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '20px', color: 'var(--fdl-navy-950, #071f3d)' }}>Saved Conversations</h2>
      {histories.length === 0 ? (
        <div style={{ color: 'var(--fdl-muted, #5e6e7c)', fontSize: '0.9rem', background: 'var(--fdl-canvas, #f3f6f8)', padding: '20px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line-soft, #d7e0e7)' }}>
          No saved conversations found. Start a search and click "Save Chat" to save your progress.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {histories.map(h => (
            <div key={h.id} 
              style={{
                padding: '16px 20px', background: 'var(--fdl-paper, #ffffff)', borderRadius: 'var(--fdl-radius-sm, 2px)',
                border: '1px solid var(--fdl-line-soft, #d7e0e7)', borderLeft: '3px solid var(--fdl-navy-800, #12375b)', cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s',
                boxShadow: 'none'
              }}
              onClick={() => {
                if (h.chat_data && h.chat_data.length > 0) {
                  setChatHistory(h.chat_data);
                  setCurrentHistoryId(h.id);
                  setHasUnsavedChanges(false);
                }
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--fdl-blue-700, #0759a5)'; e.currentTarget.style.backgroundColor = 'var(--fdl-blue-050, #edf4fa)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--fdl-line-soft, #d7e0e7)'; e.currentTarget.style.backgroundColor = 'var(--fdl-paper, #ffffff)'; }}
            >
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--fdl-navy-950, #071f3d)', marginBottom: '6px' }}>{h.title}</div>
              <div style={{ fontSize: '0.825rem', color: 'var(--fdl-muted, #5e6e7c)', display: 'flex', gap: '16px' }}>
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
    highlightedSetId,

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
  } = useSearchContext();


  const baseResults = (resultsRaw as ResultItem[]);
  const results = baseResults.slice(0, resultsLimit);
  const totalResults = (totalResultsRaw > resultsLimit ? resultsLimit : totalResultsRaw);

  // --- Result limit warning (only show when we hit the backend cap) ---
  // The backend no longer reports its own cap (the debug payloads came from the
  // retired agentic stream), so this is the common cap the search routes use.
  const inferredLimit = 100;

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
          background: isThisRefining ? '#fffbeb' : 'none',
          border: 'none',
          cursor: (isRefining || chatHistory.length === 0) ? 'not-allowed' : 'pointer',
          fontSize: '1.2rem',
          padding: '4px',
          borderRadius: 'var(--fdl-radius-sm, 2px)',
          transition: 'all 0.15s ease',
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
  const [newType, setNewType] = useState<'drugNames' | 'ndcs'>('drugNames');

  const AddFilterModal = () => {
    if (!isAddModalOpen) return null;

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(7, 31, 61, 0.58)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          background: 'var(--fdl-paper, #ffffff)',
          padding: '24px',
          borderRadius: 'var(--fdl-radius-sm, 2px)',
          width: '360px',
          boxShadow: '0 12px 32px rgba(7, 31, 61, 0.18)',
          border: '1px solid var(--fdl-line, #b8c8d7)',
          borderTop: '3px solid var(--fdl-navy-800, #12375b)'
        }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)' }}>Add Manual Filter</h3>
          
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: 'var(--fdl-ink-soft, #273843)', textTransform: 'uppercase', marginBottom: '6px' }}>Filter Type</label>
            <select 
              value={newType} 
              onChange={(e) => setNewType(e.target.value as any)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line, #b8c8d7)', background: 'var(--fdl-paper, #ffffff)', color: 'var(--fdl-ink, #132332)', fontSize: '0.875rem' }}
            >
              <option value="drugNames">💊 Drug Name</option>
              <option value="ndcs">🔢 NDC Code</option>
            </select>
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: 'var(--fdl-ink-soft, #273843)', textTransform: 'uppercase', marginBottom: '6px' }}>Search Term</label>
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
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line, #b8c8d7)', background: 'var(--fdl-paper, #ffffff)', color: 'var(--fdl-ink, #132332)', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button 
              onClick={() => { setIsAddModalOpen(false); setNewTerm(''); }}
              style={{ padding: '7px 14px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line, #b8c8d7)', background: 'var(--fdl-paper, #ffffff)', color: 'var(--fdl-ink-soft, #273843)', fontWeight: 700, fontSize: '0.825rem', cursor: 'pointer' }}
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
              style={{ padding: '7px 14px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-blue-800, #004d80)', background: 'var(--fdl-blue-700, #0759a5)', color: 'white', fontWeight: 700, fontSize: '0.825rem', cursor: 'pointer' }}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--fdl-muted, #5e6e7c)' }}>
        <span>Max results:</span>
        <select 
          value={resultsLimit} 
          onChange={(e) => setResultsLimit(parseInt(e.target.value))}
          style={{ padding: '2px 6px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line, #b8c8d7)', background: 'var(--fdl-paper, #ffffff)', color: 'var(--fdl-ink, #132332)' }}
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
        background: 'var(--fdl-canvas, #f3f6f8)',
        borderRadius: 'var(--fdl-radius-sm, 2px)',
        border: '1px solid var(--fdl-line-soft, #d7e0e7)'
      }}>
        <div style={{ width: '100%', fontSize: '0.75rem', fontWeight: 800, color: 'var(--fdl-muted, #5e6e7c)', textTransform: 'uppercase', marginBottom: '4px' }}>
          Active Search Filters
        </div>
        
        {activeDrugNames.map(term => (
          <div key={`drug-${term}`} className="filter-chip highlight-drug" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.825rem', padding: '3px 8px', borderRadius: 'var(--fdl-radius-sm, 2px)' }}>
            <span>💊 {term}</span>
            <button onClick={() => toggleFilterTerm('drugNames', term)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: '0.9rem', lineHeight: 1 }}>×</button>
          </div>
        ))}

        {activeNDCs.map(term => (
          <div key={`ndc-${term}`} className="filter-chip highlight-ndc" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.825rem', padding: '3px 8px', borderRadius: 'var(--fdl-radius-sm, 2px)' }}>
            <span>🔢 {term}</span>
            <button onClick={() => toggleFilterTerm('ndcs', term)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: '0.9rem', lineHeight: 1 }}>×</button>
          </div>
        ))}

        {/* Hard-coded Flags Row */}
        <div style={{ width: '100%', borderTop: '1px solid var(--fdl-line-soft, #d7e0e7)', margin: '4px 0', paddingTop: '8px', display: 'flex', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.825rem', fontWeight: 700, color: 'var(--fdl-ink-soft, #273843)', cursor: 'pointer' }}>
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
              background: 'var(--fdl-blue-700, #0759a5)',
              border: '1px solid var(--fdl-blue-800, #004d80)',
              color: 'white',
              fontSize: '0.825rem',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 'var(--fdl-radius-sm, 2px)'
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
                ndcs: [],
                isRx: false
              }));
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#b91c1c',
              fontSize: '0.825rem',
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

  return (
    <div className="search-results">
      <FilterChips />

      {resultsMessage && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderLeft: '3px solid #b45309',
            color: '#92400e',
            borderRadius: 'var(--fdl-radius-sm, 2px)',
            padding: '10px 14px',
            marginBottom: 14,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            fontWeight: 700,
            fontSize: '0.85rem'
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>⚠️</span>
          <span>{resultsMessage}</span>
        </div>
      )}

      {refError && (
        <div
          className="med-answer-container"
          style={{
            backgroundColor: '#fef2f2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            borderLeft: '3px solid #b91c1c',
            borderRadius: 'var(--fdl-radius-sm, 2px)',
            padding: '10px 14px',
            marginBottom: '14px',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>⚠️ {refError}</span>
          <button
            onClick={() => setRefError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fdl-muted, #5e6e7c)', fontSize: '1.1rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {(setIds.length === 0 && results.length === 0) ? (
        <div
          className="med-answer-container"
          style={{
            backgroundColor: 'var(--fdl-canvas, #f3f6f8)',
            color: 'var(--fdl-muted, #5e6e7c)',
            border: '1px solid var(--fdl-line-soft, #d7e0e7)',
            borderRadius: 'var(--fdl-radius-sm, 2px)',
            padding: '24px',
            marginBottom: '20px'
          }}
        >
          <div className="result-count" style={{ fontWeight: 'bold', textAlign: 'center' }}>
            {((filters.drugNames?.length ?? 0) > 0 || (filters.ndcs?.length ?? 0) > 0 || (filters.labelingType?.length ?? 0) > 0)
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
                <span style={{ fontSize: 13, color: 'var(--fdl-ink-soft, #273843)', fontWeight: 700 }}>Per page</span>
                <select
                  value={localResultsPerPage}
                  onChange={handlePerPageChange}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 'var(--fdl-radius-sm, 2px)',
                    border: '1px solid var(--fdl-line, #b8c8d7)',
                    background: 'var(--fdl-paper, #ffffff)',
                    fontWeight: 700,
                    color: 'var(--fdl-navy-950, #071f3d)',
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
                    backgroundColor: 'var(--fdl-paper, #ffffff)',
                    borderRadius: 'var(--fdl-radius-sm, 2px)',
                    boxShadow: '0 4px 12px rgba(7, 31, 61, 0.1)',
                    border: '1px solid var(--fdl-line, #b8c8d7)',
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
                        padding: '8px 14px',
                        fontSize: '0.825rem',
                        color: 'var(--fdl-ink, #132332)',
                        backgroundColor: 'var(--fdl-paper, #ffffff)',
                        border: 'none',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--fdl-canvas, #f3f6f8)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--fdl-paper, #ffffff)'}
                    >
                      JSON (Results + XML)
                    </button>

                    <button
                      onClick={handleExcelExport}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 14px',
                        fontSize: '0.825rem',
                        color: 'var(--fdl-ink, #132332)',
                        backgroundColor: 'var(--fdl-paper, #ffffff)',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--fdl-canvas, #f3f6f8)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--fdl-paper, #ffffff)'}
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
                          padding: '8px 14px',
                          fontSize: '0.825rem',
                          color: 'var(--fdl-blue-700, #0759a5)',
                          backgroundColor: 'var(--fdl-paper, #ffffff)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 700,
                          borderTop: '1px solid var(--fdl-line-soft, #d7e0e7)'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--fdl-canvas, #f3f6f8)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--fdl-paper, #ffffff)'}
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
                  cursor: 'default',
                  userSelect: 'text',
                  border: isHighlighted ? '2px solid var(--fdl-blue-700, #0759a5)' : (isLastRef ? '2px solid var(--fdl-green, #2d7a4c)' : '1px solid var(--fdl-line-soft, #d7e0e7)'),
                  backgroundColor: isHighlighted ? 'var(--fdl-blue-050, #edf4fa)' : (isLastRef ? '#f0fdf4' : 'var(--fdl-paper, #ffffff)'),
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  boxShadow: 'none',
                  zIndex: isLastRef ? 10 : 1,
                  transition: 'border-color 0.15s, background-color 0.15s'
                }}
              >
                <div
                  draggable
                  title="Drag this label into the question box"
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/json+drugdata', JSON.stringify(result));
                    e.dataTransfer.setData('text/plain', `${result.PRODUCT_NAMES} (${result.GENERIC_NAMES}) [SET_ID: ${result.set_id}]`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    padding: '3px 7px',
                    borderRadius: 'var(--fdl-radius-sm, 2px)',
                    border: '1px solid var(--fdl-line-soft, #d7e0e7)',
                    background: 'var(--fdl-paper, #ffffff)',
                    cursor: 'grab',
                    userSelect: 'none',
                    fontWeight: 800,
                    fontSize: '0.8rem',
                    color: 'var(--fdl-muted, #5e6e7c)'
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
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.825rem', color: 'var(--fdl-blue-700, #0759a5)', fontWeight: 700, cursor: 'pointer', background: 'var(--fdl-blue-050, #edf4fa)', padding: '2px 8px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line-soft, #d7e0e7)' }}>
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
                              padding: '2px 8px',
                              borderRadius: 'var(--fdl-radius-sm, 2px)',
                              background: '#dcfce7',
                              border: '1px solid #bbf7d0',
                              color: '#166534',
                              fontWeight: 700,
                              fontSize: 12
                            }}
                          >
                            Yes
                          </span>
                        ) : (
                          <span style={{ color: 'var(--fdl-muted, #5e6e7c)', marginLeft: 6 }}>—</span>
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
                  <div style={{ marginTop: '15px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    {result.is_combination && (
                      <a
                        href={withAppBase(`/device?q=${encodeURIComponent(result.PRODUCT_NAMES.split(' ')[0])}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '0.825rem',
                          color: '#b91c1c',
                          textDecoration: 'none',
                          fontWeight: 700,
                          padding: '4px 10px',
                          borderRadius: 'var(--fdl-radius-sm, 2px)',
                          border: '1px solid #fecaca',
                          background: '#fef2f2',
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
                        fontSize: '0.825rem',
                        color: 'var(--fdl-blue-700, #0759a5)',
                        textDecoration: 'none',
                        fontWeight: 700,
                        padding: '4px 10px',
                        borderRadius: 'var(--fdl-radius-sm, 2px)',
                        border: '1px solid var(--fdl-line, #b8c8d7)',
                        background: 'var(--fdl-paper, #ffffff)'
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
                      backgroundColor: 'var(--fdl-blue-050, #edf4fa)',
                      color: 'var(--fdl-blue-700, #0759a5)',
                      fontWeight: 'bold',
                      border: '1px solid var(--fdl-line-soft, #d7e0e7)'
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
                          backgroundColor: isHighlighted ? 'var(--fdl-blue-050, #edf4fa)' : (isLastRef ? '#f0fdf4' : 'inherit'),
                          fontWeight: (isHighlighted || isLastRef) ? '600' : 'normal',
                          border: isLastRef ? '2px solid var(--fdl-green, #2d7a4c)' : 'inherit',
                          boxShadow: 'none'
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
                              borderRadius: 'var(--fdl-radius-sm, 2px)',
                              border: '1px solid var(--fdl-line-soft, #d7e0e7)',
                              background: 'var(--fdl-paper, #ffffff)',
                              cursor: 'grab',
                              userSelect: 'none',
                              fontWeight: 800,
                              fontSize: '0.75rem',
                              color: 'var(--fdl-muted, #5e6e7c)'
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
                              <span style={{ fontWeight: 600, color: 'var(--fdl-navy-950, #071f3d)' }}>{result.PRODUCT_NAMES}</span>
                              {(() => {
                                const val = (result as any).RLD ?? (result as any).rld ?? (result as any).is_rld;
                                return String(val).toLowerCase() === 'yes' || val === true || val === 1 || String(val) === '1';
                              })() && (
                                <span style={{
                                  display: 'inline-block',
                                  padding: '1px 6px',
                                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                                  background: '#dcfce7',
                                  border: '1px solid #bbf7d0',
                                  color: '#166534',
                                  fontWeight: 700,
                                  fontSize: '0.65rem',
                                  textTransform: 'uppercase'
                                }}>
                                  RLD
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.8rem', color: 'var(--fdl-muted, #5e6e7c)' }}>{result.GENERIC_NAMES}</span>
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
                                style={{ color: '#b91c1c', fontWeight: 700, fontSize: '0.75rem' }}
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
            background: 'var(--fdl-blue-050, #edf4fa)',
            borderRadius: 'var(--fdl-radius-sm, 2px)',
            border: '1px solid var(--fdl-line-soft, #d7e0e7)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '1.2rem' }}>💡</span>
            <div style={{ fontSize: '0.85rem', color: 'var(--fdl-navy-800, #12375b)', lineHeight: 1.4 }}>
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
