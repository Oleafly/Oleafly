import { lazy, Suspense } from "react";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

const MarkdownRenderer = lazy(() => import("./markdown-renderer"));

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
