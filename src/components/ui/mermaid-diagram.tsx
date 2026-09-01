import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MERMAID_MAX_TEXT_SIZE = 50_000;

type DiagramState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; svg: Element }
  | { key: string; status: "error" };

let renderQueue = Promise.resolve();
const pendingRenders = new Map<string, Promise<Element>>();

function renderDiagram(source: string, id: string, theme: "light" | "dark") {
  const key = `${id}\u0000${theme}\u0000${source}`;
  const pending = pendingRenders.get(key);
  if (pending) return pending;

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
    const parsed = new DOMParser().parseFromString(rendered.svg, "image/svg+xml");
    const svg = parsed.documentElement;
    if (svg.localName !== "svg" || parsed.querySelector("parsererror")) {
      throw new Error("Invalid Mermaid SVG");
    }
    return svg;
  });

  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  pendingRenders.set(key, result);
  void result.then(
    () => {
      if (pendingRenders.get(key) === result) pendingRenders.delete(key);
    },
    () => {
      if (pendingRenders.get(key) === result) pendingRenders.delete(key);
    },
  );
  return result;
}

export const MermaidDiagram = memo(function MermaidDiagram({ source }: { source: string }) {
  const { theme } = useTheme();
  const reactId = useId();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const loadingHeight = useRef(0);
  const heightFrame = useRef<number | null>(null);
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const descriptionId = `${renderId}-source`;
  const renderKey = `${renderId}\u0000${theme}\u0000${source}`;
  const [state, setState] = useState<DiagramState>({
    key: renderKey,
    status: "loading",
  });
  // The last diagram that finished rendering. A theme toggle keeps it on
  // screen (recoloring mermaid means a full re-render) instead of flashing the
  // skeleton, so switching theme with many diagrams open stays instant.
  const hasRendered = useRef(false);
  const activeState: DiagramState =
    state.status === "ready"
      ? state
      : state.key === renderKey
        ? state
        : { key: renderKey, status: "loading" };

  useEffect(() => {
    let current = true;
    // Only show the skeleton before the first successful render; a re-render
    // for a new theme (or edited source) keeps the previous diagram visible.
    if (!hasRendered.current) {
      setState({ key: renderKey, status: "loading" });
    }
    const run = () =>
      renderDiagram(source, renderId, theme).then(
        (svg) => {
          if (!current) return;
          hasRendered.current = true;
          setState({ key: renderKey, status: "ready", svg });
        },
        () => {
          // Keep the last good diagram on a re-render failure; only surface the
          // error state when nothing has ever rendered.
          if (current && !hasRendered.current) {
            setState({ key: renderKey, status: "error" });
          }
        },
      );
    // Defer a re-render (theme/source change with a diagram already up) to idle
    // time so the theme flip paints immediately; the first render runs now.
    let idle: number | undefined;
    if (hasRendered.current && typeof requestIdleCallback === "function") {
      idle = requestIdleCallback(() => {
        void run();
      });
    } else {
      void run();
    }
    return () => {
      current = false;
      if (idle !== undefined && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idle);
      }
    };
  }, [renderId, renderKey, source, theme]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const host = hostRef.current;
    if (!shell) return;
    if (activeState.status === "loading") {
      loadingHeight.current = shell.getBoundingClientRect().height;
      return;
    }
    if (activeState.status !== "ready" || !host) return;
    host.replaceChildren(document.importNode(activeState.svg, true));
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
  }, [activeState]);

  return (
    <div
      ref={shellRef}
      aria-busy={activeState.status === "loading"}
      data-mermaid-diagram="true"
      data-state={activeState.status}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget
          && event.propertyName === "height"
          && activeState.status === "ready"
        ) {
          event.currentTarget.style.height = "";
        }
      }}
      className={cn(
        "relative grid min-w-0 overflow-hidden rounded-md bg-background/70 transition-[height] duration-200 motion-reduce:transition-none",
        activeState.status === "loading" && "min-h-28",
        activeState.status === "error" && "border border-destructive/30",
      )}
    >
      {activeState.status === "error" ? (
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
          {activeState.status === "loading" ? (
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
          {activeState.status === "ready" ? (
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
