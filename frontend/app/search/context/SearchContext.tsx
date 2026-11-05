import React, { createContext, useContext, useState } from 'react';
import { Filters, ResultItem } from '../types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SearchContextProps {
  // Core query controls
  searchTerm: string;
  setSearchTerm: (val: string) => void;

  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  toggleFilterTerm: (category: keyof Filters, term: string) => void;
  toggleFilterFlag: (flag: 'isRx') => void;
  applyFilters: () => void;

  // Summary / answer
  summary: string;
  setSummary: React.Dispatch<React.SetStateAction<string>>;

  inputType: string;
  setInputType: (inputType: string) => void;

  medAnswer: string;
  setMedAnswer: React.Dispatch<React.SetStateAction<string>>;

  directAnswer: string;
  setDirectAnswer: React.Dispatch<React.SetStateAction<string>>;

  // Results
  results: ResultItem[];
  setResults: React.Dispatch<React.SetStateAction<ResultItem[]>>;

  allResults: ResultItem[];
  setAllResults: React.Dispatch<React.SetStateAction<ResultItem[]>>;

  setIds: string[];
  setSetIds: React.Dispatch<React.SetStateAction<string[]>>;

  totalResults: number;
  setTotalResults: React.Dispatch<React.SetStateAction<number>>;

  resultsLimit: number;
  setResultsLimit: (val: number) => void;
  resultsMessage: string;
  setResultsMessage: (val: string) => void;
  applyDataFilters: () => void;
  
  isRefining: boolean;
  lastRefId: string | null;
  refineResponseWithLabel: (setId: string, productName: string) => Promise<void>;

  // Pagination
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  resultsPerPage: number;

  // Chat + prompt
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;

  clarificationMessage: string;
  setClarificationMessage: React.Dispatch<React.SetStateAction<string>>;

  AI_ref: string;
  setAI_ref: React.Dispatch<React.SetStateAction<string>>;

  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;

  // SQL debugging / manual execution

  // UI helpers
  highlightedSetId: string | null;
  setHighlightedSetId: React.Dispatch<React.SetStateAction<string | null>>;

  loadingStatus: string;
  setLoadingStatus: React.Dispatch<React.SetStateAction<string>>;

  // Fixed Mode: 'semantic'

  // Agent debug panels

  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>;

  currentHistoryId: number | null;
  setCurrentHistoryId: React.Dispatch<React.SetStateAction<number | null>>;
}

