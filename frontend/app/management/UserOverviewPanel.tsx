'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { UserSession } from '../context/UserContext';
import AiPreferences from './AiPreferences';
import { TokenUsagePanel } from './TokenUsagePanel';

interface QueryHistoryItem {
  id: number;
  query_title?: string | null;
  query_link?: string | null;
  result_count?: number | null;
  target_db?: string | null;
  timestamp?: string | null;
}

interface CopilotHistoryItem {
  id: number;
  title?: string | null;
  chat_data?: Array<{ role?: string; content?: string }>;
  timestamp?: string | null;
}

interface TokenSummary7d {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
}

interface UserOverviewPanelProps {
  session: UserSession;
  apiKey: string | null;
  apiKeyCreatedAt?: string | null;
  apiKeyLastUsed?: string | null;
  loadingApiKey: boolean;
  generatingKey: boolean;
  revokingKey: boolean;
  onGenerateApiKey: () => void;
  onRevokeApiKey: () => void;
  onOpenChangePassword: () => void;
  formatUserDate: (isoStr?: string | null) => string | null;
  focusSection?: string | null;
}

export const UserOverviewPanel: React.FC<UserOverviewPanelProps> = ({
  session,
  apiKey,
  apiKeyCreatedAt,
  apiKeyLastUsed,
  loadingApiKey,
  generatingKey,
  revokingKey,
  onGenerateApiKey,
  onRevokeApiKey,
  onOpenChangePassword,
  formatUserDate,
  focusSection,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [historyItems, setHistoryItems] = useState<QueryHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [copilotItems, setCopilotItems] = useState<CopilotHistoryItem[]>([]);
  const [loadingCopilot, setLoadingCopilot] = useState(true);
  const [token7d, setToken7d] = useState<TokenSummary7d | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadOverviewData = async () => {
      setLoadingHistory(true);
      setLoadingCopilot(true);
      const [histRes, copilotRes, tokenRes] = await Promise.allSettled([
        fetch('/api/dashboard/query_history?limit=6'),
        fetch('/api/search/history'),
        fetch('/api/dashboard/admin/token_usage/summary?range=7d'),
      ]);

      if (cancelled) return;

      if (histRes.status === 'fulfilled' && histRes.value.ok) {
        try {
          const data = await histRes.value.json();
          if (Array.isArray(data.history)) setHistoryItems(data.history);
        } catch {
          /* ignore */
        }
      }
      setLoadingHistory(false);

      if (copilotRes.status === 'fulfilled' && copilotRes.value.ok) {
        try {
          const data = await copilotRes.value.json();
          if (Array.isArray(data.histories)) {
            setCopilotItems(data.histories.slice(0, 5));
          }
        } catch {
          /* ignore */
        }
      }
      setLoadingCopilot(false);

      if (tokenRes.status === 'fulfilled' && tokenRes.value.ok) {
        try {
          const data = await tokenRes.value.json();
          if (data.success && data.totals) {
            setToken7d(data.totals);
          }
        } catch {
          /* ignore */
        }
      }
    };

    loadOverviewData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (focusSection === 'tokens') {
      const el = document.getElementById('overview-tokens');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [focusSection]);

  const handleCopyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 8)}${'•'.repeat(Math.max(8, apiKey.length - 12))}${apiKey.slice(-4)}`
    : '';

  const displayName = session.display_name || session.username || 'Reviewer';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

  const roleLabel = session.role || (session.is_admin ? 'admin' : 'user');
  const authLabel =
    session.auth_method === 'saml'
      ? `SSO (${session.sso_label || session.sso_provider || 'SAML'})`
      : 'Local Password';
  const activeModel = session.ai_model_name || session.ai_provider || 'Default';
  const effectiveKeyCreated = apiKeyCreatedAt || session.api_key_created_at;
  const effectiveKeyLastUsed = apiKeyLastUsed || session.api_key_last_used;

  return (
    <div className="ov-root">
      {/* 1. Identity & Quick Actions Banner */}
      <section className="ov-banner" aria-label="Account summary">
        <div className="ov-banner__id">
          <div className="ov-avatar" aria-hidden="true">{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div className="ov-banner__name">
              <h2>{displayName}</h2>
              <span className="ov-pill ov-pill--role">{roleLabel}</span>
              <span className="ov-pill">{authLabel}</span>
            </div>
            <div className="ov-banner__meta">
              {session.username && <span>@{session.username}</span>}
              <span>·</span>
              <span>Last login: {formatUserDate(session.last_login) || 'Just now'}</span>
              <span>·</span>
              <span>Member since: {formatUserDate(session.created_at) || '—'}</span>
            </div>
          </div>
        </div>

        <div className="ov-banner__actions">
          <Link href="/dashboard" className="btn-ghost" style={{ textDecoration: 'none' }}>
            My Collections
          </Link>
          <Link href="/search" className="btn-ghost" style={{ textDecoration: 'none' }}>
            Label Copilot
          </Link>
          {session.auth_method !== 'saml' && (
            <button type="button" className="btn-ghost" onClick={onOpenChangePassword}>
              Change Password
            </button>
          )}
        </div>
      </section>

      {/* 2. Top KPI Strip */}
      <section className="ov-kpi-grid" aria-label="Key usage metrics">
        <div className="ov-kpi">
          <span className="ov-kpi__label">Tokens (Last 7 Days)</span>
          <span className="ov-kpi__value" style={{ color: 'var(--fdl-blue-700)' }}>
            {token7d ? token7d.total_tokens.toLocaleString() : '—'}
          </span>
          <span className="ov-kpi__sub">
            {token7d
              ? `In ${token7d.input_tokens.toLocaleString()} · Out ${token7d.output_tokens.toLocaleString()}`
              : 'Loading usage summary...'}
          </span>
        </div>

        <div className="ov-kpi">
          <span className="ov-kpi__label">LLM Requests (7d)</span>
          <span className="ov-kpi__value">
            {token7d ? token7d.request_count.toLocaleString() : '—'}
          </span>
          <span className="ov-kpi__sub" title={activeModel}>
            Model: {activeModel}
          </span>
        </div>

        <div className="ov-kpi">
          <span className="ov-kpi__label">API Key Status</span>
          <span className="ov-kpi__value" style={{ color: apiKey ? '#15803d' : 'var(--fdl-muted)' }}>
            {loadingApiKey ? 'Checking...' : apiKey ? 'Active' : 'Not Generated'}
          </span>
          <span className="ov-kpi__sub">
            {apiKey
              ? `Last used: ${formatUserDate(effectiveKeyLastUsed) || 'Never'}`
              : 'Generate a key for API / MCP'}
          </span>
        </div>

        <div className="ov-kpi">
          <span className="ov-kpi__label">Recent Activity</span>
          <span className="ov-kpi__value">
            {loadingHistory ? '—' : historyItems.length}
          </span>
          <span className="ov-kpi__sub">
            {historyItems[0]?.timestamp
              ? `Latest query: ${formatUserDate(historyItems[0].timestamp)}`
              : 'Saved label queries'}
          </span>
        </div>
      </section>

      {/* 3. Two-Column Dashboard Workspace */}
      <div className="ov-main-grid">
        {/* Left Column: Query History & Copilot Sessions */}
        <div className="ov-col">
          <section className="ov-card">
            <div className="ov-card__head">
              <div>
                <h3 className="ov-card__title">Recent Query History</h3>
                <p className="ov-card__sub">Saved label searches for quick reopening.</p>
              </div>
              <Link href="/dashboard/query_history" className="btn-ghost" style={{ textDecoration: 'none', minHeight: '28px', padding: '4px 10px', fontSize: '0.78rem' }}>
                View All
              </Link>
            </div>

            {loadingHistory ? (
              <p style={{ fontSize: '0.84rem', color: 'var(--fdl-muted)', margin: 0 }}>Loading recent queries...</p>
            ) : historyItems.length === 0 ? (
              <p style={{ fontSize: '0.84rem', color: 'var(--fdl-muted)', margin: 0 }}>
                No saved query history yet.
              </p>
            ) : (
              <div className="ov-list">
                {historyItems.map((item) => (
                  <div key={item.id} className="ov-list__row">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {item.query_link ? (
                        <Link href={item.query_link} className="ov-list__title" title={item.query_title || 'Untitled Query'}>
                          {item.query_title || 'Untitled Query'}
                        </Link>
                      ) : (
                        <span className="ov-list__title">{item.query_title || 'Untitled Query'}</span>
                      )}
                      <div className="ov-list__meta">
                        {item.target_db ? `DB: ${item.target_db}` : 'Default DB'}
                        {typeof item.result_count === 'number' ? ` · ${item.result_count} results` : ''}
                      </div>
                    </div>
                    <span className="ov-list__time">{formatUserDate(item.timestamp) || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="ov-card">
            <div className="ov-card__head">
              <div>
                <h3 className="ov-card__title">Recent Label Copilot Sessions</h3>
                <p className="ov-card__sub">Your latest saved assistant conversations.</p>
              </div>
              <Link href="/search" className="btn-ghost" style={{ textDecoration: 'none', minHeight: '28px', padding: '4px 10px', fontSize: '0.78rem' }}>
                Open Copilot
              </Link>
            </div>

            {loadingCopilot ? (
              <p style={{ fontSize: '0.84rem', color: 'var(--fdl-muted)', margin: 0 }}>Loading conversations...</p>
            ) : copilotItems.length === 0 ? (
              <p style={{ fontSize: '0.84rem', color: 'var(--fdl-muted)', margin: 0 }}>
                No saved Label Copilot conversations yet.
              </p>
            ) : (
              <div className="ov-list">
                {copilotItems.map((item) => {
                  const turnCount = Array.isArray(item.chat_data) ? item.chat_data.length : 0;
                  return (
                    <div key={item.id} className="ov-list__row">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Link href="/search" className="ov-list__title" title={item.title || 'Saved Conversation'}>
                          {item.title || 'Saved Conversation'}
                        </Link>
                        <div className="ov-list__meta">
                          {turnCount > 0 ? `${turnCount} messages` : 'Saved session'}
                        </div>
                      </div>
                      <span className="ov-list__time">{formatUserDate(item.timestamp) || '—'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: LLM Preferences & API Key */}
        <div className="ov-col">
          <AiPreferences compact />

          <section className="ov-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="ov-card__head" style={{ marginBottom: 0 }}>
              <div>
                <h3 className="ov-card__title">API Key &amp; Access</h3>
                <p className="ov-card__sub">Personal credential for REST API &amp; MCP clients.</p>
              </div>
              <span className={`ov-pill${apiKey ? ' ov-pill--active' : ''}`}>
                {apiKey ? 'Active' : 'None'}
              </span>
            </div>

            {loadingApiKey ? (
              <p style={{ fontSize: '0.84rem', color: 'var(--fdl-muted)', margin: 0 }}>Loading API key...</p>
            ) : apiKey ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '0.55rem 0.7rem',
                    background: 'var(--fdl-canvas)',
                    border: '1px solid var(--fdl-line)',
                    borderRadius: '2px',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    overflowX: 'auto',
                  }}
                >
                  <span style={{ flex: 1, whiteSpace: 'nowrap' }}>
                    {showKey ? apiKey : maskedKey}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ minHeight: '26px', padding: '2px 8px', fontSize: '0.74rem' }}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? 'Hide' : 'Reveal'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ minHeight: '26px', padding: '2px 8px', fontSize: '0.74rem' }}
                    onClick={handleCopyKey}
                  >
                    {copiedKey ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div className="ov-kv">
                  <span className="ov-kv__k">Created</span>
                  <span className="ov-kv__v">{formatUserDate(effectiveKeyCreated) || '—'}</span>
                  <span className="ov-kv__k">Last Used</span>
                  <span className="ov-kv__v">{formatUserDate(effectiveKeyLastUsed) || 'Never'}</span>
                  <span className="ov-kv__k">Auth Header</span>
                  <span className="ov-kv__v" style={{ fontFamily: 'monospace', fontSize: '0.76rem' }}>
                    Authorization: Bearer &lt;key&gt;
                  </span>
                </div>
              </>
            ) : (
              <div
                style={{
                  padding: '0.85rem',
                  background: 'var(--fdl-canvas)',
                  border: '1px dashed var(--fdl-line)',
                  borderRadius: '2px',
                  fontSize: '0.83rem',
                  color: 'var(--fdl-muted)',
                }}
              >
                No API key generated yet. Generate one to authenticate external scripts or Claude MCP.
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={onGenerateApiKey}
                disabled={generatingKey}
              >
                {generatingKey ? 'Generating...' : apiKey ? 'Rotate Key' : 'Generate API Key'}
              </button>
              {apiKey && (
                <button
                  type="button"
                  className="btn-danger-ghost"
                  onClick={onRevokeApiKey}
                  disabled={revokingKey}
                >
                  {revokingKey ? 'Revoking...' : 'Revoke'}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 4. Full-Width Token Usage Analytics */}
      <section id="overview-tokens" className="ov-card">
        <TokenUsagePanel isAdmin={false} />
      </section>
    </div>
  );
};
