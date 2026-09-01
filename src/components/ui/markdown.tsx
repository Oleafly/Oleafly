import { lazy, Suspense } from "react";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

let rendererModule: Promise<typeof import("./markdown-renderer")> | null = null;

function loadMarkdownRenderer() {
  if (!rendererModule) rendererModule = import("./markdown-renderer");
  return rendererModule;
}

export function prefetchMarkdownRenderer() {
  if (rendererModule || typeof window === "undefined") return;
  const schedule =
    window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
  schedule(() => {
    void loadMarkdownRenderer();
  });
}

const MarkdownRenderer = lazy(loadMarkdownRenderer);

export function Markdown({
  children,
  className,
  inverted = false,
  streaming = false,
}: {
  children: string;
  className?: string;
  inverted?: boolean;
  streaming?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div className={cn("min-w-0 whitespace-pre-wrap break-words", className)}>
          {children}
        </div>
      }
    >
      <MarkdownRenderer className={className} inverted={inverted} streaming={streaming}>
        {children}
      </MarkdownRenderer>
    </Suspense>
  );
}
