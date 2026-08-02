"use client"
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from "../components/Header";
import Footer from '../components/Footer';
import "../globals.css";
import { withAppBase, withApiBase } from '../utils/appPaths';

interface LocalQueryResult {
    set_id: string;
    spl_id: string;
    brand_name: string;
    generic_name: string;
    manufacturer: string;
    appr_num: string;
    ndc: string;
    revised_date: string;
    market_category: string;
    doc_type: string;
    source: string;
    has_history?: boolean;
    is_archived?: boolean;
}

interface RLDResult {
    ingredient: string;
    trade_name: string;
    df_route: string;
    strength: string;
    applicant: string;
    appl_no: string;
    formatted_appl_no?: string;
    product_no: string;
    te_code: string;
    approval_date: string;
    rld: string;
    rs: string;
    type: string;
}

interface DeviceResult {
    id: string;
    type: string;
    name: string;
    manufacturer: string;
    product_code: string;
    date: string;
}

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useUser } from '../context/UserContext';
import { ExportWorkspaceModal } from '../components/ExportWorkspaceModal';
import MaudeReport from '../device/components/MaudeReport';
import DeviceCompare from '../device/components/DeviceCompare';


const getTECodeExplanation = (code: string) => {
    if (!code) return 'Not available';
    const upperCode = code.toUpperCase();
    if (upperCode === 'A') return "'A' rated drugs are those the FDA deems to be therapeutically equivalent to other therapeutically equivalent products.";
    if (upperCode === 'AB') return "Actual or potential bioequivalence problems have been resolved with adequate in vivo and/or in vitro evidence supporting bioequivalence of the product to a selected Reference Listed Drug.";
    if (['AA', 'AN', 'AO', 'AP', 'AT'].includes(upperCode)) return "No in vivo bioequivalence issue is known or suspected. Designation depends on the dosage form.";
    if (upperCode === 'B') return "'B' rated drug products are those the FDA currently considers not to be therapeutically equivalent to other pharmaceutically equivalent products.";
    if (['BC', 'BD', 'BE', 'BN', 'BP', 'BR', 'BS', 'BT', 'BX', 'B*'].includes(upperCode)) return "These are drug products for which actual or potential bioequivalence problems have not been resolved by adequate evidence of bioequivalence. The problem is likely to be with specific dosage forms rather than the active ingredients.";
    if (upperCode === 'NR') return "Used for products listed in the Orange Book that are not multi-source (i.e., no FDA-approved generic equivalents).";
    if (upperCode === 'NA') return "Used for products that are not reviewed by the FDA, such as those marketed before 1938, vitamins, and nutritional supplements.";
    if (upperCode === 'OFFMARKET') return "Products designated as 'off market' include the TE code assigned, if applicable, when the product was placed off-market.";
    return `TE Code: ${code}`;
};

