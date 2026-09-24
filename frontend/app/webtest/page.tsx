'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useUser } from '../context/UserContext';
import RequireFeature from '../components/RequireFeature';
import { 
    LineChart, Line, XAxis, YAxis, CartesianGrid, 
    Tooltip, ResponsiveContainer
} from 'recharts';
import { API_BASE } from '../utils/appPaths';
import './webtest-workstation.css';

interface TestResult {
    task_id: number;
    version: string;
    url: string;
    query_details: string;
    status: string;
    count: string;
    time_to_ready: number;
    prev_count?: string;
    prev_time?: number;
}

interface CalendarDate {
    date: string;
    run_count: number;
    task_count: number;
}

interface SnapshotTask {
    task_id: number;
    task_num: number;
    query_details: string;
    versions: Record<string, {
        latest: { count: string | null; delay: number | null };
        runs: Array<{ count: string | null; delay: number | null; time: string; notes: string }>;
    }>;
    urls?: Record<string, string>;
}

const BACKEND_API_PREFIX = API_BASE;
const WEBTEST_API_PREFIX = `${BACKEND_API_PREFIX}/api/webtest`;
const webtestEndpoint = (suffix: string) => `${WEBTEST_API_PREFIX}${suffix}`;

// Canonical version ordering for columns
const VERSION_ORDER = [
    'PROD - FDA', 'PROD - CDER-CBER',
    'PUBLIC - FDA', 'PUBLIC - CDER-CBER',
    'TEST - FDA', 'TEST - CDER-CBER',
    'DEV - FDA',
];

function getVersionColor(v: string) {
    const vUpper = v.toUpperCase();
    if (vUpper.includes('PROD')) return vUpper.includes('CDER') ? 'var(--fdl-navy-800)' : 'var(--fdl-blue-700)';
    if (vUpper.includes('PUBLIC')) return vUpper.includes('CDER') ? '#1e5634' : 'var(--fdl-green)';
    if (vUpper.includes('TEST')) return vUpper.includes('CDER') ? '#b46a00' : 'var(--fdl-amber)';
    if (vUpper.includes('DEV')) return 'var(--fdl-muted)';
    return 'var(--fdl-ink-soft)';
}

function formatCount(c: string | null | undefined): string {
    if (c == null || c === 'N/A' || c === '') return '—';
    return c;
}

function countBg(c: string | null | undefined): string {
    if (!c || c === 'N/A' || c === '—') return 'transparent';
    const n = parseInt(c);
    if (isNaN(n)) return 'var(--fdl-canvas)';
    if (n === 0) return 'var(--fdl-red-050)';
    return 'var(--fdl-green-050)';
}

function countColor(c: string | null | undefined): string {
    if (!c || c === 'N/A' || c === '—') return 'var(--fdl-muted)';
    const n = parseInt(c);
    if (isNaN(n)) return 'var(--fdl-ink-soft)';
    if (n === 0) return 'var(--fdl-red)';
    return 'var(--fdl-green)';
}

function countBorder(c: string | null | undefined): string {
    if (!c || c === 'N/A' || c === '—') return 'transparent';
    const n = parseInt(c);
    if (isNaN(n)) return 'var(--fdl-line-soft)';
    if (n === 0) return 'rgba(181, 9, 9, 0.25)';
    return 'rgba(45, 122, 76, 0.25)';
}

