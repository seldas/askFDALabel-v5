const normalizeBasePath = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/$/, "");
};

const appendBase = (path: string, base: string) => {
  if (!base || base === "/") {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath === base || normalizedPath.startsWith(`${base}/`)) {
    return normalizedPath;
  }

  return `${base}${normalizedPath}`;
};

export const APP_BASE = normalizeBasePath(
  process.env.NEXT_PUBLIC_APP_BASE || process.env.NEXT_PUBLIC_DASHBOARD_BASE,
  "/fdalabel-v3"
);
export const API_BASE = normalizeBasePath(process.env.NEXT_PUBLIC_API_BASE, "/fdalabel-v3_api");
export const DASHBOARD_BASE = normalizeBasePath(
  process.env.NEXT_PUBLIC_DASHBOARD_BASE ?? APP_BASE,
  APP_BASE,
);

export const withAppBase = (path: string) => appendBase(path, APP_BASE);
export const withDashboardBase = (path: string) => appendBase(path, DASHBOARD_BASE);
export const withApiBase = (path: string) => appendBase(path, API_BASE);
