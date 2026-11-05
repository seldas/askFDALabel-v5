'use client';

import { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';

type Connections = Record<string, Record<string, string>>;
const names: Record<string, string> = { elsa: 'ELSA', 'llama-4': 'Llama-4 (Local)', muse: 'Muse (Local)', gemini: 'Gemini' };
const fields: Record<string, [string, string][]> = {
  elsa: [['url', 'Service URL'], ['user', 'Username'], ['key', 'API key'], ['model_id', 'Model ID'], ['model_name', 'Model name']],
  'llama-4': [['url', 'API base URL'], ['api_key', 'API key'], ['model_name', 'Model name']],
  muse: [['url', 'API base URL'], ['api_key', 'API key'], ['model_name', 'Model name']],
  gemini: [['api_key', 'API key'], ['model_name', 'Model name']],
};

export default function AiPreferences() {
  const { session, refreshSession } = useUser();
  const [selected, setSelected] = useState('');
  const [connections, setConnections] = useState<Connections>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const models = session?.ai_models || [];
  const reset = () => {
    const saved = session?.ai_preference || '';
    const normalized = ['vllm', 'llama'].includes(saved) ? 'llama-4' : saved;
    setSelected(models.some(m => m.id === normalized) ? normalized : '');
    try {
      const parsed = JSON.parse(session?.ai_settings || '{}');
      const settings: Connections = {};
      for (const model of models) {
        const source = { ...(model.id === 'gemini' ? { api_key: session?.custom_gemini_key } : {}), ...(parsed[model.id] || {}) };
        settings[model.id] = Object.fromEntries(fields[model.id].map(([key]) => [key, typeof source[key] === 'string' ? source[key] : '']));
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
      setMessage('Saved. Your next AI request will use these preferences.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save preferences.'); }
    finally { setSaving(false); }
  };
  return (
    <section id="ai-settings" className="mgmt-card ai-preferences">
      <h2 className="section-title">AI Preferences</h2>
      <p>Choose the model for your account. Changes apply to your next AI request.</p>
      <div className="ai-preferences__current">
        <span>Currently used</span>
        <strong>{names[session?.ai_provider || ''] || session?.ai_provider}</strong>
        <small>{session?.ai_model_name || 'Model not configured'} · {session?.ai_preference ? 'Account preference' : 'System default'}</small>
      </div>
      <fieldset disabled={saving}>
        <legend>Model preference</legend>
        <label className="ai-preferences__option">
          <input type="radio" name="ai-preference" checked={!selected} onChange={() => { setSelected(''); setMessage(''); }} />
          <span>Follow system default <small>{names[session?.ai_default_provider || '']}</small></span>
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
          <summary>Custom connection settings · {names[active]}</summary>
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
