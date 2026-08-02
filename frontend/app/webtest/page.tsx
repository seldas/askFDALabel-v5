'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useUser } from '../context/UserContext';
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

const BACKEND_API_PREFIX = `${API_BASE}/api`;
const WEBTEST_API_PREFIX = `${BACKEND_API_PREFIX}/webtest`;
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
    if (vUpper.includes('PROD')) return vUpper.includes('CDER') ? '#3b82f6' : '#1e40af';
    if (vUpper.includes('PUBLIC')) return vUpper.includes('CDER') ? '#10b981' : '#047857';
    if (vUpper.includes('TEST')) return vUpper.includes('CDER') ? '#a855f7' : '#7e22ce';
    if (vUpper.includes('DEV')) return vUpper.includes('CDER') ? '#f59e0b' : '#b45309';
    return '#64748b';
}

function formatCount(c: string | null | undefined): string {
    if (c == null || c === 'N/A' || c === '') return '—';
    return c;
}

function countBg(c: string | null | undefined): string {
    if (!c || c === 'N/A' || c === '—') return 'transparent';
    const n = parseInt(c);
    if (isNaN(n)) return '#f1f5f9';
    if (n === 0) return '#fee2e2';
    return '#f0fdf4';
}
function countColor(c: string | null | undefined): string {
    if (!c || c === 'N/A' || c === '—') return '#94a3b8';
    const n = parseInt(c);
    if (isNaN(n)) return '#64748b';
    if (n === 0) return '#dc2626';
    return '#16a34a';
}

