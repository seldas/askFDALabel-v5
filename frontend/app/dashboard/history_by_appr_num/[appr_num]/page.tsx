'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import '../../../globals.css';
import styles from '../../HistoryTrackPage.module.css';
import { withAppBase, withApiBase } from '../../../utils/appPaths';

interface HistoryRecord {
    spl_id: string;
    set_id: string;
    product_names: string;
    generic_names: string;
    revised_date: string;
    version_number: number;
    is_latest: boolean;
    has_analysis: boolean;
    executive_summary: string | null;
    is_regulatory_notable: boolean;
    last_analyzed_at: string | null;
}

interface DiffItem {
    key: string;
    title: string;
    diff_new: string;
    diff_old: string;
    is_addition: boolean;
    is_deletion: boolean;
}

const HistoryTrackPage = () => {
    const params = useParams();
    const appr_num = params.appr_num as string;
    const router = useRouter();

    const [history, setHistory] = useState<HistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDiffLoading, setIsDiffLoading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedSplId, setSelectedSplId] = useState<string | null>(null);
    const [diffResults, setDiffResults] = useState<DiffItem[]>([]);
    const [expandedSectionKey, setExpandedSectionKey] = useState<string | null>(null);
    const [showFullContentKeys, setShowFullContentKeys] = useState<Record<string, boolean>>({});
    const [timelineFilter, setTimelineFilter] = useState('');
    const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(false);

    const toggleSection = (key: string) => {
        setExpandedSectionKey(expandedSectionKey === key ? null : key);
    };

    const toggleFullContent = (key: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setShowFullContentKeys(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const fetchHistory = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(withApiBase(`/api/dashboard/history_by_appr_num/${appr_num}`));
            const data = await res.json();
            if (data.results) {
                setHistory(data.results);
                if (data.results.length > 0 && !selectedSplId) {
                    setSelectedSplId(data.results[0].spl_id);
                }
            } else if (data.error) {
                setError(data.error);
            }
        } catch (err) {
            console.error("History fetch error", err);
            setError("Failed to load version history.");
        } finally {
            setIsLoading(false);
        }
    }, [appr_num, selectedSplId]);

    // Fetch lineage
    useEffect(() => {
        if (appr_num) fetchHistory();
    }, [appr_num, fetchHistory]);

    const handleAnalyze = async () => {
        if (!selectedSplId || !previousRecord) return;
        
        setIsAnalyzing(true);
        try {
            const res = await fetch(withApiBase('/api/dashboard/history/analyze'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_spl_id: selectedSplId,
                    previous_spl_id: previousRecord.spl_id,
                    force_refresh: true
                })
            });
            const data = await res.json();
            if (data.success) {
                // Refresh history to show the summary
                await fetchHistory();
            } else {
                alert("Analysis failed: " + (data.error || "Unknown error"));
            }
        } catch (err) {
            console.error("Analysis trigger error", err);
            alert("Failed to start analysis.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const groupedData = useMemo(() => {
        const bySetId: Record<string, HistoryRecord[]> = {};
        const allDatesSet = new Set<string>();
        
        history.forEach(h => {
            if (!bySetId[h.set_id]) bySetId[h.set_id] = [];
            bySetId[h.set_id].push(h);
            allDatesSet.add(h.revised_date);
        });

        // Sort each set's history by version DESC
        Object.values(bySetId).forEach(list => {
            list.sort((a, b) => (b.version_number || 0) - (a.version_number || 0));
        });

        const sortedDates = Array.from(allDatesSet).sort((a, b) => 
            new Date(a).getTime() - new Date(b).getTime()
        );

        return { bySetId, sortedDates };
    }, [history]);

    const activeRecord = useMemo(() => 
        history.find(h => h.spl_id === selectedSplId), 
    [history, selectedSplId]);

    const previousRecord = useMemo(() => {
        if (!selectedSplId || !activeRecord) return null;
        const setHistory = groupedData.bySetId[activeRecord.set_id] || [];
        const idx = setHistory.findIndex(h => h.spl_id === selectedSplId);
        if (idx !== -1 && idx < setHistory.length - 1) {
            return setHistory[idx + 1]; 
        }
        return null;
    }, [groupedData, selectedSplId, activeRecord]);

    // Fetch diff whenever selectedSplId changes
    useEffect(() => {
        const fetchDiff = async () => {
            if (!selectedSplId || !previousRecord) {
                setDiffResults([]);
                return;
            }
            setIsDiffLoading(true);
            try {
                const res = await fetch(withApiBase(`/api/dashboard/history/diff/${selectedSplId}/${previousRecord.spl_id}`));
                const data = await res.json();
                if (data.diff) {
                    setDiffResults(data.diff);
                } else {
                    setDiffResults([]);
                }
            } catch (err) {
                console.error("Diff fetch error", err);
            } finally {
                setIsDiffLoading(false);
            }
        };
        fetchDiff();
    }, [selectedSplId, previousRecord]);

    if (isLoading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                <Header />
                <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="loader"></div>
                </main>
                <Footer />
            </div>
        );
    }

    if (error || history.length === 0) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                <Header />
                <main style={{ flex: 1, padding: '40px', textAlign: 'center' }}>
                    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '40px', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <h2 style={{ color: '#ef4444', marginBottom: '10px' }}>History Not Found</h2>
                        <p style={{ color: '#64748b' }}>{error || "No version history exists for this Application Number in the local archive."}</p>
                        <button 
                            onClick={() => router.back()}
                            style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        >
                            Go Back
                        </button>
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#f8fafc', overflow: 'hidden' }}>
            <Header />

            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
                {/* MAIN CONTENT AREA */}
                <main style={{ flex: 1, backgroundColor: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ 
                        padding: '15px 40px', 
                        borderBottom: '1px solid #f1f5f9', 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        position: 'sticky',
                        top: 0,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        backdropFilter: 'blur(8px)',
                        zIndex: 10
                    }}>
                        <div>
                            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                                {appr_num} - Version Comparison
                            </h1>
                            <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '2px' }}>
                                Comparing <strong>v{activeRecord?.version_number}</strong> ({activeRecord?.revised_date}) 
                                {previousRecord ? (
                                    <> vs <strong>v{previousRecord.version_number}</strong> ({previousRecord.revised_date})</>
                                ) : (
                                    <> (Initial Version)</>
                                )}
                                <span style={{ marginLeft: '12px', padding: '2px 8px', backgroundColor: '#f1f5f9', borderRadius: '4px', fontWeight: 600 }}>SetID: {activeRecord?.set_id}</span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                                onClick={() => window.open(withAppBase(`/dashboard/label/${activeRecord?.set_id}?spl_id=${activeRecord?.spl_id}`), '_blank')}
                                style={{ padding: '6px 14px', backgroundColor: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '6px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
                            >
                                View Label
                            </button>
                            <button 
                                onClick={handleAnalyze}
                                disabled={isAnalyzing || !previousRecord || (diffResults.length === 0 && !isDiffLoading)}
                                style={{ 
                                    padding: '6px 14px', 
                                    backgroundColor: (isAnalyzing || (diffResults.length === 0 && !isDiffLoading)) ? '#94a3b8' : '#1e40af', 
                                    color: '#fff', 
                                    border: 'none', 
                                    borderRadius: '6px', 
                                    fontWeight: 600, 
                                    fontSize: '0.8rem', 
                                    cursor: (isAnalyzing || (diffResults.length === 0 && !isDiffLoading)) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                {isAnalyzing ? 'Analyzing...' : 'Analyze Changes'}
                            </button>
                        </div>
                    </div>

                    <div style={{ padding: '30px 40px' }}>
                        {activeRecord?.has_analysis && activeRecord.executive_summary && (
                            <div style={{ 
                                backgroundColor: '#fffbeb', 
                                border: '1px solid #fde68a', 
                                borderRadius: '12px', 
                                padding: '20px',
                                marginBottom: '25px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '1.1rem' }}>✨</span>
                                    <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                                        AI Change Summary
                                    </h3>
                                </div>
                                <p style={{ color: '#92400e', lineHeight: 1.5, fontSize: '0.9rem', marginBottom: '15px' }}>
                                    {activeRecord.executive_summary}
                                </p>
                                {previousRecord && (
                                    <a 
                                        href={withAppBase(`/labelcomp?set_ids=${previousRecord?.set_id}&set_ids=${activeRecord?.set_id}&spl_ids=${previousRecord?.spl_id}&spl_ids=${activeRecord?.spl_id}`)} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        style={{
                                            display: 'inline-block',
                                            padding: '6px 12px',
                                            backgroundColor: '#2563eb',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            fontWeight: 600,
                                            fontSize: '0.8rem',
                                            cursor: 'pointer',
                                            textDecoration: 'none'
                                        }}
                                    >
                                        Deep Comparison View ↗
                                    </a>
                                )}
                            </div>
                        )}

                        {!previousRecord ? (
                            <div style={{ padding: '80px 0', textAlign: 'center' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}>🚀</div>
                                <h2 style={{ color: '#1e293b', fontSize: '1.1rem' }}>Initial Version</h2>
                                <p style={{ color: '#64748b', maxWidth: '400px', margin: '8px auto', fontSize: '0.9rem' }}>
                                    This is the earliest recorded version for this SetID. Select a newer version to see changes.
                                </p>
                            </div>
                        ) : isDiffLoading ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
                                <div className="loader"></div>
                            </div>
                        ) : diffResults.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '80px 0', color: '#64748b' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}>ℹ️</div>
                                <h3 style={{ fontSize: '1rem', color: '#1e293b' }}>No significant updates identified</h3>
                                <p style={{ fontSize: '0.9rem', maxWidth: '400px', margin: '8px auto' }}>
                                    No significant updates have been identified in this version compared to the previous one.
                                </p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ marginBottom: '15px', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Modified Sections ({diffResults.length})
                                </div>
                                {diffResults.map((item) => {
                                    const isExpanded = expandedSectionKey === item.key;
                                    const showFull = showFullContentKeys[item.key] || false;
                                    const isVeryLong = item.diff_new.length > 2000 || item.diff_old.length > 2000;

                                    return (
                                        <div key={item.key} className={styles.accordionItem}>
                                            <div className={styles.accordionHeader} onClick={() => toggleSection(item.key)}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <span style={{ 
                                                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', 
                                                        transition: 'transform 0.2s',
                                                        fontSize: '0.7rem',
                                                        color: '#94a3b8'
                                                    }}>▶</span>
                                                    <h3 className={styles.accordionTitle}>{item.title}</h3>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    {item.is_addition && <span style={{ fontSize: '0.6rem', padding: '2px 6px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', fontWeight: 800 }}>NEW</span>}
                                                    {item.is_deletion && <span style={{ fontSize: '0.6rem', padding: '2px 6px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontWeight: 800 }}>REMOVED</span>}
                                                    {!item.is_addition && !item.is_deletion && <span style={{ fontSize: '0.6rem', padding: '2px 6px', backgroundColor: '#f1f5f9', color: '#64748b', borderRadius: '4px', fontWeight: 800 }}>CHANGED</span>}
                                                </div>
                                            </div>
                                            
                                            <div className={`${styles.accordionContent} ${isExpanded ? styles.accordionContentExpanded : ''}`}>
                                                <div className={styles.diffGrid}>
                                                    {/* OLD VERSION PANE */}
                                                    <div className={styles.diffPane}>
                                                        <div className={styles.paneHeader}>PREVIOUS (v{previousRecord?.version_number})</div>
                                                        <div className={`${styles.longContentContainer} ${showFull ? styles.contentExpanded : ''}`}>
                                                            <div 
                                                                className={`diff-content ${styles.diffContainer}`}
                                                                style={{ fontSize: '0.85rem', lineHeight: 1.6, color: '#64748b' }}
                                                                dangerouslySetInnerHTML={{ __html: item.diff_old || '<i style="color: #cbd5e1">Empty</i>' }}
                                                            />
                                                            {isVeryLong && !showFull && <div className={styles.showMoreOverlay}></div>}
                                                        </div>
                                                    </div>

                                                    {/* NEW VERSION PANE */}
                                                    <div className={styles.diffPane}>
                                                        <div className={styles.paneHeader}>CURRENT (v{activeRecord?.version_number})</div>
                                                        <div className={`${styles.longContentContainer} ${showFull ? styles.contentExpanded : ''}`}>
                                                            <div 
                                                                className={`diff-content ${styles.diffContainer}`}
                                                                style={{ fontSize: '0.85rem', lineHeight: 1.6, color: '#0f172a' }}
                                                                dangerouslySetInnerHTML={{ __html: item.diff_new || '<i style="color: #cbd5e1">Empty</i>' }}
                                                            />
                                                            {isVeryLong && !showFull && (
                                                                <div className={styles.showMoreOverlay}>
                                                                    <button className={styles.showMoreButton} onClick={(e) => toggleFullContent(item.key, e)}>
                                                                        Show Full Differences
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                {showFull && (
                                                    <div style={{ padding: '10px 20px', borderTop: '1px solid #f1f5f9', textAlign: 'center', backgroundColor: '#f8fafc' }}>
                                                        <button className={styles.showMoreButton} onClick={(e) => toggleFullContent(item.key, e)}>
                                                            Collapse Section
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </main>

                {/* BOTTOM TIMELINE */}
                <div style={{ 
                    height: isTimelineCollapsed ? '45px' : '280px', 
                    backgroundColor: '#fff', 
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: 20,
                    transition: 'height 0.3s ease'
                }}>
                    <div style={{ 
                        padding: '10px 20px', 
                        borderBottom: '1px solid #f1f5f9', 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '10px',
                        cursor: 'pointer'
                    }} onClick={() => setIsTimelineCollapsed(!isTimelineCollapsed)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ transform: isTimelineCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.3s' }}>▲</span>
                                Historical Lineage
                            </span>
                            {!isTimelineCollapsed && (
                                <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                                    <input 
                                        type="text" 
                                        placeholder="Filter Set-ID or Product..." 
                                        value={timelineFilter}
                                        onChange={(e) => setTimelineFilter(e.target.value)}
                                        style={{
                                            padding: '4px 10px 4px 28px',
                                            fontSize: '0.75rem',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '4px',
                                            width: '200px',
                                            outline: 'none'
                                        }}
                                    />
                                    <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: '#94a3b8' }}>🔍</span>
                                </div>
                            )}
                        </div>
                        {!isTimelineCollapsed && (
                            <div style={{ display: 'flex', gap: '15px', fontSize: '0.75rem', color: '#94a3b8' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', border: '2px solid #cbd5e1' }}></div> Historical</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1e40af' }}></div> Selected</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></div> Current</div>
                            </div>
                        )}
                        {isTimelineCollapsed && (
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                Selected: <strong>v{activeRecord?.version_number}</strong> ({activeRecord?.revised_date})
                            </div>
                        )}
                    </div>

                    {!isTimelineCollapsed && (
                        <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
                            <div style={{ minWidth: 'max-content', paddingBottom: '20px' }}>
                                <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
                                    <thead style={{ position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#fff' }}>
                                        <tr>
                                            <th style={{ 
                                                minWidth: '220px', 
                                                textAlign: 'left', 
                                                padding: '12px 20px', 
                                                fontSize: '0.7rem', 
                                                color: '#94a3b8', 
                                                fontWeight: 800, 
                                                textTransform: 'uppercase',
                                                backgroundColor: '#f8fafc',
                                                borderBottom: '1px solid #e2e8f0',
                                                position: 'sticky',
                                                left: 0,
                                                zIndex: 35
                                            }}>
                                                Set-ID / Product
                                            </th>
                                            {groupedData.sortedDates.map(date => (
                                                <th key={date} style={{ 
                                                    minWidth: '120px', 
                                                    textAlign: 'center', 
                                                    padding: '12px 10px',
                                                    backgroundColor: '#f8fafc',
                                                    borderBottom: '1px solid #e2e8f0'
                                                }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{date}</div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.keys(groupedData.bySetId)
                                            .filter(setId => {
                                                const pName = groupedData.bySetId[setId][0].product_names || '';
                                                return setId.toLowerCase().includes(timelineFilter.toLowerCase()) || 
                                                       pName.toLowerCase().includes(timelineFilter.toLowerCase());
                                            })
                                            .map(setId => (
                                            <tr key={setId}>
                                                <td style={{ 
                                                    padding: '12px 20px', 
                                                    verticalAlign: 'middle', 
                                                    backgroundColor: '#fff', 
                                                    borderBottom: '1px solid #f1f5f9',
                                                    position: 'sticky',
                                                    left: 0,
                                                    zIndex: 10,
                                                    boxShadow: '4px 0 4px -2px rgba(0,0,0,0.05)'
                                                }}>
                                                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={setId}>
                                                        {setId}
                                                    </div>
                                                    <div style={{ fontSize: '0.65rem', color: '#64748b', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {groupedData.bySetId[setId][0].product_names?.split(';')[0]}
                                                    </div>
                                                </td>
                                                {groupedData.sortedDates.map(date => {
                                                    const record = groupedData.bySetId[setId].find(r => r.revised_date === date);
                                                    const isSelected = record?.spl_id === selectedSplId;
                                                    return (
                                                        <td key={date} style={{ position: 'relative', padding: '0 10px', textAlign: 'center', verticalAlign: 'middle', borderBottom: '1px solid #f1f5f9' }}>
                                                            {/* Connector line (horizontal) */}
                                                            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: '1px', backgroundColor: '#f1f5f9', zIndex: 1 }}></div>
                                                            
                                                            {record && (
                                                                <div 
                                                                    onClick={() => setSelectedSplId(record.spl_id)}
                                                                    style={{
                                                                        position: 'relative',
                                                                        zIndex: 5,
                                                                        width: '24px',
                                                                        height: '24px',
                                                                        borderRadius: '50%',
                                                                        backgroundColor: isSelected ? '#1e40af' : (record.is_latest ? '#10b981' : '#fff'),
                                                                        border: `2px solid ${isSelected ? '#1e40af' : (record.is_latest ? '#10b981' : '#cbd5e1')}`,
                                                                        margin: '0 auto',
                                                                        cursor: 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        transition: 'transform 0.2s',
                                                                        boxShadow: isSelected ? '0 0 0 4px rgba(30, 64, 175, 0.15)' : 'none'
                                                                    }}
                                                                    onMouseOver={e => e.currentTarget.style.transform = 'scale(1.2)'}
                                                                    onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
                                                                    title={`v${record.version_number} - ${record.revised_date}`}
                                                                >
                                                                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: isSelected || record.is_latest ? '#fff' : '#64748b' }}>
                                                                        {record.version_number}
                                                                    </span>
                                                                    
                                                                    {record.is_regulatory_notable && (
                                                                        <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '0.8rem' }} title="Regulatory Notable Change">⚠️</div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <Footer />
        </div>
    );
};

export default HistoryTrackPage;
