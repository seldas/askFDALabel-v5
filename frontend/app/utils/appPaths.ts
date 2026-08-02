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
  if (normalizedPath.startsWith(base)) {
    return normalizedPath;
  }

  return `${base}${normalizedPath}`;
};

export const APP_BASE = normalizeBasePath(process.env.NEXT_PUBLIC_APP_BASE, "/askfdalabel");
export const API_BASE = normalizeBasePath(process.env.NEXT_PUBLIC_API_BASE, "/askfdalabel_api");
export const DASHBOARD_BASE = normalizeBasePath(
  process.env.NEXT_PUBLIC_DASHBOARD_BASE ?? APP_BASE,
  APP_BASE,
);

export const withAppBase = (path: string) => appendBase(path, APP_BASE);
export const withDashboardBase = (path: string) => appendBase(path, DASHBOARD_BASE);
export const withApiBase = (path: string) => appendBase(path, API_BASE);