const LocalQueryContent = () => {
    const searchParams = useSearchParams();
    const { session } = useUser();
    const urlQuery = searchParams.get('q');
    const [query, setQuery] = useState(urlQuery || '');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [userWantsSuggestions, setUserWantsSuggestions] = useState(true);
    const [results, setResults] = useState<LocalQueryResult[]>([]);
    const [rldResults, setRldResults] = useState<RLDResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [humanRxOnly, setHumanRxOnly] = useState(false);
    const [rldOnly, setRldOnly] = useState(false);
    const [rsOnly, setRsOnly] = useState(false);
    const [useArchive, setUseArchive] = useState(false);
    const [searchMode, setSearchMode] = useState<'archive' | 'rld' | 'device'>('archive');
    const [deviceResults, setDeviceResults] = useState<DeviceResult[]>([]);
    const [analyzeTarget, setAnalyzeTarget] = useState<{ code: string, id: string } | null>(null);
    const [selectedDevices, setSelectedDevices] = useState<DeviceResult[]>([]);
    const [showCompare, setShowCompare] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);

    const toggleSelection = (device: DeviceResult) => {
        setSelectedDevices(prev => {
            if (prev.some(d => d.id === device.id)) {
                return prev.filter(d => d.id !== device.id);
            } else {
                return [...prev, device];
            }
        });
    };

    // Debounced Autocomplete
    useEffect(() => {
        const fetchSuggestions = async () => {
            if (query.trim().length < 2 || !userWantsSuggestions) {
                setSuggestions([]);
                setShowSuggestions(false);
                return;
            }

            try {
                // Autocomplete can still use the same endpoint, just drop rld_only/rs_only
                const res = await fetch(`/api/localquery/autocomplete?query=${encodeURIComponent(query)}&human_rx_only=${humanRxOnly}`);
                const data = await res.json();
                if (data.suggestions) {
                    setSuggestions(data.suggestions);
                    setShowSuggestions(data.suggestions.length > 0);
                }
            } catch (err) {
                console.error("Autocomplete fetch error", err);
            }
        };

        const timeoutId = setTimeout(fetchSuggestions, 300);
        return () => clearTimeout(timeoutId);
    }, [query, userWantsSuggestions]);

    const handleSearch = async (e?: React.FormEvent, selectedQuery?: string) => {
        if (e) e.preventDefault();
        const finalQuery = selectedQuery || query;
        if (!finalQuery.trim()) return;

        setQuery(finalQuery);
        setShowSuggestions(false);
        setUserWantsSuggestions(false); // Disable suggestions after a search is triggered
        setIsLoading(true);
        setHasSearched(true);
        try {
            if (searchMode === 'device') {
                const response = await fetch(`/api/device/search?q=${encodeURIComponent(finalQuery)}`);
                const data = await response.json();
                if (data.results) {
                    setDeviceResults(data.results);
                } else {
                    setDeviceResults([]);
                }
            } else if (searchMode === 'rld') {
                const response = await fetch(`/api/localquery/rld_search?query=${encodeURIComponent(finalQuery)}&rld_only=${rldOnly}&rs_only=${rsOnly}`);
                const data = await response.json();
                if (data.results) {
                    setRldResults(data.results);
                } else {
                    setRldResults([]);
                }
            } else {
                const response = await fetch(`/api/localquery/search?query=${encodeURIComponent(finalQuery)}&human_rx_only=${humanRxOnly}&use_archive=${useArchive}`);
                const data = await response.json();
                if (data.results) {
                    setResults(data.results);
                } else {
                    setResults([]);
                }
            }
        } catch (error) {
            console.error("Local search error:", error);
            if (searchMode === 'device') setDeviceResults([]);
            else if (searchMode === 'rld') setRldResults([]);
            else setResults([]);
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-search if URL has query
    useEffect(() => {
        if (urlQuery && !hasSearched) {
            handleSearch();
        }
    }, [urlQuery, hasSearched]);

    const handleInputChange = (val: string) => {
        setQuery(val);
        setUserWantsSuggestions(true); // Re-enable suggestions when user types
    };

    const handleRandom = async () => {
        setIsLoading(true);
        setHasSearched(true);
        setQuery('');
        setUserWantsSuggestions(false);
        try {
            if (searchMode === 'device') {
                const response = await fetch(`/api/device/random`);
                const data = await response.json();
                if (data.results) {
                    setDeviceResults(data.results);
                }
            } else if (searchMode === 'rld') {
                const response = await fetch(`/api/localquery/rld_random?rld_only=${rldOnly}&rs_only=${rsOnly}`);
                const data = await response.json();
                if (data.results) {
                    setRldResults(data.results);
                }
            } else {
                const response = await fetch(`/api/localquery/random?human_rx_only=${humanRxOnly}`);
                const data = await response.json();
                if (data.results) {
                    setResults(data.results);
                }
            }
        } catch (error) {
            console.error("Random fetch error:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExport = () => {
        if (results.length === 0) {
            alert("No results to export.");
            return;
        }
        const splIds = results.map(r => r.spl_id).join(',');
        window.location.href = withApiBase(`/api/localquery/export?spl_ids=${encodeURIComponent(splIds)}`);
    };

    const handleExportToDashboardClick = () => {
        if (results.length === 0) {
            alert("No results to export.");
            return;
        }
        setShowExportModal(true);
    };

    const handleExportToDashboard = async (exportData: { taskId?: number; taskName?: string; tags?: string }) => {
        setShowExportModal(false);

        const labelsData = results.map(r => ({
            set_id: r.set_id,
            brand_name: r.brand_name,
            generic_name: r.generic_name,
            manufacturer_name: r.manufacturer,
            market_category: r.market_category,
            application_number: r.appr_num,
            ndc: r.ndc,
            effective_time: r.revised_date,
            source: r.source
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
                alert(`Error: ${data.error || 'Failed to create task'}`);
            }
        } catch (error) {
            console.error("Export to Dashboard Error:", error);
            alert("Failed to export to dashboard.");
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            <Header />

            <main style={{ flex: 1, padding: '40px 20px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
                <div style={{ marginBottom: '40px', textAlign: 'center' }}>
                    <h1 className="hero-title-animated" style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}>
                        Search Databases
                    </h1>
                    <div style={{ marginTop: '5px' }}>
                        <Link 
                            href="/search" 
                            style={{ 
                                fontSize: '0.95rem', 
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
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                <path d="M11 8a2 2 0 0 0-2 2"></path>
                            </svg>
                            Try Conversational AI Chat
                        </Link>
                    </div>
                </div>

                <div style={{
                    background: '#fff',
                    padding: '30px',
                    borderRadius: '16px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    marginBottom: '30px',
                    position: 'relative' // For absolute positioning of suggestions
                }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '8px', padding: '4px' }}>
                            <button
                                onClick={() => { setSearchMode('archive'); setHasSearched(false); setResults([]); }}
                                style={{
                                    padding: '8px 24px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    backgroundColor: searchMode === 'archive' ? '#fff' : 'transparent',
                                    color: searchMode === 'archive' ? '#0f172a' : '#64748b',
                                    boxShadow: searchMode === 'archive' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                    transition: 'all 0.2s'
                                }}
                            >
                                Drug Labeling Search
                            </button>
                            <button
                                onClick={() => { setSearchMode('rld'); setHasSearched(false); setRldResults([]); }}
                                style={{
                                    padding: '8px 24px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    backgroundColor: searchMode === 'rld' ? '#fff' : 'transparent',
                                    color: searchMode === 'rld' ? '#0f172a' : '#64748b',
                                    boxShadow: searchMode === 'rld' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                    transition: 'all 0.2s'
                                }}
                            >
                                Orange Book RLD Search
                            </button>
                            <button
                                onClick={() => { setSearchMode('device'); setHasSearched(false); setDeviceResults([]); setSelectedDevices([]); }}
                                style={{
                                    padding: '8px 24px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    backgroundColor: searchMode === 'device' ? '#fff' : 'transparent',
                                    color: searchMode === 'device' ? '#0f172a' : '#64748b',
                                    boxShadow: searchMode === 'device' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                    transition: 'all 0.2s'
                                }}
                            >
                                Device MAUDE Search
                            </button>
                        </div>
                    </div>
                    <form onSubmit={(e) => handleSearch(e)} style={{ display: 'flex', gap: '12px' }}>
                        <div style={{ flex: 1, position: 'relative' }}>
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => handleInputChange(e.target.value)}
                                onFocus={() => suggestions.length > 0 && userWantsSuggestions && setShowSuggestions(true)}
                                placeholder={searchMode === 'device' ? "Search by Device Name, Manufacturer, or Identifier (e.g. K230001)..." : searchMode === 'rld' ? "Enter Ingredient, Trade Name, or App #..." : "Enter Generic name, Brand name, Set ID, or App #..."}
                                style={{
                                    width: '100%',
                                    padding: '14px 20px',
                                    borderRadius: '10px',
                                    border: '2px solid #e2e8f0',
                                    fontSize: '1rem',
                                    outline: 'none',
                                    transition: 'border-color 0.2s'
                                }}
                            />
                            {showSuggestions && (
                                <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    backgroundColor: '#fff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '8px',
                                    marginTop: '4px',
                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                    zIndex: 100,
                                    maxHeight: '300px',
                                    overflowY: 'auto'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '8px 20px',
                                        borderBottom: '1px solid #f1f5f9',
                                        backgroundColor: '#f8fafc'
                                    }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Suggestions</span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowSuggestions(false);
                                                setUserWantsSuggestions(false);
                                            }}
                                            style={{
                                                fontSize: '0.75rem',
                                                fontWeight: 700,
                                                color: '#ef4444',
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '4px 8px',
                                                borderRadius: '4px'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            Close ✕
                                        </button>
                                    </div>
                                    {suggestions.map((s, i) => (
                                        <div
                                            key={i}
                                            onClick={() => handleSearch(undefined, s)}
                                            style={{
                                                padding: '10px 20px',
                                                cursor: 'pointer',
                                                borderBottom: i === suggestions.length - 1 ? 'none' : '1px solid #f1f5f9',
                                                fontSize: '0.95rem'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}
                                        >
                                            {s}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading || !query.trim()}
                            style={{
                                padding: '0 30px',
                                backgroundColor: '#2563eb',
                                color: '#fff',
                                borderRadius: '10px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                border: 'none',
                                height: '52px',
                                transition: 'background-color 0.2s'
                            }}
                        >
                            {isLoading && query ? 'Searching...' : 'Search'}
                        </button>
                        <button
                            type="button"
                            onClick={handleRandom}
                            disabled={isLoading}
                            style={{
                                padding: '0 20px',
                                backgroundColor: '#f1f5f9',
                                color: '#475569',
                                borderRadius: '10px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: '1px solid #e2e8f0',
                                height: '52px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 18h2c4.3 0 6-7 10-7h2"></path>
                                <path d="M2 6h2c4.3 0 6 7 10 7h2"></path>
                                <path d="m18 9 3 3-3 3"></path>
                                <path d="m18 3 3 3-3 3"></path>
                                <path d="M22 18h-4"></path>
                            </svg>
                            {isLoading && !query ? 'Fetching...' : 'Quick Access'}
                        </button>
                    </form>

                    <div style={{ display: 'flex', gap: '30px', marginTop: '20px', paddingLeft: '5px' }}>
                        {searchMode === 'archive' && (
                            <>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'not-allowed', fontSize: '0.95rem', color: '#334155', fontWeight: 700, opacity: 0.7 }}>
                                    <input
                                        type="checkbox"
                                        checked={true}
                                        disabled={true}
                                        style={{ width: '20px', height: '20px', cursor: 'not-allowed', accentColor: '#2563eb' }}
                                    />
                                    Archived Label
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.95rem', color: '#334155', fontWeight: 700 }}>
                                    <input
                                        type="checkbox"
                                        checked={humanRxOnly}
                                        onChange={(e) => setHumanRxOnly(e.target.checked)}
                                        style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
                                    />
                                    Human Prescription Only
                                </label>
                            </>
                        )}
                        {searchMode === 'rld' && (
                            <>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.95rem', color: '#334155', fontWeight: 700 }}>
                                    <input
                                        type="checkbox"
                                        checked={rldOnly}
                                        onChange={(e) => setRldOnly(e.target.checked)}
                                        style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
                                    />
                                    RLD Only
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.95rem', color: '#334155', fontWeight: 700 }}>
                                    <input
                                        type="checkbox"
                                        checked={rsOnly}
                                        onChange={(e) => setRsOnly(e.target.checked)}
                                        style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
                                    />
                                    RS Only
                                </label>
                            </>
                        )}
                    </div>
                </div>

                {hasSearched && (
                    <div style={{ background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                        <div style={{ padding: '20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
                                    Results ({searchMode === 'device' ? deviceResults.length : searchMode === 'rld' ? rldResults.length : results.length})
                                </h2>
                                {(searchMode === 'archive' && results.length > 0) && (
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        {session?.is_authenticated && (
                                            <button 
                                                onClick={handleExportToDashboardClick}
                                                style={{
                                                    padding: '8px 16px',
                                                    backgroundColor: '#2563eb',
                                                    color: '#fff',
                                                    borderRadius: '8px',
                                                    fontSize: '0.85rem',
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    border: 'none',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    transition: 'background-color 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1d4ed8'}
                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                                    <line x1="3" y1="9" x2="21" y2="9"></line>
                                                    <line x1="9" y1="21" x2="9" y2="9"></line>
                                                </svg>
                                                Export to Dashboard
                                            </button>
                                        )}
                                        <button 
                                            onClick={handleExport}
                                            style={{
                                                padding: '8px 16px',
                                                backgroundColor: '#10b981',
                                                color: '#fff',
                                                borderRadius: '8px',
                                                fontSize: '0.85rem',
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                border: 'none',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                transition: 'background-color 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#059669'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#10b981'}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                <polyline points="7 10 12 15 17 10"></polyline>
                                                <line x1="12" y1="15" x2="12" y2="3"></line>
                                            </svg>
                                            Export to Excel
                                        </button>
                                    </div>
                                )}
                            </div>
                            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                                Source: {searchMode === 'device' ? 'OPENFDA' : searchMode === 'rld' ? 'Orange Book Database' : 'Local Postgres Database'}
                            </span>
                        </div>

                        {searchMode === 'archive' && results.length > 0 ? (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead style={{ backgroundColor: '#f8fafc', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <tr>
                                            <th style={{ padding: '12px 20px' }}>Product / Generic</th>
                                            <th style={{ padding: '12px 20px' }}>Manufacturer</th>
                                            <th style={{ padding: '12px 20px' }}>App # / NDC</th>
                                            <th style={{ padding: '12px 20px' }}>Date</th>
                                            <th style={{ padding: '12px 20px' }}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody style={{ fontSize: '0.9rem', color: '#334155' }}>
                                        {results.map((r, idx) => (
                                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <div
                                                            style={{ fontWeight: 700, color: '#1e40af' }}
                                                            title={r.brand_name}
                                                        >
                                                            {r.brand_name.length > 40 ? r.brand_name.substring(0, 40) + '...' : r.brand_name}
                                                        </div>
                                                        {r.is_archived && (
                                                            <span style={{
                                                                marginLeft: '8px',
                                                                padding: '2px 6px',
                                                                backgroundColor: '#fee2e2',
                                                                color: '#b91c1c',
                                                                borderRadius: '4px',
                                                                fontSize: '0.7rem',
                                                                fontWeight: 700,
                                                                textTransform: 'uppercase'
                                                            }}>
                                                                Archived
                                                            </span>
                                                        )}
                                                        {r.has_history && (
                                                            <div
                                                                title="This label has historical versions available"
                                                                style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    width: '18px',
                                                                    height: '18px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: '#fef3c7',
                                                                    color: '#d97706',
                                                                    cursor: 'help'
                                                                }}
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M12 8v4l3 3"></path>
                                                                    <circle cx="12" cy="12" r="10"></circle>
                                                                </svg>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div
                                                        style={{ fontSize: '0.8rem', color: '#64748b' }}
                                                        title={r.generic_name}
                                                    >
                                                        {r.generic_name.length > 50 ? r.generic_name.substring(0, 50) + '...' : r.generic_name}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '16px 20px' }} title={r.manufacturer}>
                                                    {r.manufacturer.length > 40 ? r.manufacturer.substring(0, 40) + '...' : r.manufacturer}
                                                </td>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <a
                                                        href={withAppBase(`/dashboard/history_by_appr_num/${r.appr_num}`)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title={r.appr_num}
                                                        style={{
                                                            fontWeight: 600,
                                                            color: '#2563eb',
                                                            textDecoration: 'none'
                                                        }}
                                                    >
                                                        {r.appr_num.length > 25 ? r.appr_num.substring(0, 25) + '...' : r.appr_num}
                                                    </a>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{r.ndc}</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px', fontStyle: 'italic' }}>SetID: {r.set_id}</div>
                                                </td>
                                                <td style={{ padding: '16px 20px' }}>{r.revised_date}</td>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <a
                                                            href={withAppBase(`/dashboard/label/${r.set_id}${r.spl_id ? `?spl_id=${r.spl_id}` : ''}`)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{
                                                                color: '#2563eb',
                                                                textDecoration: 'none',
                                                                fontWeight: 600,
                                                                padding: '6px 12px',
                                                                borderRadius: '6px',
                                                                backgroundColor: '#eff6ff',
                                                                display: 'inline-block',
                                                                fontSize: '0.85rem'
                                                            }}
                                                        >
                                                            View Label ↗
                                                        </a>
                                                        {r.has_history ? (
                                                            <a
                                                                href={withAppBase(`/dashboard/history/${r.set_id}`)}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{
                                                                    color: '#0f172a',
                                                                    textDecoration: 'none',
                                                                    fontWeight: 600,
                                                                    padding: '6px 12px',
                                                                    borderRadius: '6px',
                                                                    backgroundColor: '#f1f5f9',
                                                                    display: 'inline-block',
                                                                    fontSize: '0.85rem',
                                                                    border: '1px solid #e2e8f0'
                                                                }}
                                                            >
                                                                History Track 🕒
                                                            </a>
                                                        ) : (
                                                            <span
                                                                title="No historical versions found in archive"
                                                                style={{
                                                                    color: '#94a3b8',
                                                                    fontWeight: 600,
                                                                    padding: '6px 12px',
                                                                    borderRadius: '6px',
                                                                    backgroundColor: '#f8fafc',
                                                                    display: 'inline-block',
                                                                    fontSize: '0.85rem',
                                                                    border: '1px solid #f1f5f9',
                                                                    cursor: 'not-allowed',
                                                                    opacity: 0.6
                                                                }}
                                                            >
                                                                History Track 🕒
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : searchMode === 'rld' && rldResults.length > 0 ? (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead style={{ backgroundColor: '#f8fafc', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <tr>
                                            <th style={{ padding: '12px 20px' }}>Ingredient / Trade Name</th>
                                            <th style={{ padding: '12px 20px' }}>Dosage & Route</th>
                                            <th style={{ padding: '12px 20px' }}>Applicant</th>
                                            <th style={{ padding: '12px 20px' }}>App / Product No</th>
                                            <th style={{ padding: '12px 20px' }}>TE Code</th>
                                            <th style={{ padding: '12px 20px' }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody style={{ fontSize: '0.9rem', color: '#334155' }}>
                                        {rldResults.map((r, idx) => (
                                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <div style={{ fontWeight: 700, color: '#1e40af' }}>{r.trade_name || 'N/A'}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{r.ingredient}</div>
                                                </td>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <div style={{ fontWeight: 600 }}>{r.strength}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{r.df_route}</div>
                                                </td>
                                                <td style={{ padding: '16px 20px' }}>{r.applicant}</td>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <a
                                                        href={withAppBase(`/dashboard/history_by_appr_num/${r.formatted_appl_no || r.appl_no}`)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}
                                                    >
                                                        {r.formatted_appl_no || r.appl_no}
                                                    </a>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Prod: {r.product_no}</div>
                                                </td>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <span 
                                                        title={getTECodeExplanation(r.te_code)}
                                                        style={{ padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: '4px', fontWeight: 600, cursor: 'help' }}
                                                    >
                                                        {r.te_code || 'N/A'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <div style={{ display: 'flex', gap: '6px', flexDirection: 'column' }}>
                                                        {r.rld === 'Yes' && <span style={{ padding: '2px 6px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, width: 'fit-content' }}>RLD</span>}
                                                        {r.rs === 'Yes' && <span style={{ padding: '2px 6px', backgroundColor: '#dbeafe', color: '#1e40af', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, width: 'fit-content' }}>RS</span>}
                                                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{r.type}</span>
                                                        {r.approval_date && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Appr: {r.approval_date}</span>}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : searchMode === 'device' && deviceResults.length > 0 ? (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead style={{ backgroundColor: '#f8fafc', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <tr>
                                            <th style={{ padding: '12px 20px', width: '50px' }}>Select</th>
                                            <th style={{ padding: '12px 20px' }}>Device Name / Type</th>
                                            <th style={{ padding: '12px 20px' }}>Manufacturer</th>
                                            <th style={{ padding: '12px 20px' }}>Product Code</th>
                                            <th style={{ padding: '12px 20px' }}>Identifier & Date</th>
                                            <th style={{ padding: '12px 20px' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody style={{ fontSize: '0.9rem', color: '#334155' }}>
                                        {deviceResults.map((r, idx) => {
                                            const isSelected = selectedDevices.some(d => d.id === r.id);
                                            return (
                                                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: isSelected ? '#eff6ff' : 'transparent' }}>
                                                    <td style={{ padding: '16px 20px' }}>
                                                        <input 
                                                            type="checkbox" 
                                                            checked={isSelected}
                                                            onChange={() => toggleSelection(r)}
                                                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3b82f6' }}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '16px 20px' }}>
                                                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{r.name}</div>
                                                        <div style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1d4ed8', backgroundColor: '#dbeafe', padding: '2px 8px', borderRadius: '100px', display: 'inline-block', marginTop: '4px' }}>
                                                            {r.type}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '16px 20px' }}>{r.manufacturer}</td>
                                                    <td style={{ padding: '16px 20px', fontFamily: 'monospace', fontWeight: 800 }}>{r.product_code || 'N/A'}</td>
                                                    <td style={{ padding: '16px 20px' }}>
                                                        <div style={{ fontWeight: 600 }}>{r.id}</div>
                                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{r.date}</div>
                                                    </td>
                                                    <td style={{ padding: '16px 20px' }}>
                                                        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                                                            <button 
                                                                style={{ padding: '6px 12px', backgroundColor: '#0f172a', color: 'white', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                                                                onClick={() => window.open(`https://api.fda.gov/device/${r.type === 'PMA' ? 'pma' : '510k'}.json?search=${r.type === 'PMA' ? 'pma_number' : 'k_number'}:${r.id}`, '_blank')}
                                                            >
                                                                FDA Metadata
                                                            </button>
                                                            {r.product_code && (
                                                                <button 
                                                                    style={{ padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                                                                    onClick={() => setAnalyzeTarget({ code: r.product_code, id: r.id })}
                                                                >
                                                                    Safety Profile
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '1.1rem' }}>
                                No results found. Try adjusting your search query.
                            </div>
                        )}
                    </div>
                )}
            </main>

            {selectedDevices.length > 0 && searchMode === 'device' && (
                <div style={{ 
                    position: 'fixed', 
                    bottom: '2rem', 
                    left: '50%', 
                    transform: 'translateX(-50%)', 
                    backgroundColor: '#1e293b', 
                    color: 'white', 
                    padding: '1rem 2rem', 
                    borderRadius: '100px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '2rem', 
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
                    zIndex: 1000
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                            {selectedDevices.length} Device{selectedDevices.length > 1 ? 's' : ''} Selected
                        </span>
                    </div>
                    <button 
                        onClick={() => setShowCompare(true)}
                        disabled={selectedDevices.length !== 2}
                        style={{ 
                            padding: '10px 20px', 
                            backgroundColor: selectedDevices.length === 2 ? '#3b82f6' : '#475569', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '100px', 
                            fontWeight: 800, 
                            cursor: selectedDevices.length === 2 ? 'pointer' : 'not-allowed',
                            transition: 'background-color 0.2s'
                        }}
                    >
                        Compare IFUs
                    </button>
                </div>
            )}

            {analyzeTarget && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', overflowY: 'auto' }}>
                    <div style={{ width: '100%', maxWidth: '1000px', margin: '2rem 0' }}>
                        <MaudeReport 
                            productCode={analyzeTarget.code} 
                            kNumber={analyzeTarget.id}
                            onClose={() => setAnalyzeTarget(null)} 
                        />
                    </div>
                </div>
            )}

            {showCompare && selectedDevices.length === 2 && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', overflowY: 'auto' }}>
                    <DeviceCompare 
                        device1={selectedDevices[0]} 
                        device2={selectedDevices[1]} 
                        onClose={() => setShowCompare(false)} 
                    />
                </div>
            )}

            <ExportWorkspaceModal 
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                onConfirm={handleExportToDashboard}
            />
            <Footer />
        </div>
    );
};

const LocalQueryPage = () => {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <LocalQueryContent />
        </Suspense>
    );
};

export default LocalQueryPage;
