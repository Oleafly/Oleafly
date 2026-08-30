import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Globe, Loader2, Lock, TriangleAlert } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { registerCuaSurface } from "@/lib/cua-sandbox";
import { useNativeWebviewOccluded } from "@/lib/native-webview-occlusion";
import {
  BROWSER_SEARCH_ENGINES,
  useSettingsStore,
  type BrowserSearchEngineId,
} from "@/store/settings";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BrowserPageLoadPayload = {
  label: string;
  state: "started" | "finished";
  url: string;
};

function isDomainUrl(url: URL, raw: string): boolean {
  if (/\s|@/u.test(raw)) return false;
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  return (
    hostname === "localhost" ||
    hostname.includes(".") ||
    hostname.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function normalizeAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//iu.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.toString();
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(`https://${trimmed}`);
    if (isDomainUrl(url, trimmed)) return url.toString();
  } catch {}
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {}
  return null;
}

function resolveNavigation(
  raw: string,
  searchEngine: BrowserSearchEngineId,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const address = normalizeAddress(trimmed);
  if (address) return address;
  if (/^[a-z][a-z\d+.-]*:/iu.test(trimmed)) return null;
  const engine =
    BROWSER_SEARCH_ENGINES.find(({ id }) => id === searchEngine) ??
    BROWSER_SEARCH_ENGINES[0];
  return `${engine.searchUrl}${encodeURIComponent(trimmed)}`;
}

let webviewSeq = 0;
const nextWebviewLabel = () => `oleafly-browser-pane-${++webviewSeq}`;

const NATIVE_CREATE_TIMEOUT_MS = 4_000;