export default function WebTestingPage() {
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
                    await fetch(`${BACKEND_API_PREFIX}/dashboard/tasks/${taskId}/cancel`, { method: 'POST' });
                    setStatus('idle'); return;
                }
                try {
                    const statusRes = await fetch(`${BACKEND_API_PREFIX}/dashboard/tasks/${taskId}`);
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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f0f4f8' }}>
            <Header />
            <main style={{ flex: 1, padding: '32px 24px', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
                {/* Page title */}
                <div style={{ marginBottom: '24px' }}>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>FDALabel Auto-Test Dashboard</h1>
                    <p style={{ color: '#64748b', margin: '4px 0 0' }}>Browse historical test runs by date, inspect per-task results, and view long-term trends.</p>
                </div>

                {/* ── Control Bar ──────────────────────────────────────────── */}
                <div style={{ background: '#fff', padding: '14px 24px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '24px', border: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
                    {/* Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ padding: '3px 12px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', backgroundColor: status === 'running' ? '#dbeafe' : status === 'completed' ? '#d1fae5' : '#f1f5f9', color: status === 'running' ? '#1e40af' : status === 'completed' ? '#065f46' : '#475569' }}>{status}</span>
                        {status === 'running' && <><div className="loader" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div><span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#2563eb' }}>{taskProgress}%</span></>}
                        {status !== 'running' && <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{processedCount}/{totalTasks} tasks</span>}
                    </div>
                    <button onClick={startAutomation} disabled={totalTasks === 0} style={{ padding: '9px 18px', backgroundColor: totalTasks > 0 ? '#2563eb' : '#cbd5e1', color: '#fff', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', border: 'none', cursor: totalTasks > 0 ? 'pointer' : 'not-allowed', boxShadow: totalTasks > 0 ? '0 4px 12px rgba(37,99,235,0.25)' : 'none' }}>▶ Start Automation</button>
                    {status === 'running' && <button onClick={() => { stopRef.current = true; }} style={{ padding: '9px 18px', backgroundColor: '#ef4444', color: '#fff', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', border: 'none', cursor: 'pointer' }}>■ Stop</button>}

                    <div style={{ width: '1px', height: '28px', background: '#e2e8f0', flexShrink: 0 }} />

                    {/* Download */}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Download Range</label>
                            <select value={downloadRange} onChange={e => setDownloadRange(e.target.value as any)} style={{ padding: '7px 28px 7px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.82rem', outline: 'none' }}>
                                <option value="1m">Past 1 Month</option>
                                <option value="3m">Past 3 Months</option>
                                <option value="1y">Past 1 Year</option>
                                <option value="custom">Custom Range</option>
                            </select>
                        </div>
                        {downloadRange === 'custom' && <>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Start</label>
                                <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} style={{ padding: '7px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.82rem', outline: 'none' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>End</label>
                                <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} style={{ padding: '7px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.82rem', outline: 'none' }} />
                            </div>
                        </>}
                        <button onClick={downloadHistory} disabled={isDownloadingHistory || (downloadRange === 'custom' && (!customStartDate || !customEndDate))} style={{ padding: '9px 16px', backgroundColor: '#fff', color: '#475569', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', border: '1px solid #e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isDownloadingHistory ? <><div className="loader" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></div>Downloading...</> : <>⬇ Download History</>}
                        </button>
                    </div>
                    {error && <span style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>⚠ {error}</span>}
                </div>

                {/* ── Three-Panel Body ──────────────────────────────────────── */}
                <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px', alignItems: 'start' }}>

                    {/* ── LEFT: Calendar Panel ─────────────────────────────── */}
                    <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', position: 'sticky', top: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <button onClick={() => setCalendarMonth(prev => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; })} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#1e293b' }}>{formatMonthYear(calendarMonth)}</span>
                            <button onClick={() => setCalendarMonth(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; })} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                        </div>
                        {/* Day-of-week header */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px', marginBottom: '4px' }}>
                            {['S','M','T','W','T','F','S'].map((d, i) => (
                                <div key={i} style={{ textAlign: 'center', fontSize: '0.62rem', fontWeight: 800, color: '#94a3b8', padding: '4px 0' }}>{d}</div>
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
                                            backgroundColor: isSelected ? '#2563eb' : hasData ? '#eff6ff' : 'transparent',
                                            color: isSelected ? '#fff' : hasData ? '#1e40af' : isToday ? '#f59e0b' : '#94a3b8',
                                            outline: isToday && !isSelected ? '2px solid #f59e0b' : 'none',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        {day}
                                        {hasData && !isSelected && (
                                            <span style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#2563eb', display: 'block' }} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Legend */}
                        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f1f5f9', fontSize: '0.7rem', color: '#64748b' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#eff6ff', border: '1px solid #dbeafe' }}></span>Has test data
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#2563eb' }}></span>Selected date
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', outline: '2px solid #f59e0b' }}></span>Today
                            </div>
                        </div>

                        {/* Total runs count */}
                        {calendarDates.length > 0 && (
                            <div style={{ marginTop: '12px', padding: '10px', background: '#f8fafc', borderRadius: '8px', fontSize: '0.72rem', color: '#475569' }}>
                                <div style={{ fontWeight: 800, color: '#1e293b', marginBottom: '2px' }}>{calendarDates.length} test days in history</div>
                                <div>Total {calendarDates.reduce((s, d) => s + d.run_count, 0).toLocaleString()} records tracked</div>
                            </div>
                        )}
                    </div>

                    {/* ── RIGHT: Snapshot + Chart Panel ────────────────────── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                        {/* ── Task Matrix (Right-Top) ─────────────────────── */}
                        <div style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>
                                        {selectedDate ? `Results for ${selectedDate}` : 'FDALabel Auto-Test Tasks'}
                                    </h3>
                                    {!selectedDate && <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>Select a highlighted date on the calendar to view results.</p>}
                                </div>
                                {selectedDate && dateSnapshot.length > 0 && (
                                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', backgroundColor: '#f1f5f9', padding: '4px 10px', borderRadius: '999px' }}>
                                        {dateSnapshot.length} tasks · {activeVersions.length} versions
                                    </span>
                                )}
                            </div>

                            {!selectedDate && (
                                <div style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📅</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Pick a date to explore test results</div>
                                    <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>Blue highlighted days in the calendar have test data available.</div>
                                </div>
                            )}

                            {selectedDate && isSnapshotLoading && (
                                <div style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                    <div className="loader" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
                                    <span style={{ fontSize: '0.85rem' }}>Loading results…</span>
                                </div>
                            )}

                            {selectedDate && !isSnapshotLoading && dateSnapshot.length === 0 && (
                                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8' }}>No records found for {selectedDate}.</div>
                            )}

                            {selectedDate && !isSnapshotLoading && dateSnapshot.length > 0 && (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: '#f8fafc' }}>
                                                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 700, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap', minWidth: '280px' }}>Task</th>
                                                {activeVersions.map(v => (
                                                    <th key={v} style={{ padding: '10px 10px', textAlign: 'center', color: getVersionColor(v), fontWeight: 800, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap', fontSize: '0.68rem' }}>
                                                        {v.replace(' - ', '\n')}
                                                    </th>
                                                ))}
                                                <th style={{ padding: '10px 10px', textAlign: 'center', color: '#64748b', fontWeight: 700, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>Details</th>
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
                                                            borderBottom: '1px solid #f8fafc',
                                                            backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                                                            borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.15s ease',
                                                        }}
                                                        className="row-hover"
                                                    >
                                                        <td style={{ padding: '9px 16px', color: '#1e293b', fontWeight: 600 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ backgroundColor: isSelected ? '#2563eb' : '#e2e8f0', color: isSelected ? '#fff' : '#475569', fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px', flexShrink: 0 }}>#{task.task_num}</span>
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
                                                                            {delay != null && <span style={{ color: '#94a3b8', fontSize: '0.6rem' }}>{delay.toFixed(1)}s</span>}
                                                                        </div>
                                                                    ) : (
                                                                        <span style={{ color: '#e2e8f0' }}>—</span>
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
                                                                            backgroundColor: '#1e293b',
                                                                            color: '#fff',
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
                                                                            <div style={{ fontWeight: 800, borderBottom: '1px solid #334155', paddingBottom: '6px', marginBottom: '8px', color: '#38bdf8', fontSize: '0.74rem' }}>
                                                                                All Runs ({v})
                                                                            </div>
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                                                                                {vData.runs.map((run, idx) => (
                                                                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', borderBottom: idx < vData.runs.length - 1 ? '1px dashed #334155' : 'none', paddingBottom: idx < vData.runs.length - 1 ? '4px' : '0' }}>
                                                                                        <div>
                                                                                            <span style={{ fontWeight: 700, color: '#f8fafc' }}>{run.time}</span>
                                                                                            {run.notes && <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.62rem' }}>{run.notes}</span>}
                                                                                        </div>
                                                                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                                                            <span style={{ color: countColor(run.count), fontWeight: 800 }}>{formatCount(run.count)}</span>
                                                                                            {run.delay != null && <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.62rem' }}>{run.delay.toFixed(1)}s</span>}
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                            <div style={{
                                                                                position: 'absolute',
                                                                                ...(rowIndex < 3 ? {
                                                                                    bottom: '100%',
                                                                                    borderBottom: '6px solid #1e293b',
                                                                                } : {
                                                                                    top: '100%',
                                                                                    borderTop: '6px solid #1e293b',
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
                                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: isSelected ? '#2563eb' : '#94a3b8', backgroundColor: isSelected ? '#dbeafe' : '#f8fafc', padding: '3px 8px', borderRadius: '6px', border: `1px solid ${isSelected ? '#93c5fd' : '#f1f5f9'}` }}>
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
                            <div ref={chartRef} style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ backgroundColor: '#2563eb', color: '#fff', fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px' }}>#{selectedTask.task_num}</span>
                                            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>Historical Trend</h3>
                                        </div>
                                        <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: '#64748b' }}>{selectedTask.query_details}</p>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>Range:</label>
                                        {(['3m', '1y', 'all'] as const).map(r => (
                                            <button key={r} onClick={() => setHistoryRange(r)} style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', backgroundColor: historyRange === r ? '#2563eb' : '#fff', color: historyRange === r ? '#fff' : '#64748b', borderColor: historyRange === r ? '#2563eb' : '#e2e8f0' }}>
                                                {r === 'all' ? 'All' : r.toUpperCase()}
                                            </button>
                                        ))}
                                        <button onClick={() => setShowOutliers(p => !p)} style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', backgroundColor: showOutliers ? '#f59e0b' : '#fff', color: showOutliers ? '#fff' : '#64748b', borderColor: showOutliers ? '#f59e0b' : '#e2e8f0' }}>
                                            {showOutliers ? '● Outliers' : '○ Outliers'}
                                        </button>
                                    </div>
                                </div>

                                {isHistoryLoading ? (
                                    <div style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                        <div className="loader" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
                                        <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Loading history…</span>
                                    </div>
                                ) : processedChartData.length > 0 ? (
                                    <div style={{ padding: '20px' }}>
                                        {/* Delay Chart */}
                                        <div style={{ marginBottom: '20px' }}>
                                            <h4 style={{ margin: '0 0 12px', fontSize: '0.82rem', fontWeight: 800, color: '#ef4444' }}>⏱ Query Processed Time (seconds)</h4>
                                            <div style={{ height: '220px' }}>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={processedChartData} syncId="histCharts" margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                        <XAxis dataKey="DisplayDate" type="category" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                                        <YAxis domain={[0, 'auto']} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
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
                                            <h4 style={{ margin: '0 0 12px', fontSize: '0.82rem', fontWeight: 800, color: '#6366f1' }}>📊 Result Count Over Time</h4>
                                            <div style={{ height: '220px' }}>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={processedChartData} syncId="histCharts" margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                        <XAxis dataKey="DisplayDate" type="category" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                                        <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
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
                                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                                            {chartVersions.map(v => {
                                                const isHidden = hiddenLines.includes(v);
                                                return (
                                                    <button key={v} onClick={() => toggleLine(v)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', opacity: isHidden ? 0.35 : 1, transition: 'opacity 0.2s', fontSize: '0.75rem', fontWeight: 700, color: '#475569', padding: '3px 8px', borderRadius: '6px', backgroundColor: isHidden ? 'transparent' : '#f8fafc' }}>
                                                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: getVersionColor(v), flexShrink: 0 }} />
                                                        {v}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div style={{ fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center', marginTop: '10px', fontStyle: 'italic' }}>
                                            Click legend items to toggle visibility. Delay values after 03/01/2026 use new measurement technology.
                                        </div>
                                        {selectedTask.urls && Object.keys(selectedTask.urls).length > 0 && (
                                            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e2e8f0', textAlign: 'left' }}>
                                                <h5 style={{ margin: '0 0 12px', fontSize: '0.8rem', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    🔗 Manual Verification Links (Test Outliers)
                                                </h5>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px' }}>
                                                    {Object.entries(selectedTask.urls).map(([ver, url]) => (
                                                        <div key={ver} style={{ display: 'flex', alignItems: 'baseline', gap: '10px', fontSize: '0.74rem' }}>
                                                            <span style={{ fontWeight: 800, color: '#475569', minWidth: '140px', flexShrink: 0 }}>
                                                                {ver}:
                                                            </span>
                                                            <a
                                                                href={url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{
                                                                    color: '#2563eb',
                                                                    textDecoration: 'none',
                                                                    wordBreak: 'break-all',
                                                                    fontWeight: 500,
                                                                    transition: 'color 0.15s ease',
                                                                }}
                                                                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.color = '#1d4ed8'; }}
                                                                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.color = '#2563eb'; }}
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
                                    <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', border: '2px dashed #f1f5f9', margin: '20px', borderRadius: '12px' }}>
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
                .loader { border: 3px solid #f3f3f3; border-radius: 50%; border-top-color: #2563eb; animation: spin 1s linear infinite; }
                .row-hover:hover { background-color: #f8fafc !important; }
            `}</style>
        </div>
    );
}