function WebTestingPageInner() {
    const { session, openAuthModal } = useUser();
    const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
    const [totalTasks, setTotalTasks] = useState(0);
    const [results, setResults] = useState<TestResult[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [taskProgress, setTaskProgress] = useState<number>(0);

    // Calendar state
    const [calendarDates, setCalendarDates] = useState<CalendarDate[]>([]);
    const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
        const d = new Date(); d.setDate(1); return d;
    });
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dateSnapshot, setDateSnapshot] = useState<SnapshotTask[]>([]);
    const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
    const [activeVersions, setActiveVersions] = useState<string[]>([]);

    // Tooltip hover
    const [hoveredCell, setHoveredCell] = useState<{ taskId: number; version: string } | null>(null);

    // Selected task detail
    const [selectedTask, setSelectedTask] = useState<SnapshotTask | null>(null);
    const [taskHistory, setTaskHistory] = useState<any[]>([]);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [historyRange, setHistoryRange] = useState<'3m' | '1y' | 'all'>('1y');
    const [showOutliers, setShowOutliers] = useState(false);
    const [hiddenLines, setHiddenLines] = useState<string[]>([]);

    // Download controls
    const [downloadRange, setDownloadRange] = useState<'1m' | '3m' | '1y' | 'custom'>('1m');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [isDownloadingHistory, setIsDownloadingHistory] = useState(false);

    const stopRef = useRef(false);
    const chartRef = useRef<HTMLDivElement>(null);

    const toggleLine = (v: string) => {
        setHiddenLines(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
    };

    // ── API calls ──────────────────────────────────────────────────────────

    const fetchTasksInfo = async () => {
        try {
            const response = await fetch(webtestEndpoint('/tasks_info'));
            const data = await response.json();
            if (data.tasks) {
                setTotalTasks(data.total_tasks);
                setResults(data.tasks);
            }
        } catch (err) { console.error('Failed to fetch tasks info', err); }
    };

    const fetchCalendarDates = async () => {
        try {
            const res = await fetch(webtestEndpoint('/calendar_dates?range=all'));
            const data = await res.json();
            setCalendarDates(Array.isArray(data) ? data : []);
        } catch (err) { console.error('Failed to fetch calendar dates', err); }
    };

    const fetchDateSnapshot = async (date: string) => {
        setIsSnapshotLoading(true);
        setSelectedTask(null);
        setTaskHistory([]);
        try {
            const res = await fetch(webtestEndpoint(`/date_snapshot?date=${date}`));
            const data = await res.json();
            if (Array.isArray(data)) {
                setDateSnapshot(data);
                // Derive which versions exist in this snapshot
                const vSet = new Set<string>();
                data.forEach((t: SnapshotTask) => Object.keys(t.versions).forEach(v => vSet.add(v)));
                const ordered = VERSION_ORDER.filter(v => vSet.has(v));
                Array.from(vSet).forEach(v => { if (!ordered.includes(v)) ordered.push(v); });
                setActiveVersions(ordered);
            } else {
                setDateSnapshot([]);
                setActiveVersions([]);
            }
        } catch (err) { console.error('Failed to fetch date snapshot', err); }
        finally { setIsSnapshotLoading(false); }
    };

    const fetchTaskHistory = async (task: SnapshotTask) => {
        setIsHistoryLoading(true);
        try {
            const res = await fetch(`${webtestEndpoint('/group_history')}?query_details=${encodeURIComponent(task.query_details)}&range=${historyRange}`);
            const data = await res.json();
            if (!Array.isArray(data)) { setTaskHistory([]); return; }

            const DELAY_START = new Date('2025-06-01T00:00:00');
            const TECH_CUTOFF = new Date('2026-03-01T00:00:00').getTime();
            const dateMap = new Map<string, any>();
            data.forEach((h: any) => {
                const hDate = new Date(h.Date);
                const date = h.Date.split(' ')[0];
                if (!dateMap.has(date)) {
                    dateMap.set(date, { Date: date, DisplayDate: date.replace('2026-', ''), Timestamp: hDate.getTime() });
                }
                const entry = dateMap.get(date);
                entry[`count_${h.Version}`] = parseInt(h.Count) || 0;
                entry[`delay_${h.Version}`] = hDate >= DELAY_START ? h.Delay : null;
            });
            const sorted = Array.from(dateMap.values()).sort((a, b) => a.Timestamp - b.Timestamp);
            const formatted: any[] = [];
            for (let i = 0; i < sorted.length; i++) {
                if (i > 0 && sorted[i-1].Timestamp < TECH_CUTOFF && sorted[i].Timestamp > TECH_CUTOFF) {
                    formatted.push({ Date: '2026-03-01 (Tech Shift)', DisplayDate: ' ', Timestamp: TECH_CUTOFF, isBreak: true });
                }
                formatted.push(sorted[i]);
            }
            setTaskHistory(formatted);
        } catch (err) { console.error('Failed to fetch task history', err); }
        finally { setIsHistoryLoading(false); }
    };

    useEffect(() => {
        fetchTasksInfo();
        fetchCalendarDates();
    }, []);

    useEffect(() => {
        if (selectedTask) {
            fetchTaskHistory(selectedTask);
            setTimeout(() => chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
    }, [selectedTask, historyRange]);

    // ── Chart versions ─────────────────────────────────────────────────────
    const chartVersions = useMemo(() => {
        const versions = new Set<string>();
        taskHistory.forEach(h => {
            Object.keys(h).forEach(k => { if (k.startsWith('count_')) versions.add(k.replace('count_', '')); });
        });
        return Array.from(versions);
    }, [taskHistory]);

    useEffect(() => {
        if (chartVersions.length > 0) {
            setHiddenLines(chartVersions.filter(v => v.includes('DEV') || v.includes('TEST')));
        }
    }, [chartVersions]);

    // ── Automation ─────────────────────────────────────────────────────────
    const startAutomation = async () => {
        if (!session?.is_authenticated) { openAuthModal('login'); return; }
        if (results.length === 0) return;
        setStatus('running'); stopRef.current = false; setError(null); setTaskProgress(0);
        try {
            const response = await fetch(webtestEndpoint('/start_test'), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (response.status === 401) { setStatus('idle'); openAuthModal('login'); return; }
            const data = await response.json();
            if (!data.success) { setError(data.error || 'Failed to start'); setStatus('failed'); return; }
            const taskId = data.task_id;
            const pollStatus = async () => {
                if (stopRef.current) {
                    await fetch(`${BACKEND_API_PREFIX}/api/dashboard/tasks/${taskId}/cancel`, { method: 'POST' });
                    setStatus('idle'); return;
                }
                try {
                    const statusRes = await fetch(`${BACKEND_API_PREFIX}/api/dashboard/tasks/${taskId}`);
                    const statusData = await statusRes.json();
                    if (statusData.success && statusData.task) {
                        const task = statusData.task;
                        setTaskProgress(task.progress || 0);
                        if (task.status === 'completed') {
                            setStatus('completed');
                            fetchTasksInfo();
                            fetchCalendarDates();
                            return;
                        } else if (task.status === 'failed') {
                            setError(task.error_details || 'Task failed'); setStatus('failed'); return;
                        } else if (task.status === 'cancelled') { setStatus('idle'); return; }
                    }
                    setTimeout(pollStatus, 2000);
                } catch { setTimeout(pollStatus, 2000); }
            };
            pollStatus();
        } catch { setError('Failed to start automation'); setStatus('failed'); }
    };

    const downloadHistory = async () => {
        setIsDownloadingHistory(true);
        try {
            let startDate = customStartDate, endDate = customEndDate;
            if (downloadRange !== 'custom') {
                const end = new Date(), start = new Date();
                if (downloadRange === '1m') start.setMonth(start.getMonth() - 1);
                else if (downloadRange === '3m') start.setMonth(start.getMonth() - 3);
                else start.setFullYear(start.getFullYear() - 1);
                startDate = start.toISOString().split('T')[0];
                endDate = end.toISOString().split('T')[0];
            }
            const res = await fetch(webtestEndpoint('/download_history'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start_date: startDate, end_date: endDate })
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url;
                const cd = res.headers.get('Content-Disposition');
                a.download = cd?.includes('filename=') ? cd.split('filename=')[1].replace(/"/g, '') : 'webtest_history.xlsx';
                a.click();
            } else { alert('Failed to download history'); }
        } catch { alert('Failed to download history'); }
        finally { setIsDownloadingHistory(false); }
    };

    // ── Calendar helpers ───────────────────────────────────────────────────
    const calendarDateSet = useMemo(() => {
        const m = new Map<string, CalendarDate>();
        calendarDates.forEach(d => m.set(d.date, d));
        return m;
    }, [calendarDates]);

    const calendarDays = useMemo(() => {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const days: (number | null)[] = [];
        for (let i = 0; i < firstDay; i++) days.push(null);
        for (let d = 1; d <= daysInMonth; d++) days.push(d);
        return days;
    }, [calendarMonth]);

    const formatMonthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const toDateStr = (day: number) => {
        const y = calendarMonth.getFullYear();
        const m = String(calendarMonth.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}-${String(day).padStart(2, '0')}`;
    };

    const today = new Date().toISOString().split('T')[0];

    // ── Chart data processing ──────────────────────────────────────────────
    const processedChartData = useMemo(() => {
        if (!taskHistory || taskHistory.length === 0) return [];
        let delays: number[] = [], counts: number[] = [];
        taskHistory.forEach(h => {
            if (h.isBreak) return;
            chartVersions.forEach(v => {
                if (typeof h[`delay_${v}`] === 'number') delays.push(h[`delay_${v}`]);
                if (typeof h[`count_${v}`] === 'number') counts.push(h[`count_${v}`]);
            });
        });
        delays.sort((a,b) => a-b); counts.sort((a,b) => a-b);
        const getIQR = (arr: number[]) => {
            if (arr.length < 4) return { lower: -Infinity, upper: Infinity };
            const q1 = arr[Math.floor(arr.length * 0.25)], q3 = arr[Math.floor(arr.length * 0.75)], iqr = q3-q1;
            return { lower: Math.max(0, q1 - 1.5*iqr), upper: q3 + 1.5*iqr };
        };
        const dBounds = getIQR(delays), cBounds = getIQR(counts);
        return taskHistory.map(h => {
            if (h.isBreak) return h;
            let isOutlier = false; const newH = { ...h };
            chartVersions.forEach(v => {
                const d = h[`delay_${v}`], c = h[`count_${v}`];
                if (d != null && (d < dBounds.lower || d > dBounds.upper)) { isOutlier = true; if (!showOutliers) newH[`delay_${v}`] = null; }
                if (c != null && (c < cBounds.lower || c > cBounds.upper)) { isOutlier = true; if (!showOutliers) newH[`count_${v}`] = null; }
            });
            newH._isOutlier = isOutlier;
            return newH;
        });
    }, [taskHistory, chartVersions, showOutliers]);

    const processedCount = results.filter(r => r.status !== 'pending').length;
    const totalTrackedRecords = useMemo(() => {
        return calendarDates.reduce((s, d) => s + d.run_count, 0);
    }, [calendarDates]);

    return (
        <div className="webtest-container">
            <Header />
            <main className="webtest-layout">
                {/* ── Workstation Precision Header ──────────────────────────── */}
                <div className="webtest-header">
                    <div className="webtest-header-titles">
                        <span className="webtest-region-code">SYSTEM / REGRESSION-SURVEILLANCE</span>
                        <h1 className="webtest-title">Automated Regression Testing & Surveillance</h1>
                        <p className="webtest-subtitle">
                            Monitor query latency drift, hit counts, and cross-endpoint parity across FDA production, test, and development instances.
                        </p>
                    </div>
                    <div className="webtest-header-stats">
                        <div className="webtest-stat-chip">
                            <span className="webtest-stat-chip__label">Configured Tasks</span>
                            <span className="webtest-stat-chip__value">{totalTasks}</span>
                        </div>
                        <div className="webtest-stat-chip">
                            <span className="webtest-stat-chip__label">Tracked Days</span>
                            <span className="webtest-stat-chip__value">{calendarDates.length}</span>
                        </div>
                        <div className="webtest-stat-chip">
                            <span className="webtest-stat-chip__label">Total Runs</span>
                            <span className="webtest-stat-chip__value">{totalTrackedRecords.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                {/* ── Action & Control Toolbar ─────────────────────────────── */}
                <div className="webtest-toolbar">
                    <div className="webtest-toolbar-group">
                        <span className={`webtest-status-badge webtest-status-badge--${status}`}>
                            {status === 'running' && <span className="webtest-spinner" style={{ width: '10px', height: '10px' }} />}
                            {status}
                        </span>

                        {status === 'running' && (
                            <span className="webtest-progress-text">{taskProgress}%</span>
                        )}

                        {status !== 'running' && (
                            <span className="webtest-task-count-text">{processedCount} / {totalTasks} tasks processed</span>
                        )}

                        <button 
                            className="webtest-btn webtest-btn-primary" 
                            onClick={startAutomation} 
                            disabled={totalTasks === 0 || status === 'running'}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Start Automation
                        </button>

                        {status === 'running' && (
                            <button 
                                className="webtest-btn webtest-btn-danger" 
                                onClick={() => { stopRef.current = true; }}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="5" y="5" width="14" height="14" rx="1" />
                                </svg>
                                Stop
                            </button>
                        )}

                        {error && (
                            <span className="webtest-error-banner">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                {error}
                            </span>
                        )}
                    </div>

                    <div className="webtest-toolbar-group">
                        <div className="webtest-divider-v" />
                        <div className="webtest-export-form">
                            <span className="webtest-control-label">Export Range</span>
                            <select 
                                className="webtest-select" 
                                value={downloadRange} 
                                onChange={e => setDownloadRange(e.target.value as any)}
                            >
                                <option value="1m">Past 1 Month</option>
                                <option value="3m">Past 3 Months</option>
                                <option value="1y">Past 1 Year</option>
                                <option value="custom">Custom Range</option>
                            </select>

                            {downloadRange === 'custom' && (
                                <>
                                    <input 
                                        type="date" 
                                        className="webtest-input-date" 
                                        value={customStartDate} 
                                        onChange={e => setCustomStartDate(e.target.value)} 
                                    />
                                    <input 
                                        type="date" 
                                        className="webtest-input-date" 
                                        value={customEndDate} 
                                        onChange={e => setCustomEndDate(e.target.value)} 
                                    />
                                </>
                            )}

                            <button 
                                className="webtest-btn webtest-btn-secondary" 
                                onClick={downloadHistory} 
                                disabled={isDownloadingHistory || (downloadRange === 'custom' && (!customStartDate || !customEndDate))}
                            >
                                {isDownloadingHistory ? (
                                    <>
                                        <span className="webtest-spinner" style={{ width: '12px', height: '12px' }} />
                                        Exporting…
                                    </>
                                ) : (
                                    <>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                        Download History
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Body Grid: Sidebar Rail + Workspace Content ───────────── */}
                <div className="webtest-body">
                    {/* ── LEFT: Calendar Index Rail ─────────────────────────── */}
                    <aside className="webtest-sidebar">
                        <div className="webtest-month-nav">
                            <button 
                                className="webtest-nav-arrow" 
                                onClick={() => setCalendarMonth(prev => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; })}
                                title="Previous Month"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                                    <polyline points="15 18 9 12 15 6" />
                                </svg>
                            </button>
                            <span className="webtest-month-title">{formatMonthYear(calendarMonth)}</span>
                            <button 
                                className="webtest-nav-arrow" 
                                onClick={() => setCalendarMonth(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; })}
                                title="Next Month"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>
                        </div>

                        {/* Weekday labels */}
                        <div className="webtest-weekdays-row">
                            {['S','M','T','W','T','F','S'].map((d, i) => (
                                <div key={i} className="webtest-weekday-label">{d}</div>
                            ))}
                        </div>

                        {/* Days Grid */}
                        <div className="webtest-days-grid">
                            {calendarDays.map((day, i) => {
                                if (!day) return <div key={`empty-${i}`} className="webtest-day-cell" />;
                                const dateStr = toDateStr(day);
                                const hasData = calendarDateSet.has(dateStr);
                                const calInfo = calendarDateSet.get(dateStr);
                                const isSelected = selectedDate === dateStr;
                                const isToday = dateStr === today;

                                let cellClasses = 'webtest-day-cell';
                                if (hasData) cellClasses += ' webtest-day-cell--has-data';
                                if (isSelected) cellClasses += ' webtest-day-cell--selected';
                                if (isToday) cellClasses += ' webtest-day-cell--today';

                                return (
                                    <button
                                        key={dateStr}
                                        onClick={() => {
                                            setSelectedDate(dateStr);
                                            fetchDateSnapshot(dateStr);
                                        }}
                                        className={cellClasses}
                                        title={hasData ? `${calInfo?.task_count} tasks, ${calInfo?.run_count} records` : 'No test run data'}
                                    >
                                        {day}
                                        {hasData && <span className="webtest-day-dot" />}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Legend */}
                        <div className="webtest-sidebar-section">
                            <div className="webtest-legend-list">
                                <div className="webtest-legend-item">
                                    <span className="webtest-legend-swatch" style={{ background: 'var(--fdl-blue-050)', border: '1px solid var(--fdl-blue-700)' }} />
                                    <span>Has test run data</span>
                                </div>
                                <div className="webtest-legend-item">
                                    <span className="webtest-legend-swatch" style={{ background: 'var(--fdl-navy-800)', border: '1px solid var(--fdl-navy-950)' }} />
                                    <span>Selected date</span>
                                </div>
                                <div className="webtest-legend-item">
                                    <span className="webtest-legend-swatch" style={{ background: 'transparent', border: '1px solid var(--fdl-amber)' }} />
                                    <span>Today</span>
                                </div>
                            </div>
                        </div>

                        {/* Rail Metrics Card */}
                        {calendarDates.length > 0 && (
                            <div className="webtest-meta-card">
                                <span className="webtest-meta-card__title">Surveillance Index</span>
                                <span className="webtest-meta-card__desc">
                                    {calendarDates.length} recorded dates · {totalTrackedRecords.toLocaleString()} execution records
                                </span>
                            </div>
                        )}
                    </aside>

                    {/* ── RIGHT: Snapshot Matrix + Chart Inspector ──────────── */}
                    <div className="webtest-content">
                        {/* ── Test Run Snapshot Panel ───────────────────────── */}
                        <section className="webtest-panel">
                            <div className="webtest-panel-header">
                                <div className="webtest-panel-title-wrap">
                                    <h2 className="webtest-panel-title">
                                        {selectedDate ? `Snapshot Results: ${selectedDate}` : 'Endpoint Parity Snapshot'}
                                    </h2>
                                    {selectedDate && dateSnapshot.length > 0 && (
                                        <span className="webtest-panel-meta-chip">
                                            {dateSnapshot.length} TASKS · {activeVersions.length} INSTANCES
                                        </span>
                                    )}
                                </div>
                            </div>

                            {!selectedDate && (
                                <div className="webtest-empty-state">
                                    <svg className="webtest-empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                        <line x1="16" y1="2" x2="16" y2="6" />
                                        <line x1="8" y1="2" x2="8" y2="6" />
                                        <line x1="3" y1="10" x2="21" y2="10" />
                                    </svg>
                                    <div className="webtest-empty-state__title">Select a Date from the Calendar</div>
                                    <div className="webtest-empty-state__subtitle">
                                        Highlighted calendar dates contain multi-endpoint query telemetry. Click a date to inspect result counts and latency across versions.
                                    </div>
                                </div>
                            )}

                            {selectedDate && isSnapshotLoading && (
                                <div className="webtest-empty-state">
                                    <span className="webtest-spinner" style={{ width: '28px', height: '28px' }} />
                                    <div className="webtest-empty-state__title">Loading Snapshot Telemetry…</div>
                                </div>
                            )}

                            {selectedDate && !isSnapshotLoading && dateSnapshot.length === 0 && (
                                <div className="webtest-empty-state">
                                    <div className="webtest-empty-state__title">No Records Available</div>
                                    <div className="webtest-empty-state__subtitle">No test execution records found for {selectedDate}.</div>
                                </div>
                            )}

                            {selectedDate && !isSnapshotLoading && dateSnapshot.length > 0 && (
                                <div className="webtest-table-wrap">
                                    <table className="webtest-table">
                                        <thead>
                                            <tr>
                                                <th className="webtest-th-task">Task Criteria</th>
                                                {activeVersions.map(v => (
                                                    <th key={v} style={{ color: getVersionColor(v) }}>
                                                        {v}
                                                    </th>
                                                ))}
                                                <th style={{ width: '90px' }}>Inspector</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dateSnapshot.map((task, rowIndex) => {
                                                const isSelected = selectedTask?.task_id === task.task_id;
                                                return (
                                                    <tr 
                                                        key={task.task_id} 
                                                        className={`webtest-tr ${isSelected ? 'webtest-tr--selected' : ''}`}
                                                        onClick={() => setSelectedTask(isSelected ? null : task)}
                                                    >
                                                        <td>
                                                            <div className="webtest-task-cell">
                                                                <span className="webtest-task-num-chip">#{task.task_num}</span>
                                                                <span className="webtest-task-query-text">{task.query_details}</span>
                                                            </div>
                                                        </td>
                                                        {activeVersions.map(v => {
                                                            const vData = task.versions[v];
                                                            const latest = vData?.latest;
                                                            const c = latest?.count;
                                                            const delay = latest?.delay;
                                                            const isHovered = hoveredCell?.taskId === task.task_id && hoveredCell?.version === v;
                                                            return (
                                                                <td 
                                                                    key={v}
                                                                    onMouseEnter={() => setHoveredCell({ taskId: task.task_id, version: v })}
                                                                    onMouseLeave={() => setHoveredCell(null)}
                                                                    style={{ position: 'relative', textAlign: 'center' }}
                                                                >
                                                                    {vData ? (
                                                                        <div className="webtest-metric-cell">
                                                                            <span 
                                                                                className="webtest-count-badge"
                                                                                style={{
                                                                                    backgroundColor: countBg(c),
                                                                                    color: countColor(c),
                                                                                    border: `1px solid ${countBorder(c)}`,
                                                                                }}
                                                                            >
                                                                                {formatCount(c)}
                                                                            </span>
                                                                            {delay != null && (
                                                                                <span className="webtest-delay-text">
                                                                                    {delay.toFixed(1)}s
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <span style={{ color: 'var(--fdl-line)' }}>—</span>
                                                                    )}

                                                                    {/* Run detail hover popover */}
                                                                    {isHovered && vData && vData.runs && vData.runs.length > 0 && (
                                                                        <div 
                                                                            className="webtest-popover"
                                                                            style={{
                                                                                left: '50%',
                                                                                transform: 'translateX(-50%)',
                                                                                ...(rowIndex < 3 ? {
                                                                                    top: '100%',
                                                                                    marginTop: '6px',
                                                                                } : {
                                                                                    bottom: '100%',
                                                                                    marginBottom: '6px',
                                                                                }),
                                                                            }}
                                                                        >
                                                                            <div className="webtest-popover-title">
                                                                                Execution Log: {v}
                                                                            </div>
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                                                                                {vData.runs.map((run, idx) => (
                                                                                    <div 
                                                                                        key={idx} 
                                                                                        style={{ 
                                                                                            display: 'flex', 
                                                                                            justifyContent: 'space-between', 
                                                                                            gap: '12px', 
                                                                                            borderBottom: idx < vData.runs.length - 1 ? '1px dashed var(--fdl-navy-800)' : 'none', 
                                                                                            paddingBottom: idx < vData.runs.length - 1 ? '4px' : '0' 
                                                                                        }}
                                                                                    >
                                                                                        <div>
                                                                                            <span style={{ fontWeight: 700, fontFamily: 'var(--fdl-font-mono)', color: 'var(--fdl-paper)' }}>{run.time}</span>
                                                                                            {run.notes && <span style={{ color: 'var(--fdl-muted)', display: 'block', fontSize: '0.65rem' }}>{run.notes}</span>}
                                                                                        </div>
                                                                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                                                            <span style={{ color: countColor(run.count), fontWeight: 800, fontFamily: 'var(--fdl-font-mono)' }}>{formatCount(run.count)}</span>
                                                                                            {run.delay != null && <span style={{ color: 'var(--fdl-muted)', display: 'block', fontSize: '0.65rem', fontFamily: 'var(--fdl-font-mono)' }}>{run.delay.toFixed(1)}s</span>}
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            );
                                                        })}
                                                        <td style={{ textAlign: 'center' }}>
                                                            <button 
                                                                className={`webtest-inspect-btn ${isSelected ? 'webtest-inspect-btn--active' : ''}`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedTask(isSelected ? null : task);
                                                                }}
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                                                    <line x1="18" y1="20" x2="18" y2="10" />
                                                                    <line x1="12" y1="20" x2="12" y2="4" />
                                                                    <line x1="6" y1="20" x2="6" y2="14" />
                                                                </svg>
                                                                {isSelected ? 'Close' : 'Trend'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        {/* ── Historical Trend Inspector Panel ──────────────── */}
                        {selectedTask && (
                            <section ref={chartRef} className="webtest-inspector-panel">
                                <div className="webtest-inspector-header">
                                    <div className="webtest-inspector-title-group">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span className="webtest-task-num-chip" style={{ background: 'var(--fdl-navy-800)', color: 'var(--fdl-paper)' }}>
                                                #{selectedTask.task_num}
                                            </span>
                                            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--fdl-navy-950)' }}>
                                                Historical Latency & Count Trend
                                            </h3>
                                        </div>
                                        <span style={{ fontSize: '0.74rem', color: 'var(--fdl-muted)' }}>
                                            {selectedTask.query_details}
                                        </span>
                                    </div>

                                    <div className="webtest-range-group">
                                        <span className="webtest-control-label">Range:</span>
                                        {(['3m', '1y', 'all'] as const).map(r => (
                                            <button 
                                                key={r} 
                                                onClick={() => setHistoryRange(r)} 
                                                className={`webtest-toggle-btn ${historyRange === r ? 'webtest-toggle-btn--active' : ''}`}
                                            >
                                                {r === 'all' ? 'ALL' : r.toUpperCase()}
                                            </button>
                                        ))}
                                        <button 
                                            onClick={() => setShowOutliers(p => !p)} 
                                            className={`webtest-toggle-btn ${showOutliers ? 'webtest-toggle-btn--outlier-active' : ''}`}
                                            title="Toggle outlier detection"
                                        >
                                            {showOutliers ? 'Outliers: Shown' : 'Outliers: Hidden'}
                                        </button>
                                    </div>
                                </div>

                                {isHistoryLoading ? (
                                    <div className="webtest-empty-state">
                                        <span className="webtest-spinner" style={{ width: '28px', height: '28px' }} />
                                        <div className="webtest-empty-state__title">Retrieving Historical Telemetry…</div>
                                    </div>
                                ) : processedChartData.length > 0 ? (
                                    <div className="webtest-chart-body">
                                        {/* Query Processing Time (Latency) */}
                                        <div className="webtest-chart-section">
                                            <h4 className="webtest-chart-heading">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <polyline points="12 6 12 12 16 14" />
                                                </svg>
                                                Query Latency (Seconds)
                                            </h4>
                                            <div className="webtest-chart-wrap">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={processedChartData} syncId="histCharts" margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--fdl-line-soft)" />
                                                        <XAxis dataKey="DisplayDate" type="category" axisLine={{ stroke: 'var(--fdl-line)' }} tickLine={false} tick={{ fill: 'var(--fdl-muted)', fontSize: 10, fontFamily: 'var(--fdl-font-mono)' }} />
                                                        <YAxis domain={[0, 'auto']} axisLine={{ stroke: 'var(--fdl-line)' }} tickLine={false} tick={{ fill: 'var(--fdl-muted)', fontSize: 10, fontFamily: 'var(--fdl-font-mono)' }} />
                                                        <Tooltip 
                                                            contentStyle={{ 
                                                                borderRadius: '2px', 
                                                                border: '1px solid var(--fdl-line)', 
                                                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)', 
                                                                fontSize: '0.74rem',
                                                                fontFamily: 'var(--fdl-font-mono)',
                                                                background: 'var(--fdl-paper)',
                                                                color: 'var(--fdl-ink)'
                                                            }}
                                                            formatter={(val: any) => [`${val}s`]} 
                                                        />
                                                        {chartVersions.filter(v => !hiddenLines.includes(v)).map(v => (
                                                            <Line 
                                                                key={`d_${v}`} 
                                                                type="monotone" 
                                                                name={v} 
                                                                dataKey={`delay_${v}`} 
                                                                stroke={getVersionColor(v)} 
                                                                strokeWidth={2} 
                                                                dot={{ r: 2, strokeWidth: 0, fill: getVersionColor(v) }} 
                                                                activeDot={{ r: 4 }} 
                                                                connectNulls 
                                                            />
                                                        ))}
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>

                                        {/* Result Count Over Time */}
                                        <div className="webtest-chart-section">
                                            <h4 className="webtest-chart-heading">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                                    <line x1="18" y1="20" x2="18" y2="10" />
                                                    <line x1="12" y1="20" x2="12" y2="4" />
                                                    <line x1="6" y1="20" x2="6" y2="14" />
                                                </svg>
                                                Result Count Over Time
                                            </h4>
                                            <div className="webtest-chart-wrap">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={processedChartData} syncId="histCharts" margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--fdl-line-soft)" />
                                                        <XAxis dataKey="DisplayDate" type="category" axisLine={{ stroke: 'var(--fdl-line)' }} tickLine={false} tick={{ fill: 'var(--fdl-muted)', fontSize: 10, fontFamily: 'var(--fdl-font-mono)' }} />
                                                        <YAxis domain={['auto', 'auto']} axisLine={{ stroke: 'var(--fdl-line)' }} tickLine={false} tick={{ fill: 'var(--fdl-muted)', fontSize: 10, fontFamily: 'var(--fdl-font-mono)' }} />
                                                        <Tooltip 
                                                            contentStyle={{ 
                                                                borderRadius: '2px', 
                                                                border: '1px solid var(--fdl-line)', 
                                                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)', 
                                                                fontSize: '0.74rem',
                                                                fontFamily: 'var(--fdl-font-mono)',
                                                                background: 'var(--fdl-paper)',
                                                                color: 'var(--fdl-ink)'
                                                            }}
                                                            formatter={(val: any) => [val]} 
                                                        />
                                                        {chartVersions.filter(v => !hiddenLines.includes(v)).map(v => (
                                                            <Line 
                                                                key={`c_${v}`} 
                                                                type="stepAfter" 
                                                                name={v} 
                                                                dataKey={`count_${v}`} 
                                                                stroke={getVersionColor(v)} 
                                                                strokeWidth={2} 
                                                                dot={{ r: 2, strokeWidth: 0, fill: getVersionColor(v) }} 
                                                                activeDot={{ r: 4 }} 
                                                                connectNulls 
                                                            />
                                                        ))}
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>

                                        {/* Legend filter */}
                                        <div className="webtest-legend-bar">
                                            {chartVersions.map(v => {
                                                const isHidden = hiddenLines.includes(v);
                                                return (
                                                    <button 
                                                        key={v} 
                                                        onClick={() => toggleLine(v)} 
                                                        className={`webtest-legend-pill ${isHidden ? 'webtest-legend-pill--hidden' : ''}`}
                                                    >
                                                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: getVersionColor(v), flexShrink: 0 }} />
                                                        {v}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Manual Verification Endpoints */}
                                        {selectedTask.urls && Object.keys(selectedTask.urls).length > 0 && (
                                            <div className="webtest-verif-section">
                                                <h5 className="webtest-verif-title">
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                        <polyline points="15 3 21 3 21 9" />
                                                        <line x1="10" y1="14" x2="21" y2="3" />
                                                    </svg>
                                                    Manual Verification Endpoints
                                                </h5>
                                                <div className="webtest-verif-list">
                                                    {Object.entries(selectedTask.urls).map(([ver, url]) => (
                                                        <div key={ver} className="webtest-verif-row">
                                                            <span className="webtest-verif-version">{ver}:</span>
                                                            <a 
                                                                href={url} 
                                                                target="_blank" 
                                                                rel="noopener noreferrer" 
                                                                className="webtest-verif-link"
                                                            >
                                                                {url}
                                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                                    <polyline points="15 3 21 3 21 9" />
                                                                    <line x1="10" y1="14" x2="21" y2="3" />
                                                                </svg>
                                                            </a>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="webtest-empty-state">
                                        <div className="webtest-empty-state__title">No Historical Records</div>
                                        <div className="webtest-empty-state__subtitle">No historical telemetry points found for this task in the chosen range.</div>
                                    </div>
                                )}
                            </section>
                        )}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}

export default function WebTestingPage() {
    return (
        <RequireFeature feature="Web-test Tool" featureKey="webtest" activeApp="webtest">
            <WebTestingPageInner />
        </RequireFeature>
    );
}
