'use client';

import { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';

type Connections = Record<string, Record<string, string>>;
const fallbackNames: Record<string, string> = {
  elsa: 'ELSA',
  'local-1': 'Local LLM 1',
  'local-2': 'Local LLM 2',
  gemini: 'Gemini',
};
const fields: Record<string, [string, string][]> = {
  elsa: [['url', 'Service URL'], ['user', 'Username'], ['key', 'API key'], ['model_id', 'Model ID'], ['model_name', 'Model name']],
  'local-1': [['url', 'API base URL'], ['api_key', 'API key'], ['model_name', 'Model name']],
  'local-2': [['url', 'API base URL'], ['api_key', 'API key'], ['model_name', 'Model name']],
  gemini: [['api_key', 'API key'], ['model_name', 'Model name']],
};
const legacyProviderMap: Record<string, string> = {
  vllm: 'local-1',
  llama: 'local-1',
  'llama-4': 'local-1',
  muse: 'local-2',
};

export default function AiPreferences({ compact = false }: { compact?: boolean }) {
  const { session, refreshSession } = useUser();
  const [selected, setSelected] = useState('');
  const [connections, setConnections] = useState<Connections>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const models = session?.ai_models || [];
  const labelFor = (id?: string) => {
    if (!id) return '';
    const normalized = legacyProviderMap[id] || id;
    return models.find(m => m.id === normalized)?.name || fallbackNames[normalized] || id;
  };
  const reset = () => {
    const saved = session?.ai_preference || '';
    const normalized = legacyProviderMap[saved] || saved;
    setSelected(models.some(m => m.id === normalized) ? normalized : '');
    try {
      const parsed = JSON.parse(session?.ai_settings || '{}');
      const settings: Connections = {};
      for (const model of models) {
        const legacySource =
          model.id === 'local-1' ? (parsed['llama-4'] || parsed.llama || parsed.vllm || {}) :
          model.id === 'local-2' ? (parsed.muse || {}) : {};
        const source = { ...(model.id === 'gemini' ? { api_key: session?.custom_gemini_key } : {}), ...legacySource, ...(parsed[model.id] || {}) };
        settings[model.id] = Object.fromEntries((fields[model.id] || []).map(([key]) => [key, typeof source[key] === 'string' ? source[key] : '']));
      }
      setConnections(settings);
    } catch { setConnections({}); }
  };
  useEffect(() => { reset(); }, [session?.id, session?.ai_preference, session?.ai_settings, session?.allowed_ai_providers?.join(',')]);
  const active = selected || session?.ai_default_provider || '';
  const save = async () => {
    setSaving(true); setMessage(''); setError('');
    try {
      const res = await fetch('/api/dashboard/preferences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_provider: selected, ...(session?.is_admin ? { ai_settings: connections } : {}) }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Could not save preferences.');
      await refreshSession();
      setMessage('Saved. Your next LLM request will use these preferences.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save preferences.'); }
    finally { setSaving(false); }
  };
  const savedNormalized = (() => {
    const saved = session?.ai_preference || '';
    const norm = legacyProviderMap[saved] || saved;
    return models.some(m => m.id === norm) ? norm : '';
  })();
  const isDirty = selected !== savedNormalized;

  if (compact) {
    return (
      <section id="ai-settings" className="ov-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div className="ov-card__head" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="ov-card__title">Default AI Model</h3>
            <p className="ov-card__sub">Applies to your next Label Copilot &amp; summary request.</p>
          </div>
          <span className="ov-pill ov-pill--role">{labelFor(session?.ai_provider) || 'Default'}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="mgmt-select"
            style={{ flex: '1 1 200px' }}
            value={selected}
            disabled={saving || !models.length}
            onChange={(e) => { setSelected(e.target.value); setMessage(''); setError(''); }}
            aria-label="Default AI model"
          >
            <option value="">
              Follow system default ({labelFor(session?.ai_default_provider) || 'System'})
            </option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}{model.model ? ` — ${model.model}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={isDirty ? 'btn-primary' : 'btn-ghost'}
            disabled={saving || !models.length || !isDirty}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {session?.ai_model_name && (
          <div style={{ fontSize: '0.78rem', color: 'var(--fdl-muted)' }}>
            Active model ID: <code style={{ color: 'var(--fdl-ink-soft)' }}>{session.ai_model_name}</code>
          </div>
        )}

        {session?.is_admin && fields[active] && (
          <details className="ai-preferences__advanced" key={active} style={{ margin: 0 }}>
            <summary style={{ fontSize: '0.8rem', cursor: 'pointer', color: 'var(--fdl-blue-700)', fontWeight: 600 }}>
              Custom connection settings · {labelFor(active)}
            </summary>
            <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {fields[active].map(([key, label]) => (
                <label className="ai-preferences__field" key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--fdl-muted)', fontWeight: 600 }}>{label}</span>
                  <input
                    className="mgmt-input-sm"
                    type={key.includes('key') ? 'password' : 'text'}
                    autoComplete="off"
                    disabled={saving}
                    value={connections[active]?.[key] || ''}
                    placeholder="Use deployment default"
                    onChange={e => {
                      setMessage('');
                      setConnections(old => ({ ...old, [active]: { ...old[active], [key]: e.target.value } }));
                    }}
                  />
                </label>
              ))}
              <div>
                <button type="button" className="btn-primary-sm" disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save Connection'}
                </button>
              </div>
            </div>
          </details>
        )}

        {error && <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--fdl-red)' }}>{error}</p>}
        {message && <p role="status" style={{ margin: 0, fontSize: '0.8rem', color: '#15803d' }}>{message}</p>}
      </section>
    );
  }

  return (
    <section id="ai-settings" className="mgmt-card ai-preferences">
      <h2 className="section-title">LLM Preferences</h2>
      <p>Choose the model for your account. Changes apply to your next LLM request.</p>
      <div className="ai-preferences__current">
        <span>Currently used</span>
        <strong>{labelFor(session?.ai_provider)}</strong>
        <small>{session?.ai_model_name || 'Model not configured'} · {session?.ai_preference ? 'Account preference' : 'System default'}</small>
      </div>
      <fieldset disabled={saving}>
        <legend>Model preference</legend>
        <label className="ai-preferences__option">
          <input type="radio" name="ai-preference" checked={!selected} onChange={() => { setSelected(''); setMessage(''); }} />
          <span>Follow system default <small>{labelFor(session?.ai_default_provider)}</small></span>
        </label>
        {models.map(model => (
          <label className="ai-preferences__option" key={model.id}>
            <input type="radio" name="ai-preference" checked={selected === model.id} onChange={() => { setSelected(model.id); setMessage(''); }} />
            <span>{model.name}<small>{model.model || 'Connection requires configuration'}</small></span>
          </label>
        ))}
      </fieldset>
      {session?.is_admin && fields[active] && (
        <details className="ai-preferences__advanced" key={active}>
          <summary>Custom connection settings · {labelFor(active)}</summary>
          <p>Only affects your account. Leave fields blank to use deployment defaults. System-wide connections are configured in .env and require a service restart.</p>
          {fields[active].map(([key, label]) => (
            <label className="ai-preferences__field" key={key}>
              <span>{label}</span>
              <input type={key.includes('key') ? 'password' : 'text'} autoComplete="off" disabled={saving}
                value={connections[active]?.[key] || ''} placeholder="Use deployment default"
                onChange={e => { setMessage(''); setConnections(old => ({ ...old, [active]: { ...old[active], [key]: e.target.value } })); }} />
            </label>
          ))}
        </details>
      )}
      {!session?.is_admin && <p className="ai-preferences__hint">Connections are managed by your administrator.</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="ai-preferences__actions">
        <button className="btn-secondary" disabled={saving} onClick={() => { reset(); setMessage(''); setError(''); }}>Discard changes</button>
        <button className="btn-primary" disabled={saving || !models.length} onClick={save}>{saving ? 'Saving…' : 'Save preferences'}</button>
      </div>
    </section>
  );
}
