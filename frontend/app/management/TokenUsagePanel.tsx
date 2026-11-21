'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface TokenTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  request_count: number;
}

interface DailyPoint {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  requests: number;
}

interface ModelPoint {
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  requests: number;
}

interface UserSummaryPoint {
  user_id: number;
  username: string;
  display_name?: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  requests: number;
  last_used?: string | null;
}

interface LogEntry {
  id: number;
  user_id: number | null;
  username: string;
  display_name?: string | null;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string | null;
}

interface TokenUsagePanelProps {
  isAdmin: boolean;
}

export const TokenUsagePanel: React.FC<TokenUsagePanelProps> = ({ isAdmin }) => {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all' | 'custom'>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [modelFilter, setModelFilter] = useState('all');
  const [selectedUserId, setSelectedUserId] = useState<string>('all');

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [totals, setTotals] = useState<TokenTotals>({
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    request_count: 0,
  });
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [byModel, setByModel] = useState<ModelPoint[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [usersSummary, setUsersSummary] = useState<UserSummaryPoint[]>([]);

  // On-demand detailed activity logs
  const [showLogs, setShowLogs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalPages, setLogsTotalPages] = useState(1);
  const [logsTotal, setLogsTotal] = useState(0);

  const buildQueryParams = useCallback(
    (extra?: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('range', dateRange);
      if (dateRange === 'custom') {
        if (customStart) params.set('start', customStart);
        if (customEnd) params.set('end', customEnd);
      }
      if (modelFilter && modelFilter !== 'all') {
        params.set('model', modelFilter);
      }
      if (isAdmin && selectedUserId !== 'all') {
        params.set('user_id', selectedUserId);
      }
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => params.set(k, String(v)));
      }
      return params.toString();
    },
    [dateRange, customStart, customEnd, modelFilter, isAdmin, selectedUserId],
  );

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const qs = buildQueryParams();
      const res = await fetch(`/api/dashboard/admin/token_usage/summary?${qs}`);
      const data = await res.json();
      if (data.success) {
        setTotals(data.totals);
        setDaily(data.daily || []);
        setByModel(data.by_model || []);
        setAvailableModels(data.available_models || []);
        if (isAdmin && Array.isArray(data.users_summary)) {
          setUsersSummary(data.users_summary);
        }
      }
    } catch (err) {
      console.error('Failed to fetch token usage summary:', err);
    } finally {
      setLoadingSummary(false);
    }
  }, [buildQueryParams, isAdmin]);

  const fetchLogs = useCallback(
    async (pageNum: number) => {
      setLoadingLogs(true);
      try {
        const qs = buildQueryParams({ page: pageNum, limit: 25 });
        const res = await fetch(`/api/dashboard/admin/token_usage/logs?${qs}`);
        const data = await res.json();
        if (data.success) {
          setLogs(data.logs || []);
          setLogsPage(data.page || 1);
          setLogsTotalPages(data.total_pages || 1);
          setLogsTotal(data.total || 0);
        }
      } catch (err) {
        console.error('Failed to fetch token usage logs:', err);
      } finally {
        setLoadingLogs(false);
      }
    },
    [buildQueryParams],
  );

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (showLogs) {
      fetchLogs(logsPage);
    }
  }, [showLogs, logsPage, fetchLogs]);

  const maxDailyTokens = useMemo(
    () => Math.max(1, ...daily.map((d) => d.total_tokens)),
    [daily],
  );

  const avgPerRequest = totals.request_count > 0
    ? Math.round(totals.total_tokens / totals.request_count)
    : 0;

  const selectedUserObj = useMemo(
    () => usersSummary.find((u) => String(u.user_id) === selectedUserId) || null,
    [usersSummary, selectedUserId],
  );

  const handleInspectUser = (userId: number) => {
    setSelectedUserId(String(userId));
    setLogsPage(1);
    setShowLogs(true);
  };

  return (
    <section className="mgmt-card">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>
            {isAdmin ? 'Token Usage Overview' : 'My Token Usage'}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: 'var(--fdl-canvas0)' }}>
            {selectedUserObj
              ? `Filtered to user: ${selectedUserObj.display_name || selectedUserObj.username}`
              : isAdmin
                ? 'Aggregated LLM token consumption across the platform. Click any user below for detailed logs.'
                : 'Summary of your LLM token usage across tools.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isAdmin && selectedUserId !== 'all' && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSelectedUserId('all');
                setLogsPage(1);
              }}
            >
              All Users
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              fetchSummary();
              if (showLogs) fetchLogs(logsPage);
            }}
            disabled={loadingSummary}
          >
            {loadingSummary ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem', padding: '0.65rem 0.85rem', background: 'var(--fdl-canvas)', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--fdl-ink-soft)' }}>Range:</span>
          <select
            value={dateRange}
            onChange={(e) => {
              setDateRange(e.target.value as '7d' | '30d' | 'all' | 'custom');
              setLogsPage(1);
            }}
            style={{ padding: '5px 10px', borderRadius: '2px', border: '1px solid var(--fdl-line)', fontSize: '0.84rem', background: 'white' }}
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {dateRange === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="date"
              value={customStart}
              onChange={(e) => {
                setCustomStart(e.target.value);
                setLogsPage(1);
              }}
              style={{ padding: '4px 6px', fontSize: '0.8rem', borderRadius: '2px', border: '1px solid var(--fdl-line)', background: 'white' }}
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--fdl-canvas0)' }}>to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => {
                setCustomEnd(e.target.value);
                setLogsPage(1);
              }}
              style={{ padding: '4px 6px', fontSize: '0.8rem', borderRadius: '2px', border: '1px solid var(--fdl-line)', background: 'white' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--fdl-ink-soft)' }}>Model:</span>
          <select
            value={modelFilter}
            onChange={(e) => {
              setModelFilter(e.target.value);
              setLogsPage(1);
            }}
            style={{ padding: '5px 10px', borderRadius: '2px', border: '1px solid var(--fdl-line)', fontSize: '0.84rem', background: 'white' }}
          >
            <option value="all">All Models</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--fdl-ink-soft)' }}>User:</span>
            <select
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value);
                setLogsPage(1);
              }}
              style={{ padding: '5px 10px', borderRadius: '2px', border: '1px solid var(--fdl-line)', fontSize: '0.84rem', background: 'white' }}
            >
              <option value="all">All Users</option>
              {usersSummary.map((u) => (
                <option key={u.user_id} value={String(u.user_id)}>
                  {u.display_name || u.username}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
          <div style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--fdl-canvas0)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Tokens</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--fdl-blue-600)', marginTop: '4px' }}>
            {totals.total_tokens.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--fdl-canvas0)', marginTop: '4px' }}>
            In {totals.input_tokens.toLocaleString()} · Out {totals.output_tokens.toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'white', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
          <div style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--fdl-canvas0)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requests</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--fdl-ink)', marginTop: '4px' }}>
            {totals.request_count.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--fdl-canvas0)', marginTop: '4px' }}>
            LLM calls recorded
          </div>
        </div>

        <div style={{ background: 'white', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
          <div style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--fdl-canvas0)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg / Request</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--fdl-ink)', marginTop: '4px' }}>
            {avgPerRequest.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--fdl-canvas0)', marginTop: '4px' }}>
            Tokens per call
          </div>
        </div>

        <div style={{ background: 'white', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
          <div style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--fdl-canvas0)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isAdmin && selectedUserId === 'all' ? 'Active Users' : 'Models Used'}
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--fdl-ink)', marginTop: '4px' }}>
            {isAdmin && selectedUserId === 'all' ? usersSummary.length : byModel.length}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--fdl-canvas0)', marginTop: '4px' }}>
            {isAdmin && selectedUserId === 'all' ? `${byModel.length} active model(s)` : 'Distinct models'}
          </div>
        </div>
      </div>

      {/* Visual Overview: Daily Trend + Model Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Daily Trend */}
        <div style={{ background: 'var(--fdl-canvas)', border: '1px solid var(--fdl-line)', borderRadius: '2px', padding: '1rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--fdl-ink)', marginBottom: '0.75rem' }}>
            Daily Token Trend
          </div>
          {daily.length === 0 ? (
            <div style={{ padding: '2rem 0', textAlign: 'center', fontSize: '0.84rem', color: 'var(--fdl-muted)' }}>
              No usage in selected range
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '140px', paddingTop: '12px', overflowX: 'auto' }}>
              {daily.map((d) => {
                const pct = Math.max(4, Math.round((d.total_tokens / maxDailyTokens) * 100));
                return (
                  <div
                    key={d.date}
                    title={`${d.date}: ${d.total_tokens.toLocaleString()} tokens (${d.requests} reqs)`}
                    style={{ flex: '1 1 18px', minWidth: '18px', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
                  >
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '28px',
                        height: `${pct}%`,
                        background: 'var(--fdl-blue-600)',
                        borderRadius: '2px 2px 0 0',
                        transition: 'height 0.2s ease',
                      }}
                    />
                    <span style={{ fontSize: '0.68rem', color: 'var(--fdl-canvas0)', marginTop: '5px', whiteSpace: 'nowrap' }}>
                      {d.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Model Breakdown */}
        <div style={{ background: 'var(--fdl-canvas)', border: '1px solid var(--fdl-line)', borderRadius: '2px', padding: '1rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--fdl-ink)', marginBottom: '0.75rem' }}>
            Usage by Model
          </div>
          {byModel.length === 0 ? (
            <div style={{ padding: '2rem 0', textAlign: 'center', fontSize: '0.84rem', color: 'var(--fdl-muted)' }}>
              No model usage recorded
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {byModel.map((m) => {
                const denom = byModel.reduce((acc, item) => acc + item.total_tokens, 0) || 1;
                const pct = Math.round((m.total_tokens / denom) * 100);
                return (
                  <div key={m.model_name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--fdl-ink-soft)' }}>{m.model_name}</span>
                      <span style={{ color: 'var(--fdl-canvas0)' }}>
                        {m.total_tokens.toLocaleString()} ({pct}% · {m.requests} reqs)
                      </span>
                    </div>
                    <div style={{ height: '7px', background: 'var(--fdl-line)', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--fdl-blue-600)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Admin: Users Summary (click to inspect detailed logs) */}
      {isAdmin && selectedUserId === 'all' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--fdl-ink)' }}>
              Users Summary
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--fdl-canvas0)' }}>
              {usersSummary.length} active user{usersSummary.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="user-table-wrapper">
            <table className="user-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0 10px 6px', borderBottom: 'none' }}>User</th>
                  <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Requests</th>
                  <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Input</th>
                  <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Output</th>
                  <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Total Tokens</th>
                  <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {usersSummary.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '18px', color: 'var(--fdl-muted)' }}>
                      No user token usage in this range.
                    </td>
                  </tr>
                ) : (
                  usersSummary.map((u) => (
                    <tr key={u.user_id} style={{ background: 'var(--fdl-canvas)' }}>
                      <td style={{ padding: '10px', borderBottom: 'none', fontWeight: 600, color: 'var(--fdl-ink-soft)' }}>
                        {u.display_name || u.username}
                      </td>
                      <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right', color: 'var(--fdl-canvas0)' }}>
                        {u.requests.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right', color: 'var(--fdl-canvas0)' }}>
                        {u.input_tokens.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right', color: 'var(--fdl-canvas0)' }}>
                        {u.output_tokens.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right', fontWeight: 800, color: 'var(--fdl-ink)' }}>
                        {u.total_tokens.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                          onClick={() => handleInspectUser(u.user_id)}
                        >
                          View Logs
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* On-Demand Detailed Activity Logs */}
      <div style={{ borderTop: '1px solid var(--fdl-line)', paddingTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showLogs ? '0.85rem' : 0 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setLogsPage(1);
              setShowLogs((v) => !v);
            }}
          >
            {showLogs ? 'Hide Detailed Activity Logs' : 'Show Detailed Activity Logs'}
          </button>
          {showLogs && (
            <span style={{ fontSize: '0.8rem', color: 'var(--fdl-canvas0)' }}>
              {logsTotal.toLocaleString()} record{logsTotal !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {showLogs && (
          <>
            <div className="user-table-wrapper">
              <table className="user-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0 10px 6px', borderBottom: 'none' }}>Timestamp</th>
                    {isAdmin && <th style={{ padding: '0 10px 6px', borderBottom: 'none' }}>User</th>}
                    <th style={{ padding: '0 10px 6px', borderBottom: 'none' }}>Model</th>
                    <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Input</th>
                    <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Output</th>
                    <th style={{ padding: '0 10px 6px', borderBottom: 'none', textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingLogs ? (
                    <tr>
                      <td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', padding: '20px', color: 'var(--fdl-muted)' }}>
                        Loading activity logs...
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', padding: '20px', color: 'var(--fdl-muted)' }}>
                        No detailed logs found for this filter.
                      </td>
                    </tr>
                  ) : (
                    logs.map((row) => (
                      <tr key={row.id} style={{ background: 'var(--fdl-canvas)' }}>
                        <td style={{ padding: '10px', borderBottom: 'none', fontSize: '0.83rem', color: 'var(--fdl-ink-soft)' }}>
                          {row.created_at
                            ? new Date(row.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })
                            : '—'}
                        </td>
                        {isAdmin && (
                          <td style={{ padding: '10px', borderBottom: 'none', fontSize: '0.83rem', fontWeight: 600, color: 'var(--fdl-ink-soft)' }}>
                            {row.display_name || row.username}
                          </td>
                        )}
                        <td style={{ padding: '10px', borderBottom: 'none', fontSize: '0.83rem' }}>
                          <span style={{ background: 'var(--fdl-line)', padding: '3px 8px', borderRadius: '2px', fontWeight: 600 }}>
                            {row.model_name}
                          </span>
                        </td>
                        <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right', fontSize: '0.85rem', color: 'var(--fdl-canvas0)' }}>
                          {row.input_tokens.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right', fontSize: '0.85rem', color: 'var(--fdl-canvas0)' }}>
                          {row.output_tokens.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px', borderBottom: 'none', textAlign: 'right', fontWeight: 800, color: 'var(--fdl-ink)' }}>
                          {row.total_tokens.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {!loadingLogs && logsTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '0.85rem' }}>
                <button
                  type="button"
                  disabled={logsPage <= 1}
                  onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                  className="btn-ghost"
                >
                  Previous
                </button>
                <span style={{ fontSize: '0.84rem', color: 'var(--fdl-ink-soft)' }}>
                  Page {logsPage} of {logsTotalPages}
                </span>
                <button
                  type="button"
                  disabled={logsPage >= logsTotalPages}
                  onClick={() => setLogsPage((p) => Math.min(logsTotalPages, p + 1))}
                  className="btn-ghost"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
