"use client";

import { useEffect } from "react";

import { API_BASE, DASHBOARD_BASE, withAppBase } from "./utils/appPaths";

const DASHBOARD_PREFIXES = [
  "/dashboard",
  "/labelcomp",
  "/drugtox",
  "/localquery",
  "/search",
  "/webtest",
  "/device",
];

const normalizeRoute = (value: string) => value.replace(/\/{2,}/g, "/");
const shouldUseDashboardBase = (value: string) =>
  DASHBOARD_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`),
  );

const prefixString = (value: string) => {
  if (!value.startsWith("/")) return value;

  const normalized = normalizeRoute(value);
  if (normalized.startsWith(API_BASE) || normalized.startsWith(DASHBOARD_BASE)) {
    return normalized;
  }

  if (shouldUseDashboardBase(normalized)) {
    return `${DASHBOARD_BASE}${normalized}`;
  }

  if (normalized.startsWith("/api")) {
    return `${API_BASE}${normalized}`;
  }

  return normalized;
};

const shouldHandleHref = (href: string) => {
  return href.startsWith("/") && !href.startsWith("//");
};

const rewriteAnchorHref = (href: string) => {
  if (
    href.startsWith("http://")
    || href.startsWith("https://")
    || href.startsWith("mailto:")
    || href.startsWith("tel:")
  ) {
    return href;
  }

  return prefixString(href);
};

const rewriteAnchors = () => {
  if (!document.body) return;

  document.body
    .querySelectorAll<HTMLAnchorElement>("a[href]")
    .forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href || !shouldHandleHref(href)) return;
      const rewritten = rewriteAnchorHref(href);
      if (rewritten !== href) {
        anchor.setAttribute("href", rewritten);
      }
    });
};

const shouldRewriteAsset = (value: string) => {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  return !value.startsWith("http://") && !value.startsWith("https://") && !value.startsWith("mailto:") && !value.startsWith("tel:");
};

const rewriteAssetValue = (value: string) => {
  if (!shouldRewriteAsset(value)) return value;
  return withAppBase(value);
};

const rewriteSrcSet = (value: string) =>
  value
    .split(",")
    .map((segment) => {
      const trimmed = segment.trim();
      if (!trimmed) return "";
      const tokens = trimmed.split(/\s+/);
      const rewritten = rewriteAssetValue(tokens[0]);
      return [rewritten, ...tokens.slice(1)].join(" ").trim();
    })
    .filter(Boolean)
    .join(", ");

const rewriteMediaSources = () => {
  if (!document.body) return;
  const selector = "img, video, audio, source";
  document.body.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement>(selector).forEach((element) => {
    if (element.hasAttribute("src")) {
      const src = element.getAttribute("src") || "";
      const rewritten = rewriteAssetValue(src);
      if (rewritten !== src) {
        element.setAttribute("src", rewritten);
      }
    }

    if (element.hasAttribute("srcset")) {
      const srcset = element.getAttribute("srcset") || "";
      const rewritten = rewriteSrcSet(srcset);
      if (rewritten !== srcset) {
        element.setAttribute("srcset", rewritten);
      }
    }

    if (element instanceof HTMLImageElement && element.hasAttribute("data-src")) {
      const dataSrc = element.getAttribute("data-src") || "";
      const rewritten = rewriteAssetValue(dataSrc);
      if (rewritten !== dataSrc) {
        element.setAttribute("data-src", rewritten);
      }
    }
  });
};

const rewriteInput = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return prefixString(input);
  }

  const url = input instanceof URL ? input : new URL(input.url, window.location.origin);
  if (url.origin !== window.location.origin) {
    return input;
  }

  const relative = `${url.pathname}${url.search}${url.hash}`;
  const rewritten = prefixString(relative);
  if (input instanceof URL) {
    return rewritten === relative ? input : new URL(`${window.location.origin}${rewritten}`);
  }

  if (rewritten === relative) {
    return input;
  }

  return new Request(rewritten, input as RequestInit);
};

const FetchPrefix = () => {
  useEffect(() => {
    const originalFetch = window.fetch;
    const overrideFetch: typeof window.fetch = (input, init) => {
      const rewritten = rewriteInput(input);
      return originalFetch(rewritten, init);
    };
    window.fetch = overrideFetch;

    const refresh = () => {
      rewriteAnchors();
      rewriteMediaSources();
    };

    refresh();
    const observer =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(refresh)
        : null;
    if (observer && document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    const originalOpen = window.open;
    if (originalOpen) {
      const overrideOpen: typeof window.open = (url, target, features) => {
        const rewritten =
          typeof url === "string" && shouldHandleHref(url)
            ? rewriteAnchorHref(url)
            : url;
        return originalOpen.call(window, rewritten as Parameters<typeof window.open>[0], target, features);
      };
      window.open = overrideOpen;
    }

    return () => {
      window.fetch = originalFetch;
      if (observer) {
        observer.disconnect();
      }
      if (originalOpen) {
        window.open = originalOpen;
      }
    };
  }, []);

  return null;
};

export default FetchPrefix;
