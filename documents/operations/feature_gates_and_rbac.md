# Role-Based Access Control (RBAC) & Feature Gates

## 1. Overview

AskFDALabel employs a **data-driven feature gating system** that decouples access rules from code deployments.

Permissions are governed dynamically in the PostgreSQL `public.feature_gates` table and evaluated per-request. Administrators can modify access rights in real-time from the Management Panel (`/management`) without requiring application restarts.

---

## 2. Role Hierarchy

Accounts are assigned one of three mutually exclusive roles (`backend/database/models.py`):

```
                        ┌───────────────────────────────┐
                        │             admin             │
                        │ Full system control, user &   │
                        │ task management, gate config  │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │           developer           │
                        │ Advanced query tools, WebTest,│
                        │ DB selection, raw SQL builder │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │             user              │
                        │ Standard label search, detail │
                        │ views, comparisons, favorites │
                        └───────────────────────────────┘
```

### The Anonymous `guest` Account
When users access the site without signing in, they utilize a shared `guest` account. 
- The guest account holds the `user` role.
- However, per-user state features (personal favorites, saved queries, preferences, and custom API keys) are strictly disabled for guests to prevent session cross-contamination between concurrent anonymous users.
- Every feature gate contains an explicit `allow_guest` boolean flag.

---

## 3. The Feature Catalog (`FEATURE_CATALOG`)

All system features are registered with default security baselines in `backend/dashboard/services/feature_gates.py`:

| Feature Key | Description | Default `min_role` | Default `allow_guest` |
|---|---|---|---|
| `search` | Primary drug label search & LabelChat | `user` | `true` |
| `labelcomp` | Version and multi-label comparison diffing | `user` | `true` |
| `drugtox` | Toxicology profiles, DILI RO2, chemical structures | `user` | `true` |
| `device` | openFDA medical device intelligence | `user` | `true` |
| `localquery` | Local database Boolean query builder | `developer` | `false` |
| `webtest` | Automated regression test validation suite | `developer` | `false` |
| `query_history`| Personal search and query history | `user` | `false` |
| `preferences` | Account preferences and custom AI credentials | `user` | `false` |
| `management` | Administrative panel & Celery task management | `admin` | `false` |

---

## 4. Enforcement Architecture

Permissions are enforced in three coordinated layers:

```
                                  Client Request
                                         │
                                         ▼
1. Frontend Registry & Component Guard (`RequireFeature.tsx` / `registry.ts`)
   Hides inaccessible tools from navigation cards; renders AccessRestricted UI
                                         │
                                         ▼
2. Route Guards (`backend/dashboard/routes/guards.py`)
   • `@require_feature('feature_key')` per endpoint
   • `feature_before_request('feature_key')` per whole blueprint
                                         │
                                         ▼
3. Request-Level Resolution (`FeatureGateService.resolve_gates()`)
   Reads `public.feature_gates`, memoizes on `flask.g` for request duration.
   (Never caches across processes, ensuring instant administrative updates)
```

### Applying Route Guards in Backend Blueprints:
```python
from dashboard.routes.guards import require_feature

@api_bp.route('/sensitive-endpoint')
@login_required
@require_feature('localquery')
def sensitive_endpoint():
    # Only executes if current_user role >= gate.min_role
    return jsonify(...)
```
