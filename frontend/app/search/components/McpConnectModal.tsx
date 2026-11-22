'use client';

import React, { useEffect, useState } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { withApiBase } from '../../utils/appPaths';

interface McpConnectModalProps {
  open: boolean;
  onClose: () => void;
  canUseApiKey: boolean;
}

export const McpConnectModal: React.FC<McpConnectModalProps> = ({
  open,
  onClose,
  canUseApiKey,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [wasCreated, setWasCreated] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!open || !canUseApiKey || apiKey) return;
    let active = true;
    setLoading(true);
    setError(null);

    fetch('/api/dashboard/auth/api-key/ensure', { method: 'POST' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load API key.');
        }
        return data;
      })
      .then((data) => {
        if (!active) return;
        setApiKey(data.api_key || '');
        setWasCreated(Boolean(data.created));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load API key.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, canUseApiKey, apiKey]);

  if (!open) return null;

  const mcpUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${withApiBase('/api/mcp')}`
      : withApiBase('/api/mcp');

  const isPlainHttp = mcpUrl.startsWith('http://');

  const setupPrompt = [
    'Please configure the "askFDALabel" MCP server for me in Claude Desktop (or Claude Code) using the connection details below.',
    '',
    '## Connection Details',
    `- Server Name: askFDALabel`,
    `- Endpoint URL: ${mcpUrl}`,
    `- Transport: Streamable HTTP (JSON-RPC 2.0 POST)`,
    `- Auth Header: Authorization: Bearer ${apiKey}`,
    '- Tools: Automatically discovered from the server after connecting (based on your account permissions).',
    '',
    '## Setup Instructions for Claude',
    '1. Detect my operating system (Windows: %APPDATA%\\Claude\\claude_desktop_config.json, macOS: ~/Library/Application Support/Claude/claude_desktop_config.json).',
    '2. If configuring Claude Desktop:',
    `   - Check if Node.js/npx is available. If yes, configure mcpServers.askFDALabel using "npx" with args: ["-y", "mcp-remote", "${mcpUrl}"${isPlainHttp ? ', "--allow-http"' : ''}, "--header", "Authorization:Bearer ${apiKey}"].`,
    '   - If Node.js is NOT available, create a small zero-dependency local stdio-to-HTTP bridge script (using built-in PowerShell on Windows or Python3 on macOS) that forwards stdin JSON-RPC lines to the Endpoint URL with the Authorization header and prints the JSON response to stdout, then point mcpServers.askFDALabel to that script.',
    '   - Safely merge into claude_desktop_config.json without removing any existing MCP servers.',
    '3. If configuring Claude Code instead, run:',
    `   claude mcp add --transport http askFDALabel "${mcpUrl}" --header "Authorization: Bearer ${apiKey}"`,
    '4. Tell me once the config is updated and remind me to restart Claude Desktop to activate the tools.',
  ].join('\n');

  const handleCopy = async (text: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      // Clipboard fallback ignored if blocked
    }
  };

  const handleRegenerateKey = async () => {
    if (
      regenerating ||
      !window.confirm(
        'Generate a new API key? Your previous key will stop working immediately.'
      )
    ) {
      return;
    }
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/auth/api-key/generate', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to regenerate API key.');
      }
      setApiKey(data.api_key || '');
      setWasCreated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate API key.');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="lc-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lc-modal-header">
          <div className="lc-modal-title-row">
            <HubOutlinedIcon sx={{ fontSize: 20, color: '#2563eb' }} />
            <span>Connect askFDALabel to Claude</span>
          </div>
          <button type="button" className="lc-icon-btn" onClick={onClose} title="Close">
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        <div className="lc-modal-body">
          {!canUseApiKey ? (
            <div className="lc-modal-notice">
              Guest accounts cannot generate personal API keys. Please sign in with your personal
              account to connect Claude Desktop or Claude Code.
            </div>
          ) : loading ? (
            <div className="lc-modal-notice">Preparing your personal API key...</div>
          ) : error ? (
            <div className="lc-modal-error">{error}</div>
          ) : (
            <>
              <p className="lc-modal-desc">
                Copy the setup specification below and paste it directly into{' '}
                <strong>Claude Desktop</strong> or <strong>Claude Code</strong>—Claude will handle
                the configuration for your machine.
                {wasCreated
                  ? ' A new personal API key was generated for your account.'
                  : ' Your existing personal API key is reused below.'}
              </p>

              <div className="lc-modal-actions">
                <button
                  type="button"
                  className="lc-primary-btn"
                  onClick={() => handleCopy(setupPrompt, setCopiedPrompt)}
                >
                  {copiedPrompt ? (
                    <>
                      <CheckIcon sx={{ fontSize: 16 }} />
                      <span>Copied Setup Instructions</span>
                    </>
                  ) : (
                    <>
                      <ContentCopyIcon sx={{ fontSize: 16 }} />
                      <span>Copy Setup Instructions for Claude</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="lc-modal-code">{setupPrompt}</pre>

              <details className="lc-modal-details">
                <summary>Connection details &amp; API Key</summary>
                <div className="lc-modal-kv">
                  <div>
                    <span className="lc-modal-k">MCP URL:</span>{' '}
                    <code>{mcpUrl}</code>
                  </div>
                  <div className="lc-modal-key-row">
                    <span className="lc-modal-k">API Key:</span>{' '}
                    <code>{apiKey}</code>
                    <button
                      type="button"
                      className="lc-topbar-btn"
                      onClick={() => handleCopy(apiKey, setCopiedKey)}
                    >
                      {copiedKey ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                      <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                    </button>
                    <button
                      type="button"
                      className="lc-topbar-btn"
                      onClick={handleRegenerateKey}
                      disabled={regenerating}
                      title="Rotate API key (revokes previous key)"
                    >
                      <span>{regenerating ? 'Regenerating...' : 'Regenerate Key'}</span>
                    </button>
                  </div>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
