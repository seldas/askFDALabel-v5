'use client';

import { useCapabilities, type Capabilities } from './capabilities';
import { getTool, type ToolDef } from './registry';
import './serviceWarning.css';

export function toolServiceState(tool: ToolDef, caps: Capabilities) {
  const dependency = tool.externalService;
  const service = dependency && caps.externalServices?.[dependency.name];
  const affected = Boolean(service && service.status !== 'available' && service.status !== 'checking');
  const disabled = Boolean(dependency?.required && service?.status === 'unavailable');
  const message = !affected ? '' : dependency?.name === 'dailymed'
    ? `${service?.message} Some features may be degraded because DailyMed images cannot be retrieved reliably. Locally stored and uploaded images remain available.`
    : `${service?.message} Live OpenFDA retrieval ${disabled ? 'is disabled' : 'may be degraded'}. Saved results remain available.`;
  return { disabled, message };
}

export function ServiceWarning({ toolId, service, compact = false }: {
  toolId?: string; service?: 'openfda' | 'dailymed'; compact?: boolean;
}) {
  const { capabilities } = useCapabilities();
  const tool = toolId ? getTool(toolId) : undefined;
  const state = tool ? toolServiceState(tool, capabilities) : service && capabilities.externalServices?.[service];
  const message = state && ('message' in state ? state.message : '');
  if (!message) return null;
  const explanation = !tool && service === 'openfda'
    ? `${message} Label scanning remains available; live FAERS counts may be unavailable.` : message;
  return <span className={`afl-service-warning${compact ? ' afl-service-warning--compact' : ''}`} role="status" title={explanation} tabIndex={0}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5m0 3v1" /></svg>
    <span className={compact ? 'afl-service-warning__tooltip' : ''}>{explanation}</span>
  </span>;
}
