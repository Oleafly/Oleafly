import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export function MarkdownBlock({
  children,
  kind,
  source,
}: {
  children: ReactNode;
  kind: "code" | "diagram";
  source: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  const copyLabel = kind === "code" ? "Copy code" : "Copy diagram source";
  const copiedLabel = kind === "code" ? "Code copied" : "Diagram source copied";

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  return (
    <div className="group/markdown-block relative mb-2 min-w-0">
      {children}
      <button
        type="button"
        aria-label={copied ? copiedLabel : copyLabel}
        title={copied ? copiedLabel : copyLabel}
        onClick={() => {
          void navigator.clipboard.writeText(source).then(
            () => {
              setCopied(true);
              if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
              resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
        className="absolute right-1.5 top-1.5 z-10 rounded-md border border-border/60 bg-background/90 p-1.5 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-colors transition-opacity after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/markdown-block:opacity-100 group-hover/markdown-block:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-500" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}
