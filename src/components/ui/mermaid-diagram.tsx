import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

const MERMAID_MAX_TEXT_SIZE = 50_000;
const codeBlockClassName =
  "mb-2 overflow-x-auto rounded-md bg-background/70 p-2.5 text-[0.85em] [scrollbar-width:thin]";

type DiagramState =
  | { status: "loading" }
  | { status: "ready"; svg: Element }
  | { status: "error" };

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

export function MermaidDiagram({ source }: { source: string }) {
  const { theme } = useTheme();
  const reactId = useId();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<DiagramState>({ status: "loading" });
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const descriptionId = `${renderId}-source`;

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void renderDiagram(source, renderId, theme).then(
      (svg) => {
        if (current) setState({ status: "ready", svg });
      },
      () => {
        if (current) setState({ status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [renderId, source, theme]);

  useLayoutEffect(() => {
    if (state.status !== "ready" || !hostRef.current) return;
    hostRef.current.replaceChildren(document.importNode(state.svg, true));
  }, [state]);

  if (state.status === "ready") {
    return (
      <>
        <div
          ref={hostRef}
          role="img"
          aria-label="Diagram"
          aria-describedby={descriptionId}
          data-mermaid-diagram="true"
          className="mb-2 min-w-0 overflow-x-auto rounded-md bg-background/70 p-2.5 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        />
        <span id={descriptionId} className="sr-only">
          {source}
        </span>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <div
        data-mermaid-diagram="true"
        className="mb-2 min-w-0 overflow-hidden rounded-md border border-destructive/30 bg-background/70"
      >
        <p className="px-2.5 pt-2.5 text-xs text-destructive">Unable to render diagram.</p>
        <pre className="overflow-x-auto p-2.5 text-[0.85em] [scrollbar-width:thin]">
          <code className="font-mono language-mermaid">{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <pre data-mermaid-diagram="true" className={codeBlockClassName}>
      <code className="font-mono language-mermaid">{source}</code>
    </pre>
  );
}
