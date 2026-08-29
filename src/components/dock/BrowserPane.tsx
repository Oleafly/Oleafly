import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Globe2, Lock, TriangleAlert } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { registerCuaSurface } from "@/lib/cua-sandbox";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function normalize(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

let webviewSeq = 0;
const nextWebviewLabel = () => `oleafly-browser-pane-${++webviewSeq}`;

const NATIVE_CREATE_TIMEOUT_MS = 4_000;

export function BrowserPane({ visible = true }: { visible?: boolean }) {
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<Webview | null>(null);
  const visibleRef = useRef(visible);
  const urlRef = useRef(url);
  visibleRef.current = visible;
  urlRef.current = url;

  const syncBounds = useCallback(async () => {
    const pane = webviewRef.current;
    const host = placeholderRef.current;
    if (!pane || !host || !visibleRef.current) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    try {
      await pane.setPosition(new LogicalPosition(rect.left, rect.top));
      await pane.setSize(new LogicalSize(rect.width, rect.height));
    } catch {}
  }, []);

  useEffect(() => {
    if (!isTauri() || !url) return;
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
      closeOwnedPromise ??= pane.close().catch(() => {});
      return closeOwnedPromise;
    };
    const run = async () => {
      try {
        const previous = webviewRef.current;
        webviewRef.current = null;
        await previous?.close();
      } catch {}
      if (cancelled) return;
      webviewRef.current = null;
      setNativeError(null);
      setNativeFailed(false);
      const host = placeholderRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      let created = false;
      try {
        const pane = new Webview(getCurrentWindow(), nextWebviewLabel(), {
          url,
          x: rect.left,
          y: rect.top,
          width: Math.max(rect.width, 80),
          height: Math.max(rect.height, 80),
        });
        ownedPane = pane;
        if (cancelled) {
          await closeOwnedPane();
          return;
        }
        webviewRef.current = pane;
        trackUnlisten(pane.once("tauri://created", () => {
          if (cancelled) return;
          created = true;
          if (watchdog) clearTimeout(watchdog);
          if (visibleRef.current) {
            void pane
              .show()
              .then(() => {
                if (!cancelled && webviewRef.current === pane) return syncBounds();
              })
              .catch(() => {});
          } else {
            void pane.hide().catch(() => {});
          }
        }));
        trackUnlisten(pane.once("tauri://error", (event) => {
          if (cancelled) return;
          if (watchdog) clearTimeout(watchdog);
          setNativeError(String((event.payload as { message?: string })?.message ?? event.payload ?? "unknown error"));
          setNativeFailed(true);
          disposeTracking();
          void closeOwnedPane();
        }));
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
        observer = new ResizeObserver(() => void syncBounds());
        observer.observe(host);
        const win = getCurrentWindow();
        trackUnlisten(win.onMoved(() => void syncBounds()));
        trackUnlisten(win.onResized(() => void syncBounds()));
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
  }, [url, syncBounds]);

  useEffect(() => {
    registerCuaSurface({
      get document(): Document {
        throw new Error("The native browser page is not scriptable from the app.");
      },
      url: () => urlRef.current ?? "",
      navigate: (next: string) => {
        const normalized = normalize(next);
        if (!normalized) return;
        setDraft(normalized);
        setUrl(normalized);
      },
    });
    return () => registerCuaSurface(null);
  }, []);

  useEffect(() => {
    const pane = webviewRef.current;
    if (!pane) return;
    if (visible) {
      void pane
        .show()
        .then(() => syncBounds())
        .catch(() => {});
    } else {
      void pane.hide().catch(() => {});
    }
  }, [visible, syncBounds]);

  const go = () => {
    const next = normalize(draft);
    if (next) {
      setDraft(next);
      setUrl(next);
    }
  };

  const useIframe = !isTauri() || nativeFailed;

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
          <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
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
        useIframe ? (
          <>
            {isTauri() && (
              <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
                The embedded browser is unavailable, so pages render in-app where sites allow
                it. Sites that refuse embedding only open externally.
              </p>
            )}
            <iframe
              title="Dock browser"
              src={url}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              className="h-full w-full flex-1 bg-white"
            />
          </>
        ) : (
          <div
            ref={placeholderRef}
            className="h-full w-full flex-1 bg-white"
            data-testid="dock-browser-native-host"
          />
        )
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          Open a paper, docs page, or venue site in the dock. Use the arrow to open it in your
          regular browser.
        </p>
      )}
    </div>
  );
}