const SearchContext = createContext<SearchContextProps | undefined>(undefined);

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const [filters, setFilters] = useState<Filters>({
    labelingType: [],
    applicationType: [],
    drugNames: [],
    ndcs: [],
    isRx: false,
  });

  const toggleFilterTerm = (category: keyof Filters, term: string) => {
    setFilters(prev => {
      const current = prev[category];
      if (Array.isArray(current)) {
        if (current.includes(term)) {
          return { ...prev, [category]: current.filter(t => t !== term) };
        } else {
          return { ...prev, [category]: [...current, term] };
        }
      }
      return prev;
    });
  };

  const toggleFilterFlag = (flag: 'isRx') => {
    setFilters(prev => ({ ...prev, [flag]: !prev[flag] }));
  };

  const [summary, setSummary] = useState('');
  const [medAnswer, setMedAnswer] = useState('');
  const [directAnswer, setDirectAnswer] = useState('');

  const [highlightedSetId, setHighlightedSetId] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [inputType, setInputType] = useState('');

  const [results, setResults] = useState<ResultItem[]>([]);
  const [allResults, setAllResults] = useState<ResultItem[]>([]);

  const [clarificationMessage, setClarificationMessage] = useState('');

  const [setIds, setSetIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [AI_ref, setAI_ref] = useState('');

  const [totalResults, setTotalResults] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsLimit, setResultsLimit] = useState(500);
  const [resultsMessage, setResultsMessage] = useState('');

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState<number | null>(null);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__hasUnsavedSearchChanges = hasUnsavedChanges;
    }
  }, [hasUnsavedChanges]);


  const [isRefining, setIsRefining] = useState(false);
  const [lastRefId, setLastRefId] = useState<string | null>(null);

  const refineResponseWithLabel = async (setId: string, productName: string) => {
    if (chatHistory.length === 0) return;
    setIsRefining(true);
    setLoadingStatus(`Refining last response with ${productName} labeling...`);
    try {
      const response = await fetch('/api/search/refine_chat', {
        method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                set_id: setId,
                product_name: productName,
                chat_history: chatHistory,
                filters: filters
              }),
            });

      const data = await response.json();

      if (data.error) {
        alert(data.error);
      } else if (data.refined_json) {
        setLastRefId(setId);
        // Update the last message in history
        setChatHistory(prev => {
          const newHistory = [...prev];
          const lastMsg = newHistory[newHistory.length - 1];
          if (lastMsg.role === 'assistant') {
            lastMsg.content = data.refined_json.text;
            // Optionally store metadata like related sections if needed for rendering
            (lastMsg as any).relatedSections = data.refined_json['related sections'];
            (lastMsg as any).refLabel = `${productName} [${setId}]`;
            (lastMsg as any).originalContent = data.original_text; // For diffing
          }
          return newHistory;
        });
      }
    } catch (err) {
      console.error("Refinement failed:", err);
    } finally {
      setIsRefining(false);
      setLoadingStatus('');
    }
  };

  const resultsPerPage = 5;

  const abortControllerRef = React.useRef<AbortController | null>(null);
  const timeoutRef = React.useRef<number | null>(null);

  const applyDataFilters = React.useCallback(() => {
    // Clear previous debounce timeout
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    // Debounce the actual fetch execution by 300ms
    timeoutRef.current = window.setTimeout(async () => {
      // ── Guard: if no filters are active, don't fetch and don't wipe results ──
      // This prevents applyDataFilters (triggered on mount/filter-change) from
      // overwriting DB search results that were loaded by ChatPanel.
      // The backend already returns empty for no-filter requests, so we skip
      // the round-trip entirely.
      const hasActiveFilters = Object.entries(filters).some(([, val]) =>
        Array.isArray(val) ? val.length > 0 : Boolean(val)
      );
      if (!hasActiveFilters) {
        setLoadingStatus('');
        return;
      }

      // Abort any ongoing fetch request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create a new controller for the upcoming request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        setLoadingStatus('Filtering data...');
        const response = await fetch('/api/search/filter_data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters, limit: resultsLimit }),
          signal: controller.signal,
        });
        const data = await response.json();
        
        setResults(data.results || []);
        setTotalResults(data.total_counts || 0);
        setResultsMessage(data.message || '');
        setCurrentPage(1);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('Fetch aborted due to new request');
        } else {
          console.error("Failed to filter data:", err);
        }
      } finally {
        // Only clear loading status if this specific request wasn't superseded
        if (abortControllerRef.current === controller) {
          setLoadingStatus('');
        }
      }
    }, 300);
  }, [filters, resultsLimit]);


  // Clean up timers and fetches on unmount
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Real-time update when filters change
  React.useEffect(() => {
    // Only auto-apply if there's at least one filter or we want to show all initially
    applyDataFilters();
  }, [filters, resultsLimit, applyDataFilters]);

  const applyFilters = () => {
    // Logic for applying filters
  };

  return (
    <SearchContext.Provider
      value={{
        searchTerm,
        setSearchTerm,

        filters,
        setFilters,
        toggleFilterTerm,
        toggleFilterFlag,
        applyFilters,

        summary,
        setSummary,

        inputType,
        setInputType,

        medAnswer,
        setMedAnswer,

        directAnswer,
        setDirectAnswer,

        results,
        setResults,

        allResults,
        setAllResults,

        setIds,
        setSetIds,

        prompt,
        setPrompt,

        clarificationMessage,
        setClarificationMessage,

        AI_ref,
        setAI_ref,

        totalResults,
        setTotalResults,

        resultsLimit,
        setResultsLimit,
        resultsMessage,
        setResultsMessage,
        applyDataFilters,

        isRefining,
        lastRefId,
        refineResponseWithLabel,

        currentPage,
        setCurrentPage,

        resultsPerPage,

        chatHistory,
        setChatHistory,

        highlightedSetId,
        setHighlightedSetId,

        loadingStatus,
        setLoadingStatus,

        // NEW debug fields

        hasUnsavedChanges,
        setHasUnsavedChanges,

        currentHistoryId,
        setCurrentHistoryId,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export const useSearchContext = () => {
  const context = useContext(SearchContext);
  if (!context) throw new Error("useSearchContext must be used within a SearchProvider");
  return context;
};
