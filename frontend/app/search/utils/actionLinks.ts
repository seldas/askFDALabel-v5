import {
  labelRoute,
  labelcompRoute,
  labelHistoryRoute,
  labelHistoryByApplicationRoute,
} from '../../platform/context';
import { resultsPath } from '../../querybuilder/queryUrl';
import type { ActionButton } from '../types';

/**
 * Resolves an MCP ActionButton into an app-relative href using the platform's
 * canonical route builders (FetchPrefix.tsx injects the base path at runtime).
 */
export function resolveActionHref(action: ActionButton): string {
  switch (action.type) {
    case 'spl_view':
      return labelRoute(
        action.set_id,
        undefined,
        action.spl_id ? { splId: action.spl_id } : undefined,
      );
    case 'labelcomp':
      return labelcompRoute({
        setIds: action.set_ids,
        splIds: action.spl_ids,
      });
    case 'labelquery':
      return resultsPath(action.wire_query, action.target_db || 'oracle');
    case 'drugtox':
      if (action.set_id) {
        const agent = action.agent || 'dili';
        return `/drugtox/${encodeURIComponent(action.set_id)}?agent=${encodeURIComponent(agent)}`;
      }
      if (action.query) {
        return `/drugtox?q=${encodeURIComponent(action.query)}`;
      }
      return '/drugtox';
    case 'label_history':
      if (action.application_number) {
        return labelHistoryByApplicationRoute(action.application_number);
      }
      return labelHistoryRoute(action.set_id || '');
    case 'faers':
      return labelRoute(action.set_id, 'faers');
  }
}
