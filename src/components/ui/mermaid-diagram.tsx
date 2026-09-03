import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { RenderCache } from "./render-cache";

const MERMAID_MAX_TEXT_SIZE = 50_000;
const MAX_CACHED_DIAGRAMS = 64;
const MAX_CACHED_DIAGRAM_CHARS = 6_000_000;
const VISIBILITY_MARGIN = "240px 0px";
const IDLE_FALLBACK_MS = 48;

type DiagramState =
  | { status: "loading" }
  | { status: "ready"; svg: Element; theme: Theme }
  | { status: "error" };

let renderQueue = Promise.resolve();
let renderSequence = 0;
const pendingRenders = new Map<string, Promise<Element>>();
const diagramCache = new RenderCache<Element>(MAX_CACHED_DIAGRAMS, MAX_CACHED_DIAGRAM_CHARS);

const failedDiagrams = new Set<string>();

function cacheKey(source: string, theme: Theme) {
  return `${theme} ${source}`;
}

function hashSource(source: string) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(handle);
}

export function cachedDiagram(source: string, theme: Theme): Element | undefined {
  return diagramCache.get(cacheKey(source, theme));
}

export function clearDiagramCache(): void {
  failedDiagrams.clear();
  diagramCache.clear();
}

export function renderDiagram(source: string, theme: Theme): Promise<Element> {
  const key = cacheKey(source, theme);
  const cached = diagramCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = pendingRenders.get(key);
  if (pending) return pending;

  const id = `mermaid-${hashSource(source)}-${(++renderSequence).toString(36)}`;
  const result = renderQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      maxTextSize: MERMAID_MAX_TEXT_SIZE,
      securityLevel: "strict",
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: theme === "dark" ? "dark" : "default",
    });
    const rendered = await mermaid.render(id, source);
    const parsed = new DOMParser().parseFromString(rendered.svg, "text/html");
    const svg = parsed.body.firstElementChild;
    if (
      svg?.localName !== "svg" ||
      svg.namespaceURI !== "http://www.w3.org/2000/svg" ||
      parsed.body.childElementCount !== 1
    ) {
      throw new Error("Invalid Mermaid SVG");
    }
    diagramCache.set(key, svg, rendered.svg.length);
    return svg;
  });

  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  pendingRenders.set(key, result);
  const settle = () => {
    if (pendingRenders.get(key) === result) pendingRenders.delete(key);
  };
  void result.then(settle, settle);
  return result;
}

function initialDiagramState(source: string): DiagramState {
  const theme = currentTheme();
  const svg = cachedDiagram(source, theme);
  return svg ? { status: "ready", svg, theme } : { status: "loading" };
}

