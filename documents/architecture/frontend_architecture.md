# Frontend Architecture & Next.js 16 Implementation

## 1. Overview

The frontend is built using **Next.js 16 (App Router)**, React 19, TypeScript, and Tailwind CSS. It is designed to operate under path-prefixed production reverse proxies (`/fdalabel-v3`) while maintaining direct development ergonomics.

The architecture emphasizes:
1. **Centralized Tool Catalog (`platform/registry.ts`)**: Single source of truth for all tools, navigation cards, and permission gates.
2. **Path-Prefix Neutrality**: Client-side monkey-patching and rewrites that allow writing relative API paths (`/api/dashboard/...`) without manual prefix concatenation.
3. **Responsive Split Layouts**: Optimized for side-by-side document review, interactive highlight panels, and dense regulatory data grids.

---

## 2. Directory Structure

```
frontend/
├── app/
│   ├── components/             # Reusable UI widgets (Header, Sidebar, RequireFeature, Modals)
│   ├── dashboard/              # Primary dashboard & label viewing pages
│   │   └── label/[setId]/      # Label detail view, sections, and sub-views:
│   │       ├── labeling-ae/    # Adverse events view with MedDRA highlighting
│   │       └── pv-profile/     # Pharmacovigilance profile and QC verification
│   ├── device/                 # Medical device search & MAUDE adverse event reports
│   ├── drugtox/                # DrugTox toxicology dashboard & chemical visualizer
│   ├── labelcomp/              # Version and multi-product label comparison UI
│   ├── localquery/             # Complex Boolean criteria query builder
│   ├── management/             # User, feature gate, and Celery task administration
│   ├── platform/               # Tool registry, context resolution, and capability checks
│   ├── search/                 # Decision-routed search results & AI refinement
│   ├── utils/                  # appPaths helpers, token storage, API client
│   ├── webtest/                # Automated regression test management UI
│   ├── FetchPrefix.tsx         # Global fetch & DOM prefix patcher
│   ├── layout.tsx              # Root HTML shell & global providers
│   └── page.tsx                # Application landing dashboard
├── public/                     # Static assets, logos, and legacy vanilla JS libraries
├── next.config.ts              # Next.js build config, base paths, and API rewrites
└── tailwind.config.js          # Tailwind styling definitions
```

---

## 3. The Central Tool Registry (`platform/registry.ts`)

Every feature offered by the suite is registered once in `platform/registry.ts`. No navigation bar, card grid, or context menu hardcodes URLs or tool permissions.

```typescript
export interface ToolDef {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  href: (ctx?: ToolContext) => string;
  contexts: ToolContextKind[];
  applies?: (ctx: ToolContext) => boolean;
  requires?: DeploymentRequirement[];
  featureKey?: string;
  accent: AccentColor;
  pattern: BackgroundPattern;
  enabled: boolean;
}
```

### Tool Availability Pipeline (`ToolLauncher.tsx`)
When determining whether a tool is visible or clickable, `isToolAvailable(tool, ctx, session)` evaluates checks in strict order:
1. `tool.enabled`: Global hardcoded kill switch.
2. `tool.featureKey`: Account permission resolved against user session feature gates (`FeatureGate`).
3. `tool.contexts`: Whether the current page context matches (`global`, `label`, `project`, `compare`).
4. `tool.applies(ctx)`: Dynamic runtime applicability (e.g. the FDA Application Profile only appears if `application_number` exists).
5. `tool.requires`: Deployment requirements (e.g. whether Oracle connectivity or local database is configured).

---

## 4. Path-Prefix Cooperation Model

To support deployment under subpaths (e.g. `/fdalabel-v3` with API on `/fdalabel-v3_api`), three systems cooperate:

```
+------------------------+      Configures `basePath` from NEXT_PUBLIC_APP_BASE.
|   next.config.ts       | ──►  Rewrites /api/:path* and /fdalabel-v3_api/api/:path*
+------------------------+      to the Flask origin (basePath: false).
           │
           ▼
+------------------------+      Exports APP_BASE, API_BASE, DASHBOARD_BASE.
|   app/utils/appPaths   | ──►  Provides withAppBase() and withApiBase()
+------------------------+      guards against double-prefixing.
           │
           ▼
+------------------------+      Globally mounted component in layout.tsx.
|   FetchPrefix.tsx      | ──►  Monkey-patches window.fetch and window.open.
+------------------------+      Runs MutationObserver to rewrite DOM <a href>, <img>.
```

### Consequence for Developers:
Write plain paths in component code:
```typescript
// Correct
fetch('/api/dashboard/label/123');

// Incorrect (causes double prefixing: /fdalabel-v3_api/fdalabel-v3_api/...)
fetch(withApiBase('/api/dashboard/label/123'));
```

---

## 5. Feature Gating on the Frontend

Protected pages and components wrap their content in `<RequireFeature feature="key">`.
- It inspects `session.permissions[feature]`.
- If permission is denied, it renders `AccessRestricted.tsx` with clear rationale and role requirements rather than allowing navigation to proceed to an HTTP 403 error.
- Feature gates are refreshed on every login and session validation.
