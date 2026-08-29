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

// Each webview gets a fresh label so a slow close from a previous navigation
// can never collide with the next create.
let webviewSeq = 0;
const nextWebviewLabel = () => `oleafly-browser-pane-${++webviewSeq}`;

// How long to wait for the native pane's `tauri://created` handshake before
// giving up and falling back to the in-app iframe.
const NATIVE_CREATE_TIMEOUT_MS = 4_000;

// The research browser. Inside the desktop app the page renders in a native
// child webview, so sites that refuse embedding (X-Frame-Options/CSP
// frame-ancestors — arXiv, Google, most journals) load fine. If the native
// pane fails to come up (or the platform stacks it out of view), we fall
// back to an iframe plus the external-open button rather than a blank box.
export function BrowserPane() {
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<Webview | null>(null);

  const syncBounds = useCallback(async () => {
    const pane = webviewRef.current;
    const host = placeholderRef.current;
    if (!pane || !host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    try {
      await pane.setPosition(new LogicalPosition(rect.left, rect.top));
      await pane.setSize(new LogicalSize(rect.width, rect.height));
    } catch {
      /* the pane may have been closed mid-resize */
    }
  }, []);

  // (Re)create the native pane for the current URL and keep it glued to the
  // placeholder through panel resizes AND window moves (the pane lives in
  // window coordinates, so both displace it).
  useEffect(() => {
    if (!isTauri() || !url) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const unlistens: Array<() => void> = [];
    const run = async () => {
      try {
        await webviewRef.current?.close();
      } catch {
        /* already gone */
      }
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
        webviewRef.current = pane;
        pane.once("tauri://created", () => {
          created = true;
          if (watchdog) clearTimeout(watchdog);
          void syncBounds();
        });
        pane.once("tauri://error", (event) => {
          if (watchdog) clearTimeout(watchdog);
          if (!cancelled) setNativeError(String((event.payload as { message?: string })?.message ?? event.payload ?? "unknown error"));
        });
        watchdog = setTimeout(() => {
          if (created || cancelled) return;
          // Nothing rendered: tear down and let the iframe fallback show.
          const pane = webviewRef.current;
          webviewRef.current = null;
          void pane?.close().catch(() => {});
          setNativeFailed(true);
        }, NATIVE_CREATE_TIMEOUT_MS);
        if (cancelled) {
          await pane.close().catch(() => {});
          return;
        }
        observer = new ResizeObserver(() => void syncBounds());
        observer.observe(host);
        const win = getCurrentWindow();
        unlistens.push(
          await win.onMoved(() => void syncBounds()),
          await win.onResized(() => void syncBounds()),
        );
      } catch (error) {
        setNativeError(String(error));
        setNativeFailed(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      observer?.disconnect();
      for (const unlisten of unlistens) unlisten();
      const pane = webviewRef.current;
      webviewRef.current = null;
      void pane?.close().catch(() => {});
    };
  }, [url, syncBounds]);

  // Register the pane as the CUA sandbox surface. The native page is a
  // separate process, so only navigation control is exposed; the document
  // accessor reports that honestly instead of pretending.
  useEffect(() => {
    registerCuaSurface({
      get document(): Document {
        throw new Error("The native browser page is not scriptable from the app.");
      },
      url: () => url ?? "",
      navigate: (next: string) => setUrl(next),
    });
    return () => registerCuaSurface(null);
  }, [url]);

  const go = () => {
    const next = normalize(draft);
    if (next) {
      // Show the normalized URL the pane actually loaded, like a normal
      // browser address bar.
      setDraft(next);
      setUrl(next);
    }
  };

  const useIframe = !isTauri() || nativeFailed;

  return (
    <div className="flex h-full flex-col" data-testid="harness-browser">
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
        <p className="p-3 text-xs text-danger" data-testid="harness-browser-error">
          The embedded browser could not start ({nativeError}). Use the external-open button.
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
              title="Composer browser"
              src={url}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              className="h-full w-full flex-1 bg-white"
            />
          </>
        ) : (
          <div
            ref={placeholderRef}
            className="h-full w-full flex-1 bg-white"
            data-testid="harness-browser-native-host"
          />
        )
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          Open a paper, a docs page, or a venue site next to your session. Pages
          render in an embedded browser; the arrow opens them in your regular
          browser instead.
        </p>
      )}
    </div>
  );
}
