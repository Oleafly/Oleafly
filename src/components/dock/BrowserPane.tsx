import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, Lock, SquareArrowOutUpRight, TriangleAlert } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { registerCuaSurface } from "@/lib/cua-sandbox";
import {
  closeBrowserWindow,
  focusBrowserWindow,
  openBrowserWindow,
} from "@/lib/browser-window";
import {
  BROWSER_SEARCH_ENGINES,
  useSettingsStore,
  type BrowserSearchEngineId,
} from "@/store/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      return new URL(trimmed).toString();
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

// The browser opens in its own window (see lib/browser-window); this dock is a
// launcher and address bar, not an embedded view. The AI drives it through the
// same registered CUA surface, whose navigate opens the window.
export function BrowserPane({ visible = true }: { visible?: boolean }) {
  const browserSearchEngine = useSettingsStore((s) => s.browserSearchEngine);
  const browserHomePage = useSettingsStore((s) => s.browserHomePage);
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  urlRef.current = url;

  const openUrl = useCallback((next: string) => {
    const normalized = normalizeAddress(next);
    if (!normalized) return;
    setDraft(normalized);
    setUrl(normalized);
    urlRef.current = normalized;
    void openBrowserWindow(normalized);
  }, []);

  // Register the CUA surface so the AI's computer_use tool can navigate the
  // browser window. Remote pages are cross-origin, so the surface stays
  // navigate-and-observe-URL only (no scripting), as before.
  useEffect(() => {
    registerCuaSurface({
      get document(): Document {
        throw new Error("The browser window is a separate OS window and is not scriptable.");
      },
      url: () => urlRef.current ?? "",
      navigate: openUrl,
    });
    return () => registerCuaSurface(null);
  }, [openUrl]);

  // Prefill the address bar with the configured home page; opening is explicit
  // (a window only pops when the user or the AI navigates).
  useEffect(() => {
    if (browserHomePage && !draft) setDraft(browserHomePage);
  }, [browserHomePage, draft]);

  // Closing the dock closes the window it launched.
  useEffect(() => {
    if (!visible) void closeBrowserWindow();
  }, [visible]);

  const go = () => {
    const next = resolveNavigation(draft, browserSearchEngine);
    if (next) openUrl(next);
  };

  return (
    <div className="flex h-full flex-col" data-testid="dock-browser" aria-hidden={!visible}>
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
          data-testid="dock-browser-address"
          aria-label="Browser address"
          value={draft}
          placeholder="Search or paste a link"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") go();
          }}
          className="h-7 flex-1 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          data-testid="dock-browser-open"
          onClick={go}
        >
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
      {url ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <SquareArrowOutUpRight className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-xs text-muted-foreground">
            Showing this page in a separate browser window.
          </p>
          <p
            className="max-w-full truncate text-[11px] font-medium text-foreground"
            data-testid="dock-browser-current"
            title={url}
          >
            {url}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-testid="dock-browser-focus"
            onClick={() => void focusBrowserWindow()}
          >
            Focus window
          </Button>
        </div>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          Type a link or search and press Open to browse in a separate window.
        </p>
      )}
    </div>
  );
}
