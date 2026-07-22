import { useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

const SAMPLE = "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}";

export function EquationPreviewPanel() {
  const [input, setInput] = useState(SAMPLE);
  const [display, setDisplay] = useState(true);

  const rendered = useMemo(() => {
    if (!input.trim()) return { html: "", error: null as string | null };
    try {
      return {
        html: katex.renderToString(input, { displayMode: display, throwOnError: true }),
        error: null,
      };
    } catch (e) {
      return { html: "", error: String(e instanceof Error ? e.message : e) };
    }
  }, [input, display]);

  const wrapped = display ? `\\[ ${input} \\]` : `$${input}$`;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r">
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>LaTeX math</span>
          <span>{display ? "display mode" : "inline mode"}</span>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs focus-visible:ring-0"
        />
        <div className="flex items-center gap-2 border-t px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setDisplay((d) => !d)}>
            {display ? "Switch to inline" : "Switch to display"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(wrapped);
              toast.success("Copied LaTeX source");
            }}
          >
            Copy LaTeX
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">Preview</div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          {rendered.error ? (
            <p className="text-sm text-destructive">{rendered.error}</p>
          ) : rendered.html ? (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is trusted local rendering
            <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
          ) : (
            <p className="text-sm text-muted-foreground">Type LaTeX math on the left.</p>
          )}
        </div>
      </div>
    </div>
  );
}
