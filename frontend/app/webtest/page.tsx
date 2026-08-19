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
    if (vUpper.includes('PROD')) return vUpper.includes('CDER') ? 'var(--afl-info-500)' : 'var(--afl-info-700)';
    if (vUpper.includes('PUBLIC')) return vUpper.includes('CDER') ? 'var(--afl-success-500)' : 'var(--afl-success-700)';
    if (vUpper.includes('TEST')) return vUpper.includes('CDER') ? 'var(--afl-ai-from)' : 'var(--afl-a-700)';
    if (vUpper.includes('DEV')) return vUpper.includes('CDER') ? 'var(--afl-warn-500)' : 'var(--afl-warn-700)';
    return 'var(--afl-n-500)';
}

function formatCount(c: string | null | undefined): string {
    if (c == null || c === 'N/A' || c === '') return '—';
    return c;
}

function countBg(c: string | null | undefined): string {
    if (!c || c === 'N/A' || c === '—') return 'transparent';
    const n = parseInt(c);
    if (isNaN(n)) return 'var(--afl-n-100)';
    if (n === 0) return 'var(--afl-danger-100)';
    return 'var(--afl-success-50)';
}
function countColor(c: string | null | undefined): string {
    if (!c || c === 'N/A' || c === '—') return 'var(--afl-n-400)';
    const n = parseInt(c);
    if (isNaN(n)) return 'var(--afl-n-500)';
    if (n === 0) return 'var(--afl-danger-500)';
    return 'var(--afl-success-500)';
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

    // Task chart state
    const [selectedTask, setSelectedTask] = useState<SnapshotTask | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{ taskId: number; version: string } | null>(null);
    const [taskHistory, setTaskHistory] = useState<any[]>([]);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [historyRange, setHistoryRange] = useState<'all' | '1y' | '3m'>('1y');
    const [hiddenLines, setHiddenLines] = useState<string[]>([]);
    const [showOutliers, setShowOutliers] = useState(false);

    // Download state
    const [downloadRange, setDownloadRange] = useState<'1m' | '3m' | '1y' | 'custom'>('1m');
    const [customStartDate, setCustomStartDate] = useState<string>('');
    const [customEndDate, setCustomEndDate] = useState<string>('');
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
        const maxCount = counts[counts.length-1] || 1, cThresh = Math.max(1, maxCount * 0.02);
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

    // ── Render ─────────────────────────────────────────────────────────────
    const processedCount = results.filter(r => r.status !== 'pending').length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--afl-n-50)' }}>
            <Header />
            <main style={{ flex: 1, padding: '32px 24px', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
                {/* Page title */}
                <div style={{ marginBottom: '24px' }}>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--afl-n-900)', margin: 0 }}>FDALabel Auto-Test Dashboard</h1>
                    <p style={{ color: 'var(--afl-n-500)', margin: '4px 0 0' }}>Browse historical test runs by date, inspect per-task results, and view long-term trends.</p>
                </div>

                {/* ── Control Bar ──────────────────────────────────────────── */}
                <div style={{ background: 'var(--afl-n-0)', padding: '14px 24px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '24px', border: '1px solid var(--afl-n-200)', display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
                    {/* Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ padding: '3px 12px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', backgroundColor: status === 'running' ? 'var(--afl-info-100)' : status === 'completed' ? 'var(--afl-success-50)' : 'var(--afl-n-100)', color: status === 'running' ? 'var(--afl-info-700)' : status === 'completed' ? 'var(--afl-success-700)' : 'var(--afl-n-600)' }}>{status}</span>
                        {status === 'running' && <><div className="loader" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div><span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-info-700)' }}>{taskProgress}%</span></>}
                        {status !== 'running' && <span style={{ fontSize: '0.8rem', color: 'var(--afl-n-500)' }}>{processedCount}/{totalTasks} tasks</span>}
                    </div>
                    <button onClick={startAutomation} disabled={totalTasks === 0} style={{ padding: '9px 18px', backgroundColor: totalTasks > 0 ? 'var(--afl-info-700)' : 'var(--afl-n-300)', color: 'var(--afl-n-0)', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', border: 'none', cursor: totalTasks > 0 ? 'pointer' : 'not-allowed', boxShadow: totalTasks > 0 ? '0 4px 12px rgba(37,99,235,0.25)' : 'none' }}>▶ Start Automation</button>
                    {status === 'running' && <button onClick={() => { stopRef.current = true; }} style={{ padding: '9px 18px', backgroundColor: 'var(--afl-danger-500)', color: 'var(--afl-n-0)', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', border: 'none', cursor: 'pointer' }}>■ Stop</button>}

                    <div style={{ width: '1px', height: '28px', background: 'var(--afl-n-200)', flexShrink: 0 }} />

                    {/* Download */}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 800, color: 'var(--afl-n-400)', textTransform: 'uppercase', marginBottom: '3px' }}>Download Range</label>
                            <select value={downloadRange} onChange={e => setDownloadRange(e.target.value as any)} style={{ padding: '7px 28px 7px 10px', borderRadius: '8px', border: '1px solid var(--afl-n-200)', fontSize: '0.82rem', outline: 'none' }}>
                                <option value="1m">Past 1 Month</option>
                                <option value="3m">Past 3 Months</option>
                                <option value="1y">Past 1 Year</option>
                                <option value="custom">Custom Range</option>
                            </select>
                        </div>
                        {downloadRange === 'custom' && <>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 800, color: 'var(--afl-n-400)', textTransform: 'uppercase', marginBottom: '3px' }}>Start</label>
                                <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} style={{ padding: '7px', borderRadius: '8px', border: '1px solid var(--afl-n-200)', fontSize: '0.82rem', outline: 'none' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 800, color: 'var(--afl-n-400)', textTransform: 'uppercase', marginBottom: '3px' }}>End</label>
                                <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} style={{ padding: '7px', borderRadius: '8px', border: '1px solid var(--afl-n-200)', fontSize: '0.82rem', outline: 'none' }} />
                            </div>
                        </>}
                        <button onClick={downloadHistory} disabled={isDownloadingHistory || (downloadRange === 'custom' && (!customStartDate || !customEndDate))} style={{ padding: '9px 16px', backgroundColor: 'var(--afl-n-0)', color: 'var(--afl-n-600)', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', border: '1px solid var(--afl-n-200)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isDownloadingHistory ? <><div className="loader" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></div>Downloading...</> : <>⬇ Download History</>}
                        </button>
                    </div>
                    {error && <span style={{ color: 'var(--afl-danger-500)', fontSize: '0.8rem', fontWeight: 600 }}>⚠ {error}</span>}
                </div>

                {/* ── Three-Panel Body ──────────────────────────────────────── */}
                <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px', alignItems: 'start' }}>

                    {/* ── LEFT: Calendar Panel ─────────────────────────────── */}
                    <div style={{ background: 'var(--afl-n-0)', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid var(--afl-n-200)', position: 'sticky', top: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <button onClick={() => setCalendarMonth(prev => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; })} style={{ background: 'none', border: '1px solid var(--afl-n-200)', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--afl-n-800)' }}>{formatMonthYear(calendarMonth)}</span>
                            <button onClick={() => setCalendarMonth(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; })} style={{ background: 'none', border: '1px solid var(--afl-n-200)', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                        </div>
                        {/* Day-of-week header */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px', marginBottom: '4px' }}>
                            {['S','M','T','W','T','F','S'].map((d, i) => (
                                <div key={i} style={{ textAlign: 'center', fontSize: '0.62rem', fontWeight: 800, color: 'var(--afl-n-400)', padding: '4px 0' }}>{d}</div>
                            ))}
                        </div>
                        {/* Days grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '3px' }}>
                            {calendarDays.map((day, i) => {
                                if (!day) return <div key={`empty-${i}`} />;
                                const dateStr = toDateStr(day);
                                const hasData = calendarDateSet.has(dateStr);
                                const calInfo = calendarDateSet.get(dateStr);
                                const isSelected = selectedDate === dateStr;
                                const isToday = dateStr === today;
                                return (
                                    <button
                                        key={dateStr}
                                        onClick={() => {
                                            setSelectedDate(dateStr);
                                            fetchDateSnapshot(dateStr);
                                        }}
                                        title={hasData ? `${calInfo?.task_count} tasks, ${calInfo?.run_count} records` : 'No data'}
                                        style={{
                                            position: 'relative', width: '100%', aspectRatio: '1', borderRadius: '8px', border: 'none',
                                            cursor: hasData ? 'pointer' : 'default',
                                            fontSize: '0.72rem', fontWeight: isSelected ? 800 : hasData ? 700 : 400,
                                            backgroundColor: isSelected ? 'var(--afl-info-700)' : hasData ? 'var(--afl-info-50)' : 'transparent',
                                            color: isSelected ? 'var(--afl-n-0)' : hasData ? 'var(--afl-info-700)' : isToday ? 'var(--afl-warn-500)' : 'var(--afl-n-400)',
                                            outline: isToday && !isSelected ? '2px solid var(--afl-warn-500)' : 'none',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        {day}
                                        {hasData && !isSelected && (
                                            <span style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--afl-info-700)', display: 'block' }} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Legend */}
                        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--afl-n-100)', fontSize: '0.7rem', color: 'var(--afl-n-500)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', backgroundColor: 'var(--afl-info-50)', border: '1px solid var(--afl-info-100)' }}></span>Has test data
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', backgroundColor: 'var(--afl-info-700)' }}></span>Selected date
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', outline: '2px solid var(--afl-warn-500)' }}></span>Today
                            </div>
                        </div>

                        {/* Total runs count */}
                        {calendarDates.length > 0 && (
                            <div style={{ marginTop: '12px', padding: '10px', background: 'var(--afl-n-50)', borderRadius: '8px', fontSize: '0.72rem', color: 'var(--afl-n-600)' }}>
                                <div style={{ fontWeight: 800, color: 'var(--afl-n-800)', marginBottom: '2px' }}>{calendarDates.length} test days in history</div>
                                <div>Total {calendarDates.reduce((s, d) => s + d.run_count, 0).toLocaleString()} records tracked</div>
                            </div>
                        )}
                    </div>

                    {/* ── RIGHT: Snapshot + Chart Panel ────────────────────── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                        {/* ── Task Matrix (Right-Top) ─────────────────────── */}
                        <div style={{ background: 'var(--afl-n-0)', borderRadius: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid var(--afl-n-200)', overflow: 'hidden' }}>
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--afl-n-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--afl-n-800)' }}>
                                        {selectedDate ? `Results for ${selectedDate}` : 'FDALabel Auto-Test Tasks'}
                                    </h3>
                                    {!selectedDate && <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--afl-n-400)' }}>Select a highlighted date on the calendar to view results.</p>}
                                </div>
                                {selectedDate && dateSnapshot.length > 0 && (
                                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--afl-n-500)', backgroundColor: 'var(--afl-n-100)', padding: '4px 10px', borderRadius: '999px' }}>
                                        {dateSnapshot.length} tasks · {activeVersions.length} versions
                                    </span>
                                )}
                            </div>

                            {!selectedDate && (
                                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--afl-n-400)' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📅</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Pick a date to explore test results</div>
                                    <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>Blue highlighted days in the calendar have test data available.</div>
                                </div>
                            )}

                            {selectedDate && isSnapshotLoading && (
                                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--afl-n-400)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                    <div className="loader" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
                                    <span style={{ fontSize: '0.85rem' }}>Loading results…</span>
                                </div>
                            )}

                            {selectedDate && !isSnapshotLoading && dateSnapshot.length === 0 && (
                                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--afl-n-400)' }}>No records found for {selectedDate}.</div>
                            )}

                            {selectedDate && !isSnapshotLoading && dateSnapshot.length > 0 && (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: 'var(--afl-n-50)' }}>
                                                <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--afl-n-500)', fontWeight: 700, borderBottom: '1px solid var(--afl-n-100)', whiteSpace: 'nowrap', minWidth: '280px' }}>Task</th>
                                                {activeVersions.map(v => (
                                                    <th key={v} style={{ padding: '10px 10px', textAlign: 'center', color: getVersionColor(v), fontWeight: 800, borderBottom: '1px solid var(--afl-n-100)', whiteSpace: 'nowrap', fontSize: '0.68rem' }}>
                                                        {v.replace(' - ', '\n')}
                                                    </th>
                                                ))}
                                                <th style={{ padding: '10px 10px', textAlign: 'center', color: 'var(--afl-n-500)', fontWeight: 700, borderBottom: '1px solid var(--afl-n-100)', whiteSpace: 'nowrap' }}>Details</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dateSnapshot.map((task, rowIndex) => {
                                                const isSelected = selectedTask?.task_id === task.task_id;
                                                return (
                                                    <tr
                                                        key={task.task_id}
                                                        onClick={() => setSelectedTask(isSelected ? null : task)}
                                                        style={{
                                                            borderBottom: '1px solid var(--afl-n-50)',
                                                            backgroundColor: isSelected ? 'var(--afl-info-50)' : 'transparent',
                                                            borderLeft: isSelected ? '3px solid var(--afl-info-700)' : '3px solid transparent',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.15s ease',
                                                        }}
                                                        className="row-hover"
                                                    >
                                                        <td style={{ padding: '9px 16px', color: 'var(--afl-n-800)', fontWeight: 600 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ backgroundColor: isSelected ? 'var(--afl-info-700)' : 'var(--afl-n-200)', color: isSelected ? 'var(--afl-n-0)' : 'var(--afl-n-600)', fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px', flexShrink: 0 }}>#{task.task_num}</span>
                                                                <span style={{ fontSize: '0.76rem', lineHeight: 1.3 }}>{task.query_details}</span>
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
                                                                    style={{ padding: '9px 10px', textAlign: 'center', position: 'relative' }}
                                                                >
                                                                    {vData ? (
                                                                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                                            <span style={{ backgroundColor: countBg(c), color: countColor(c), fontWeight: 800, padding: '2px 8px', borderRadius: '6px', fontSize: '0.78rem', minWidth: '32px', display: 'inline-block', textAlign: 'center' }}>
                                                                                {formatCount(c)}
                                                                            </span>
                                                                            {delay != null && <span style={{ color: 'var(--afl-n-400)', fontSize: '0.6rem' }}>{delay.toFixed(1)}s</span>}
                                                                        </div>
                                                                    ) : (
                                                                        <span style={{ color: 'var(--afl-n-200)' }}>—</span>
                                                                    )}

                                                                    {isHovered && vData && vData.runs && vData.runs.length > 0 && (
                                                                        <div style={{
                                                                            position: 'absolute',
                                                                            ...(rowIndex < 3 ? {
                                                                                top: '100%',
                                                                                transform: 'translateX(-50%) translateY(6px)',
                                                                            } : {
                                                                                bottom: '100%',
                                                                                transform: 'translateX(-50%) translateY(-6px)',
                                                                            }),
                                                                            backgroundColor: 'var(--afl-n-800)',
                                                                            color: 'var(--afl-n-0)',
                                                                            padding: '12px',
                                                                            borderRadius: '10px',
                                                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                                                            zIndex: 100,
                                                                            minWidth: '240px',
                                                                            textAlign: 'left',
                                                                            fontSize: '0.72rem',
                                                                            lineHeight: '1.4',
                                                                            pointerEvents: 'none',
                                                                        }}>
                                                                            <div style={{ fontWeight: 800, borderBottom: '1px solid var(--afl-n-700)', paddingBottom: '6px', marginBottom: '8px', color: 'var(--afl-info-500)', fontSize: '0.74rem' }}>
                                                                                All Runs ({v})
                                                                            </div>
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                                                                                {vData.runs.map((run, idx) => (
                                                                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', borderBottom: idx < vData.runs.length - 1 ? '1px dashed var(--afl-n-700)' : 'none', paddingBottom: idx < vData.runs.length - 1 ? '4px' : '0' }}>
                                                                                        <div>
                                                                                            <span style={{ fontWeight: 700, color: 'var(--afl-n-50)' }}>{run.time}</span>
                                                                                            {run.notes && <span style={{ color: 'var(--afl-n-400)', display: 'block', fontSize: '0.62rem' }}>{run.notes}</span>}
                                                                                        </div>
                                                                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                                                            <span style={{ color: countColor(run.count), fontWeight: 800 }}>{formatCount(run.count)}</span>
                                                                                            {run.delay != null && <span style={{ color: 'var(--afl-n-400)', display: 'block', fontSize: '0.62rem' }}>{run.delay.toFixed(1)}s</span>}
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                            <div style={{
                                                                                position: 'absolute',
                                                                                ...(rowIndex < 3 ? {
                                                                                    bottom: '100%',
                                                                                    borderBottom: '6px solid var(--afl-n-800)',
                                                                                } : {
                                                                                    top: '100%',
                                                                                    borderTop: '6px solid var(--afl-n-800)',
                                                                                }),
                                                                                left: '50%',
                                                                                transform: 'translateX(-50%)',
                                                                                width: 0,
                                                                                height: 0,
                                                                                borderLeft: '6px solid transparent',
                                                                                borderRight: '6px solid transparent',
                                                                            }} />
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            );
                                                        })}
                                                        <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: isSelected ? 'var(--afl-info-700)' : 'var(--afl-n-400)', backgroundColor: isSelected ? 'var(--afl-info-100)' : 'var(--afl-n-50)', padding: '3px 8px', borderRadius: '6px', border: `1px solid ${isSelected ? 'var(--afl-info-100)' : 'var(--afl-n-100)'}` }}>
                                                                {isSelected ? '▲ Chart' : '▼ Chart'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* ── Historical Line Chart (Right-Bottom) ────────── */}
                        {selectedTask && (
                            <div ref={chartRef} style={{ background: 'var(--afl-n-0)', borderRadius: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid var(--afl-n-200)', overflow: 'hidden' }}>
                                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--afl-n-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ backgroundColor: 'var(--afl-info-700)', color: 'var(--afl-n-0)', fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px' }}>#{selectedTask.task_num}</span>
                                            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--afl-n-800)' }}>Historical Trend</h3>
                                        </div>
                                        <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: 'var(--afl-n-500)' }}>{selectedTask.query_details}</p>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--afl-n-500)' }}>Range:</label>
                                        {(['3m', '1y', 'all'] as const).map(r => (
                                            <button key={r} onClick={() => setHistoryRange(r)} style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', backgroundColor: historyRange === r ? 'var(--afl-info-700)' : 'var(--afl-n-0)', color: historyRange === r ? 'var(--afl-n-0)' : 'var(--afl-n-500)', borderColor: historyRange === r ? 'var(--afl-info-700)' : 'var(--afl-n-200)' }}>
                                                {r === 'all' ? 'All' : r.toUpperCase()}
                                            </button>
                                        ))}
                                        <button onClick={() => setShowOutliers(p => !p)} style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', backgroundColor: showOutliers ? 'var(--afl-warn-500)' : 'var(--afl-n-0)', color: showOutliers ? 'var(--afl-n-0)' : 'var(--afl-n-500)', borderColor: showOutliers ? 'var(--afl-warn-500)' : 'var(--afl-n-200)' }}>
                                            {showOutliers ? '● Outliers' : '○ Outliers'}
                                        </button>
                                    </div>
                                </div>

                                {isHistoryLoading ? (
                                    <div style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                        <div className="loader" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
                                        <span style={{ color: 'var(--afl-n-400)', fontSize: '0.85rem' }}>Loading history…</span>
                                    </div>
                                ) : processedChartData.length > 0 ? (
                                    <div style={{ padding: '20px' }}>
                                        {/* Delay Chart */}
                                        <div style={{ marginBottom: '20px' }}>
                                            <h4 style={{ margin: '0 0 12px', fontSize: '0.82rem', fontWeight: 800, color: 'var(--afl-danger-500)' }}>⏱ Query Processed Time (seconds)</h4>
                                            <div style={{ height: '220px' }}>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={processedChartData} syncId="histCharts" margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--afl-n-100)" />
                                                        <XAxis dataKey="DisplayDate" type="category" axisLine={false} tickLine={false} tick={{ fill: 'var(--afl-n-400)', fontSize: 10 }} />
                                                        <YAxis domain={[0, 'auto']} axisLine={false} tickLine={false} tick={{ fill: 'var(--afl-n-400)', fontSize: 10 }} />
                                                        <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 16px rgba(0,0,0,0.1)', fontSize: '0.78rem' }}
                                                            formatter={(val: any) => [`${val}s`]} />
                                                        {chartVersions.filter(v => !hiddenLines.includes(v)).map(v => (
                                                            <Line key={`d_${v}`} type="monotone" name={v} dataKey={`delay_${v}`} stroke={getVersionColor(v)} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: getVersionColor(v) }} activeDot={{ r: 5 }} connectNulls />
                                                        ))}
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                        {/* Count Chart */}
                                        <div>
                                            <h4 style={{ margin: '0 0 12px', fontSize: '0.82rem', fontWeight: 800, color: 'var(--afl-a-500)' }}>📊 Result Count Over Time</h4>
                                            <div style={{ height: '220px' }}>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={processedChartData} syncId="histCharts" margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--afl-n-100)" />
                                                        <XAxis dataKey="DisplayDate" type="category" axisLine={false} tickLine={false} tick={{ fill: 'var(--afl-n-400)', fontSize: 10 }} />
                                                        <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{ fill: 'var(--afl-n-400)', fontSize: 10 }} />
                                                        <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 16px rgba(0,0,0,0.1)', fontSize: '0.78rem' }}
                                                            formatter={(val: any) => [val]} />
                                                        {chartVersions.filter(v => !hiddenLines.includes(v)).map(v => (
                                                            <Line key={`c_${v}`} type="stepAfter" name={v} dataKey={`count_${v}`} stroke={getVersionColor(v)} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: getVersionColor(v) }} activeDot={{ r: 5 }} connectNulls />
                                                        ))}
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                        {/* Legend */}
                                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--afl-n-100)' }}>
                                            {chartVersions.map(v => {
                                                const isHidden = hiddenLines.includes(v);
                                                return (
                                                    <button key={v} onClick={() => toggleLine(v)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', opacity: isHidden ? 0.35 : 1, transition: 'opacity 0.2s', fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-600)', padding: '3px 8px', borderRadius: '6px', backgroundColor: isHidden ? 'transparent' : 'var(--afl-n-50)' }}>
                                                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: getVersionColor(v), flexShrink: 0 }} />
                                                        {v}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div style={{ fontSize: '0.68rem', color: 'var(--afl-n-400)', textAlign: 'center', marginTop: '10px', fontStyle: 'italic' }}>
                                            Click legend items to toggle visibility. Delay values after 03/01/2026 use new measurement technology.
                                        </div>
                                        {selectedTask.urls && Object.keys(selectedTask.urls).length > 0 && (
                                            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--afl-n-200)', textAlign: 'left' }}>
                                                <h5 style={{ margin: '0 0 12px', fontSize: '0.8rem', fontWeight: 800, color: 'var(--afl-n-700)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    🔗 Manual Verification Links (Test Outliers)
                                                </h5>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px' }}>
                                                    {Object.entries(selectedTask.urls).map(([ver, url]) => (
                                                        <div key={ver} style={{ display: 'flex', alignItems: 'baseline', gap: '10px', fontSize: '0.74rem' }}>
                                                            <span style={{ fontWeight: 800, color: 'var(--afl-n-600)', minWidth: '140px', flexShrink: 0 }}>
                                                                {ver}:
                                                            </span>
                                                            <a
                                                                href={url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{
                                                                    color: 'var(--afl-info-700)',
                                                                    textDecoration: 'none',
                                                                    wordBreak: 'break-all',
                                                                    fontWeight: 500,
                                                                    transition: 'color 0.15s ease',
                                                                }}
                                                                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.color = 'var(--afl-info-700)'; }}
                                                                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.color = 'var(--afl-info-700)'; }}
                                                            >
                                                                {url}
                                                            </a>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--afl-n-400)', border: '2px dashed var(--afl-n-100)', margin: '20px', borderRadius: '12px' }}>
                                        No historical data found for this task.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <Footer />
            <style jsx global>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .loader { border: 3px solid var(--afl-n-100); border-radius: 50%; border-top-color: var(--afl-info-700); animation: spin 1s linear infinite; }
                .row-hover:hover { background-color: var(--afl-n-50) !important; }
            `}</style>
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