export function BrowserPane({ visible = true }: { visible?: boolean }) {
  const browserSearchEngine = useSettingsStore((state) => state.browserSearchEngine);
  const browserHomePage = useSettingsStore((state) => state.browserHomePage);
  const nativeWebviewOccluded = useNativeWebviewOccluded();
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageLoadListenerState, setPageLoadListenerState] = useState<
    "pending" | "ready" | "failed"
  >(() => (isTauri() ? "pending" : "ready"));
  const [nativeFailed, setNativeFailed] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<Webview | null>(null);
  const webviewLabelRef = useRef<string | null>(null);
  const visibleRef = useRef(visible);
  const loadingRef = useRef(loading);
  const occludedRef = useRef(nativeWebviewOccluded);
  const urlRef = useRef(url);
  const desiredVisibilityRef = useRef(
    visible && !loading && !nativeWebviewOccluded,
  );
  const visibilityRevisionRef = useRef(0);
  const visibilitySyncRunningRef = useRef(false);
  visibleRef.current = visible;
  loadingRef.current = loading;
  occludedRef.current = nativeWebviewOccluded;
  urlRef.current = url;
  desiredVisibilityRef.current = visible && !loading && !nativeWebviewOccluded;

  const setPageLoading = useCallback((next: boolean) => {
    loadingRef.current = next;
    desiredVisibilityRef.current =
      visibleRef.current && !next && !occludedRef.current;
    setLoading(next);
  }, []);

  const syncBounds = useCallback(async (): Promise<boolean> => {
    const pane = webviewRef.current;
    const host = placeholderRef.current;
    if (
      !pane ||
      !host ||
      !visibleRef.current ||
      loadingRef.current ||
      occludedRef.current
    ) {
      return false;
    }
    const rect = host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    try {
      await pane.setPosition(new LogicalPosition(rect.left, rect.top));
      await pane.setSize(new LogicalSize(rect.width, rect.height));
      return true;
    } catch {
      return false;
    }
  }, []);

  const syncNativeVisibility = useCallback(
    (requestedVisibility?: boolean) => {
      desiredVisibilityRef.current =
        requestedVisibility ??
        (visibleRef.current && !loadingRef.current && !occludedRef.current);
      visibilityRevisionRef.current += 1;
      if (visibilitySyncRunningRef.current) return;
      visibilitySyncRunningRef.current = true;
      void (async () => {
        let handledRevision = -1;
        while (handledRevision !== visibilityRevisionRef.current) {
          handledRevision = visibilityRevisionRef.current;
          const pane = webviewRef.current;
          if (!pane) continue;
          try {
            if (!desiredVisibilityRef.current) {
              await pane.hide();
              continue;
            }
            const positioned = await syncBounds();
            if (
              !positioned ||
              pane !== webviewRef.current ||
              !desiredVisibilityRef.current
            ) {
              if (pane === webviewRef.current) await pane.hide();
              continue;
            }
            await pane.show();
            if (
              pane === webviewRef.current &&
              !desiredVisibilityRef.current
            ) {
              await pane.hide();
            }
          } catch {}
        }
        visibilitySyncRunningRef.current = false;
      })();
    },
    [syncBounds],
  );

  const openUrl = useCallback(
    (next: string) => {
      const normalized = normalizeAddress(next);
      if (!normalized) return;
      setDraft(normalized);
      if (urlRef.current === normalized) return;
      urlRef.current = normalized;
      setPageLoading(true);
      setUrl(normalized);
    },
    [setPageLoading],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<BrowserPageLoadPayload>("browser-page-load", (event) => {
      if (event.payload.label !== webviewLabelRef.current) return;
      setPageLoading(event.payload.state === "started");
    })
      .then((stop) => {
        if (cancelled) stop();
        else {
          unlisten = stop;
          setPageLoadListenerState("ready");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setNativeError(`Page-load monitoring failed: ${String(error)}`);
        setNativeFailed(true);
        setPageLoadListenerState("failed");
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setPageLoading]);

  useEffect(() => {
    if (
      !isTauri() ||
      !url ||
      nativeFailed ||
      pageLoadListenerState !== "ready"
    ) {
      return;
    }
    let cancelled = false;
    let ownedPane: Webview | null = null;
    let closeOwnedPromise: Promise<void> | null = null;
    let observer: ResizeObserver | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let trackingDisposed = false;
    const unlistens = new Set<() => void>();
    const trackUnlisten = (promise: Promise<() => void>) => {
      void promise
        .then((unlisten) => {
          if (cancelled || trackingDisposed) unlisten();
          else unlistens.add(unlisten);
        })
        .catch(() => {});
    };
    const disposeTracking = () => {
      if (trackingDisposed) return;
      trackingDisposed = true;
      observer?.disconnect();
      observer = null;
      for (const unlisten of unlistens) unlisten();
      unlistens.clear();
    };
    const closeOwnedPane = () => {
      const pane = ownedPane;
      if (!pane) return Promise.resolve();
      if (webviewRef.current === pane) webviewRef.current = null;
      if (webviewLabelRef.current === pane.label) webviewLabelRef.current = null;
      closeOwnedPromise ??= pane.close().catch(() => {});
      return closeOwnedPromise;
    };
    const run = async () => {
      try {
        const previous = webviewRef.current;
        webviewRef.current = null;
        webviewLabelRef.current = null;
        await previous?.close();
      } catch {}
      if (cancelled) return;
      webviewRef.current = null;
      const host = placeholderRef.current;
      if (!host) return;
      let created = false;
      try {
        const pane = new Webview(getCurrentWindow(), nextWebviewLabel(), {
          url,
          x: -10_000,
          y: -10_000,
          width: 80,
          height: 80,
        });
        ownedPane = pane;
        if (cancelled) {
          await closeOwnedPane();
          return;
        }
        webviewRef.current = pane;
        webviewLabelRef.current = pane.label;
        trackUnlisten(
          pane.once("tauri://created", () => {
            if (cancelled) return;
            created = true;
            if (watchdog) clearTimeout(watchdog);
            void syncNativeVisibility();
          }),
        );
        trackUnlisten(
          pane.once("tauri://error", (event) => {
            if (cancelled) return;
            if (watchdog) clearTimeout(watchdog);
            setNativeError(
              String(
                (event.payload as { message?: string })?.message ??
                  event.payload ??
                  "unknown error",
              ),
            );
            setNativeFailed(true);
            disposeTracking();
            void closeOwnedPane();
          }),
        );
        watchdog = setTimeout(() => {
          if (created || cancelled) return;
          setNativeFailed(true);
          disposeTracking();
          void closeOwnedPane();
        }, NATIVE_CREATE_TIMEOUT_MS);
        if (cancelled) {
          await closeOwnedPane();
          return;
        }
        observer = new ResizeObserver(() => syncNativeVisibility());
        observer.observe(host);
        const win = getCurrentWindow();
        trackUnlisten(win.onMoved(() => syncNativeVisibility()));
        trackUnlisten(win.onResized(() => syncNativeVisibility()));
      } catch (error) {
        disposeTracking();
        void closeOwnedPane();
        if (cancelled) return;
        setNativeError(String(error));
        setNativeFailed(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      disposeTracking();
      void closeOwnedPane();
    };
  }, [nativeFailed, pageLoadListenerState, url, syncNativeVisibility]);

  useEffect(() => {
    registerCuaSurface({
      get document(): Document {
        throw new Error("The native browser page is not scriptable from the app.");
      },
      url: () => urlRef.current ?? "",
      navigate: openUrl,
    });
    return () => registerCuaSurface(null);
  }, [openUrl]);

  useEffect(() => {
    if (!visible || urlRef.current || !browserHomePage) return;
    openUrl(browserHomePage);
  }, [browserHomePage, openUrl, visible]);

  useLayoutEffect(() => {
    syncNativeVisibility(visible && !loading && !nativeWebviewOccluded);
  }, [loading, nativeWebviewOccluded, syncNativeVisibility, visible]);

  const go = () => {
    const next = resolveNavigation(draft, browserSearchEngine);
    if (!next) return;
    openUrl(next);
  };

  const useIframe =
    !isTauri() || nativeFailed || pageLoadListenerState === "failed";

  return (
    <div
      className="flex h-full flex-col"
      data-testid="dock-browser"
      aria-hidden={!visible}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b p-2">
        {url?.startsWith("https://") ? (
          <Lock
            className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-label="Secure https connection"
          />
        ) : url ? (
          <TriangleAlert
            className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-label="Not secure"
          />
        ) : (
          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Input
          aria-label="Browser address"
          value={draft}
          placeholder="Search or paste a link"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") go();
          }}
          className="h-7 flex-1 text-xs"
        />
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={go}>
          Open
        </Button>
        {url && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            aria-label="Open in system browser"
            onClick={() => void openExternal(url)}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        )}
      </div>
      {nativeError && (
        <p className="p-3 text-xs text-destructive" data-testid="dock-browser-error">
          The embedded browser couldn't start ({nativeError}). Use the arrow to open this page in
          your regular browser.
        </p>
      )}
      {url ? (
        <>
          {useIframe && isTauri() && (
            <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
              The embedded browser is unavailable, so pages render in-app where sites allow it.
              Sites that refuse embedding only open externally.
            </p>
          )}
          <div className="relative min-h-0 flex-1">
            {loading && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center bg-background/80"
                role="status"
              >
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Loading page</span>
              </div>
            )}
            {useIframe ? (
              <iframe
                title="Dock browser"
                src={url}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                className="h-full w-full bg-white"
                onLoad={() => setPageLoading(false)}
                onErrorCapture={() => setPageLoading(false)}
              />
            ) : (
              <div
                ref={placeholderRef}
                className="h-full w-full bg-white"
                data-testid="dock-browser-native-host"
              />
            )}
          </div>
        </>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          Open a paper, docs page, or venue site in the dock. Use the arrow to open it in your
          regular browser.
        </p>
      )}
    </div>
  );
}