export const MermaidDiagram = memo(function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const descriptionId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-source`;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const loadingHeight = useRef(0);
  const heightFrame = useRef<number | null>(null);
  const [state, setState] = useState<DiagramState>(() => initialDiagramState(source));
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedTheme = useRef<Theme | null>(state.status === "ready" ? state.theme : null);
  const visible = useRef(false);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const host = hostRef.current;
    if (!shell) return;
    if (state.status === "loading") {
      loadingHeight.current = shell.getBoundingClientRect().height;
      return;
    }
    if (state.status !== "ready" || !host) return;
    host.replaceChildren(document.importNode(state.svg, true));
    const from = loadingHeight.current;
    const to = host.scrollHeight;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || from <= 0 || to <= 0 || Math.abs(from - to) < 1) return;
    shell.style.height = `${from}px`;
    heightFrame.current = window.requestAnimationFrame(() => {
      shell.style.height = `${to}px`;
      heightFrame.current = null;
    });
    return () => {
      if (heightFrame.current !== null) window.cancelAnimationFrame(heightFrame.current);
      heightFrame.current = null;
    };
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    let cancelIdle: (() => void) | null = null;
    let inFlight: string | null = null;

    const adopt = (svg: Element, theme: Theme) => {
      mountedTheme.current = theme;
      if (stateRef.current.status === "ready") {
        hostRef.current?.replaceChildren(document.importNode(svg, true));
        return;
      }
      setState({ status: "ready", svg, theme });
    };

    const ensureCurrent = (deferred: boolean) => {
      if (cancelled || !visible.current) return;
      const theme = currentTheme();
      if (mountedTheme.current === theme) return;
      const cached = cachedDiagram(source, theme);
      if (cached) {
        adopt(cached, theme);
        return;
      }
      const key = cacheKey(source, theme);
      if (failedDiagrams.has(key)) {
        if (mountedTheme.current === null) setState({ status: "error" });
        return;
      }
      if (inFlight === key) return;
      const run = () => {
        cancelIdle = null;
        if (cancelled || !visible.current || currentTheme() !== theme) return;
        inFlight = key;
        renderDiagram(source, theme).then(
          (svg) => {
            if (cancelled) return;
            inFlight = null;
            if (currentTheme() !== theme) {
              ensureCurrent(true);
              return;
            }
            adopt(svg, theme);
          },
          () => {
            failedDiagrams.add(key);
            if (cancelled) return;
            inFlight = null;
            if (mountedTheme.current === null) setState({ status: "error" });
          },
        );
      };
      cancelIdle?.();
      if (deferred) cancelIdle = scheduleIdle(run);
      else run();
    };

    const shell = shellRef.current;
    let observer: IntersectionObserver | null = null;
    if (shell && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          visible.current = entry.isIntersecting;
          if (entry.isIntersecting) ensureCurrent(mountedTheme.current !== null);
        },
        { rootMargin: VISIBILITY_MARGIN },
      );
      observer.observe(shell);
    } else {
      visible.current = true;
      ensureCurrent(false);
    }
    const unsubscribe = subscribeTheme(() => {
      if (visible.current) ensureCurrent(true);
    });

    return () => {
      cancelled = true;
      cancelIdle?.();
      observer?.disconnect();
      unsubscribe();
    };
  }, [source]);

  return (
    <div
      ref={shellRef}
      aria-busy={state.status === "loading"}
      data-mermaid-diagram="true"
      data-state={state.status}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget
          && event.propertyName === "height"
          && state.status === "ready"
        ) {
          event.currentTarget.style.height = "";
        }
      }}
      className={cn(
        "relative grid min-w-0 overflow-hidden rounded-md bg-background/70 transition-[height] duration-200 motion-reduce:transition-none",
        state.status === "loading" && "min-h-28",
        state.status === "error" && "border border-destructive/30",
      )}
    >
      {state.status === "error" ? (
        <div>
          <p
            role="status"
            aria-live="polite"
            aria-label="Unable to render diagram."
            className="px-2.5 pt-2.5 text-xs text-destructive"
          >
            Unable to render diagram.
          </p>
          <pre className="overflow-x-auto p-2.5 text-[0.85em] [scrollbar-width:thin]">
            <code className="font-mono language-mermaid">{source}</code>
          </pre>
        </div>
      ) : (
        <>
          {state.status === "loading" ? (
            <div
              role="status"
              aria-label="Rendering diagram"
              className="col-start-1 row-start-1 flex min-h-28 animate-pulse flex-col justify-center gap-3 p-5 opacity-100 transition-opacity duration-200 motion-reduce:animate-none motion-reduce:transition-none"
            >
              <span className="mx-auto h-2 w-2/5 rounded-full bg-muted-foreground/20" />
              <span className="mx-auto h-9 w-3/5 rounded-md bg-muted-foreground/15" />
              <span className="mx-auto h-2 w-1/3 rounded-full bg-muted-foreground/20" />
            </div>
          ) : (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex flex-col justify-center gap-3 p-5 opacity-0 transition-opacity duration-200 motion-reduce:transition-none"
            >
              <span className="mx-auto h-2 w-2/5 rounded-full bg-muted-foreground/20" />
              <span className="mx-auto h-9 w-3/5 rounded-md bg-muted-foreground/15" />
              <span className="mx-auto h-2 w-1/3 rounded-full bg-muted-foreground/20" />
            </div>
          )}
          {state.status === "ready" ? (
            <div
              ref={hostRef}
              role="img"
              aria-label="Diagram"
              aria-describedby={descriptionId}
              className="col-start-1 row-start-1 min-w-0 overflow-x-auto p-2.5 opacity-100 transition-opacity duration-200 motion-reduce:transition-none [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            />
          ) : (
            <div
              ref={hostRef}
              aria-hidden="true"
              className="col-start-1 row-start-1 min-w-0 overflow-x-auto p-2.5 opacity-0 transition-opacity duration-200 motion-reduce:transition-none [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            />
          )}
          <span id={descriptionId} className="sr-only">
            {source}
          </span>
        </>
      )}
    </div>
  );
});
