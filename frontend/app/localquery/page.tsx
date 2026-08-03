"use client"
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from "../components/Header";
import Footer from '../components/Footer';
import "../globals.css";
import { withAppBase, withApiBase } from '../utils/appPaths';
import { Badge, Button, ButtonLink, EmptyState, Input } from '../platform/primitives';
import './localquery.css';

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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--afl-bg-page)' }}>
            <Header />

            <main style={{ flex: 1, padding: '40px 20px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
                <div className="lq-hero">
                    <h1 className="hero-title-animated lq-hero-title">
                        Search Databases
                    </h1>
                    <div>
                        <Link href="/search" className="lq-hero-link">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                <path d="M11 8a2 2 0 0 0-2 2"></path>
                            </svg>
                            Try Conversational AI Chat
                        </Link>
                    </div>
                </div>

                <div className="lq-search-card">
                    <div className="lq-mode-tabs" role="tablist" aria-label="Search database">
                        <div className="lq-mode-tabs__group">
                            <button
                                role="tab"
                                aria-selected={searchMode === 'archive'}
                                className="lq-mode-tab"
                                onClick={() => { setSearchMode('archive'); setHasSearched(false); setResults([]); }}
                            >
                                Drug Labeling Search
                            </button>
                            <button
                                role="tab"
                                aria-selected={searchMode === 'rld'}
                                className="lq-mode-tab"
                                onClick={() => { setSearchMode('rld'); setHasSearched(false); setRldResults([]); }}
                            >
                                Orange Book RLD Search
                            </button>
                            <button
                                role="tab"
                                aria-selected={searchMode === 'device'}
                                className="lq-mode-tab"
                                onClick={() => { setSearchMode('device'); setHasSearched(false); setDeviceResults([]); setSelectedDevices([]); }}
                            >
                                Device MAUDE Search
                            </button>
                        </div>
                    </div>
                    <form onSubmit={(e) => handleSearch(e)} className="lq-search-form">
                        <div className="lq-search-field">
                            <Input
                                type="text"
                                value={query}
                                onChange={(e) => handleInputChange(e.target.value)}
                                onFocus={() => suggestions.length > 0 && userWantsSuggestions && setShowSuggestions(true)}
                                placeholder={searchMode === 'device' ? "Search by Device Name, Manufacturer, or Identifier (e.g. K230001)..." : searchMode === 'rld' ? "Enter Ingredient, Trade Name, or App #..." : "Enter Generic name, Brand name, Set ID, or App #..."}
                            />
                            {showSuggestions && (
                                <div className="lq-suggestions">
                                    <div className="lq-suggestions__header">
                                        <span>Suggestions</span>
                                        <button
                                            className="lq-suggestions__close"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowSuggestions(false);
                                                setUserWantsSuggestions(false);
                                            }}
                                        >
                                            Close ✕
                                        </button>
                                    </div>
                                    {suggestions.map((s, i) => (
                                        <div
                                            key={i}
                                            className="lq-suggestion-item"
                                            onClick={() => handleSearch(undefined, s)}
                                        >
                                            {s}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <Button type="submit" variant="primary" size="lg" disabled={isLoading || !query.trim()}>
                            {isLoading && query ? 'Searching...' : 'Search'}
                        </Button>
                        <Button type="button" variant="secondary" size="lg" onClick={handleRandom} disabled={isLoading}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 18h2c4.3 0 6-7 10-7h2"></path>
                                <path d="M2 6h2c4.3 0 6 7 10 7h2"></path>
                                <path d="m18 9 3 3-3 3"></path>
                                <path d="m18 3 3 3-3 3"></path>
                                <path d="M22 18h-4"></path>
                            </svg>
                            {isLoading && !query ? 'Fetching...' : 'Quick Access'}
                        </Button>
                    </form>

                    <div className="lq-filters">
                        {searchMode === 'archive' && (
                            <>
                                <label className="lq-filter-label" data-disabled="true">
                                    <input type="checkbox" checked={true} disabled={true} />
                                    Archived Label
                                </label>
                                <label className="lq-filter-label">
                                    <input
                                        type="checkbox"
                                        checked={humanRxOnly}
                                        onChange={(e) => setHumanRxOnly(e.target.checked)}
                                    />
                                    Human Prescription Only
                                </label>
                            </>
                        )}
                        {searchMode === 'rld' && (
                            <>
                                <label className="lq-filter-label">
                                    <input
                                        type="checkbox"
                                        checked={rldOnly}
                                        onChange={(e) => setRldOnly(e.target.checked)}
                                    />
                                    RLD Only
                                </label>
                                <label className="lq-filter-label">
                                    <input
                                        type="checkbox"
                                        checked={rsOnly}
                                        onChange={(e) => setRsOnly(e.target.checked)}
                                    />
                                    RS Only
                                </label>
                            </>
                        )}
                    </div>
                </div>

                {hasSearched && (
                    <div className="lq-results-card">
                        <div className="lq-results-header">
                            <div className="lq-results-actions">
                                <h2 className="lq-results-title">
                                    Results ({searchMode === 'device' ? deviceResults.length : searchMode === 'rld' ? rldResults.length : results.length})
                                </h2>
                                {(searchMode === 'archive' && results.length > 0) && (
                                    <div className="lq-results-actions">
                                        {session?.is_authenticated && (
                                            <Button variant="primary" size="sm" onClick={handleExportToDashboardClick}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                                    <line x1="3" y1="9" x2="21" y2="9"></line>
                                                    <line x1="9" y1="21" x2="9" y2="9"></line>
                                                </svg>
                                                Export to Dashboard
                                            </Button>
                                        )}
                                        <Button variant="success" size="sm" onClick={handleExport}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                <polyline points="7 10 12 15 17 10"></polyline>
                                                <line x1="12" y1="15" x2="12" y2="3"></line>
                                            </svg>
                                            Export to Excel
                                        </Button>
                                    </div>
                                )}
                            </div>
                            <span className="lq-results-source">
                                Source: {searchMode === 'device' ? 'OPENFDA' : searchMode === 'rld' ? 'Orange Book Database' : 'Local Postgres Database'}
                            </span>
                        </div>

                        {searchMode === 'archive' && results.length > 0 ? (
                            <div className="afl-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                                <table className="afl-table">
                                    <thead>
                                        <tr>
                                            <th>Product / Generic</th>
                                            <th>Manufacturer</th>
                                            <th>App # / NDC</th>
                                            <th>Date</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.map((r, idx) => (
                                            <tr key={idx}>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <div className="lq-cell-primary" title={r.brand_name}>
                                                            {r.brand_name.length > 40 ? r.brand_name.substring(0, 40) + '...' : r.brand_name}
                                                        </div>
                                                        {r.is_archived && (
                                                            <Badge tone="danger" style={{ marginLeft: '8px' }}>Archived</Badge>
                                                        )}
                                                        {r.has_history && (
                                                            <div
                                                                className="lq-history-icon"
                                                                title="This label has historical versions available"
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M12 8v4l3 3"></path>
                                                                    <circle cx="12" cy="12" r="10"></circle>
                                                                </svg>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="lq-cell-secondary" title={r.generic_name}>
                                                        {r.generic_name.length > 50 ? r.generic_name.substring(0, 50) + '...' : r.generic_name}
                                                    </div>
                                                </td>
                                                <td title={r.manufacturer}>
                                                    {r.manufacturer.length > 40 ? r.manufacturer.substring(0, 40) + '...' : r.manufacturer}
                                                </td>
                                                <td>
                                                    <a
                                                        href={withAppBase(`/dashboard/history_by_appr_num/${r.appr_num}`)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title={r.appr_num}
                                                        style={{ fontWeight: 600, color: 'var(--afl-info-700)', textDecoration: 'none' }}
                                                    >
                                                        {r.appr_num.length > 25 ? r.appr_num.substring(0, 25) + '...' : r.appr_num}
                                                    </a>
                                                    <div className="lq-cell-secondary">{r.ndc}</div>
                                                    <div className="lq-cell-muted">SetID: {r.set_id}</div>
                                                </td>
                                                <td>{r.revised_date}</td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <a
                                                            href={withAppBase(`/dashboard/label/${r.set_id}${r.spl_id ? `?spl_id=${r.spl_id}` : ''}`)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="lq-action-link lq-action-link--view"
                                                        >
                                                            View Label ↗
                                                        </a>
                                                        {r.has_history ? (
                                                            <a
                                                                href={withAppBase(`/dashboard/history/${r.set_id}`)}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="lq-action-link lq-action-link--history"
                                                            >
                                                                History Track 🕒
                                                            </a>
                                                        ) : (
                                                            <span
                                                                title="No historical versions found in archive"
                                                                className="lq-action-link lq-action-link--history-disabled"
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
                            <div className="afl-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                                <table className="afl-table">
                                    <thead>
                                        <tr>
                                            <th>Ingredient / Trade Name</th>
                                            <th>Dosage & Route</th>
                                            <th>Applicant</th>
                                            <th>App / Product No</th>
                                            <th>TE Code</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rldResults.map((r, idx) => (
                                            <tr key={idx}>
                                                <td>
                                                    <div className="lq-cell-primary">{r.trade_name || 'N/A'}</div>
                                                    <div className="lq-cell-secondary">{r.ingredient}</div>
                                                </td>
                                                <td>
                                                    <div style={{ fontWeight: 600 }}>{r.strength}</div>
                                                    <div className="lq-cell-secondary">{r.df_route}</div>
                                                </td>
                                                <td>{r.applicant}</td>
                                                <td>
                                                    <a
                                                        href={withAppBase(`/dashboard/history_by_appr_num/${r.formatted_appl_no || r.appl_no}`)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ fontWeight: 600, color: 'var(--afl-info-700)', textDecoration: 'none' }}
                                                    >
                                                        {r.formatted_appl_no || r.appl_no}
                                                    </a>
                                                    <div className="lq-cell-secondary">Prod: {r.product_no}</div>
                                                </td>
                                                <td>
                                                    <span
                                                        title={getTECodeExplanation(r.te_code)}
                                                        style={{ padding: '4px 8px', backgroundColor: 'var(--afl-bg-sunken)', borderRadius: 'var(--afl-radius-sm)', fontWeight: 600, cursor: 'help' }}
                                                    >
                                                        {r.te_code || 'N/A'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '6px', flexDirection: 'column', alignItems: 'flex-start' }}>
                                                        {r.rld === 'Yes' && <Badge tone="success">RLD</Badge>}
                                                        {r.rs === 'Yes' && <Badge tone="info">RS</Badge>}
                                                        <span className="lq-cell-secondary">{r.type}</span>
                                                        {r.approval_date && <span className="lq-cell-muted" style={{ marginTop: 0 }}>Appr: {r.approval_date}</span>}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : searchMode === 'device' && deviceResults.length > 0 ? (
                            <div className="afl-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                                <table className="afl-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '50px' }}>Select</th>
                                            <th>Device Name / Type</th>
                                            <th>Manufacturer</th>
                                            <th>Product Code</th>
                                            <th>Identifier & Date</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {deviceResults.map((r, idx) => {
                                            const isSelected = selectedDevices.some(d => d.id === r.id);
                                            return (
                                                <tr key={idx} data-selected={isSelected}>
                                                    <td>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleSelection(r)}
                                                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--afl-info-500)' }}
                                                        />
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 700, color: 'var(--afl-text-primary)' }}>{r.name}</div>
                                                        <div style={{ marginTop: '4px' }}>
                                                            <Badge tone="info">{r.type}</Badge>
                                                        </div>
                                                    </td>
                                                    <td>{r.manufacturer}</td>
                                                    <td style={{ fontFamily: 'var(--afl-font-mono)', fontWeight: 800 }}>{r.product_code || 'N/A'}</td>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>{r.id}</div>
                                                        <div className="lq-cell-secondary">{r.date}</div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'flex-start' }}>
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                style={{ background: 'var(--afl-n-900)', color: 'var(--afl-text-inverse)', borderColor: 'var(--afl-n-900)' }}
                                                                onClick={() => window.open(`https://api.fda.gov/device/${r.type === 'PMA' ? 'pma' : '510k'}.json?search=${r.type === 'PMA' ? 'pma_number' : 'k_number'}:${r.id}`, '_blank')}
                                                            >
                                                                FDA Metadata
                                                            </Button>
                                                            {r.product_code && (
                                                                <Button
                                                                    variant="info"
                                                                    size="sm"
                                                                    onClick={() => setAnalyzeTarget({ code: r.product_code, id: r.id })}
                                                                >
                                                                    Safety Profile
                                                                </Button>
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
                            <EmptyState
                                style={{ padding: 'var(--afl-space-7)' }}
                                title="No results found"
                                description="Try adjusting your search query."
                            />
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
                    backgroundColor: 'var(--afl-n-800)',
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
                            backgroundColor: selectedDevices.length === 2 ? 'var(--afl-info-500)' : 'var(--afl-n-600)',
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
