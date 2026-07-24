import { useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Copy, Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

export const EQUATION_EXAMPLES: { label: string; latex: string }[] = [
  { label: "Quadratic", latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  { label: "Euler", latex: "e^{i\\pi} + 1 = 0" },
  { label: "Integral", latex: "\\int_{a}^{b} f(x)\\,dx" },
];

export interface EquationRendered {
  html: string;
  error: string | null;
}

export function renderEquation(input: string, display: boolean): EquationRendered {
  if (!input.trim()) return { html: "", error: null };
  try {
    return {
      html: katex.renderToString(input, { displayMode: display, throwOnError: true }),
      error: null,
    };
  } catch (e) {
    return { html: "", error: String(e instanceof Error ? e.message : e) };
  }
}

interface EquationPreviewPanelProps {
  input: string;
  onInputChange: (value: string) => void;
  display: boolean;
  onDisplayChange: (display: boolean) => void;
  rendered: EquationRendered;
  wrapped: string;
  previewTheme: "light" | "dark";
  onPreviewThemeChange: (theme: "light" | "dark") => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  editorTheme: string;
}

const MIN_ZOOM = 25;
const MAX_ZOOM = 400;

export function EquationPreviewPanel({
  input,
  onInputChange,
  display,
  onDisplayChange,
  rendered,
  wrapped,
  previewTheme,
  onPreviewThemeChange,
  zoom,
  onZoomChange,
  editorTheme,
}: EquationPreviewPanelProps) {
  const previewCardRef = useRef<HTMLDivElement>(null);
  const lines = input.split("\n");

  const copyWrapped = () => {
    void navigator.clipboard.writeText(wrapped);
    toast.success("Copied LaTeX source");
  };

  const toggleFullscreen = () => {
    const card = previewCardRef.current;
    if (!card) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void card.requestFullscreen();
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground">LATEX</span>
          <div className="flex h-7 items-center rounded-full bg-muted p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => onDisplayChange(false)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                !display ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Inline
            </button>
            <button
              type="button"
              onClick={() => onDisplayChange(true)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                display ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Display
            </button>
          </div>
        </div>

        <div
          data-editor-theme={editorTheme}
          className="flex min-h-0 flex-1 overflow-auto"
          style={{
            backgroundColor: "var(--cm-editor-bg, var(--background))",
            color: "var(--cm-editor-fg, var(--foreground))",
          }}
        >
          <div
            className="select-none border-r px-3 py-4 text-right font-mono text-xs"
            style={{ color: "var(--cm-gutter-fg, var(--muted-foreground))" }}
          >
            {lines.map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: line numbers are positionally stable within a render
              <div key={i} className="leading-6">
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            spellCheck={false}
            className="min-h-full flex-1 resize-none border-0 bg-transparent px-3 py-4 font-mono text-sm leading-6 outline-none"
            style={{ color: "var(--cm-editor-fg, var(--foreground))", caretColor: "var(--cm-cursor, var(--primary))" }}
          />
        </div>

        <div className="border-t px-4 py-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
            EXAMPLES
          </div>
          <div className="flex flex-wrap gap-2">
            {EQUATION_EXAMPLES.map((ex) => (
              <Button
                key={ex.label}
                variant="outline"
                size="sm"
                onClick={() => onInputChange(ex.latex)}
              >
                {ex.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">
              PREVIEW
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {display ? "Display" : "Inline"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Preview on dark"
              onClick={() => onPreviewThemeChange("dark")}
              className={cn(
                "size-5 rounded-full border bg-[#111111] transition-shadow",
                previewTheme === "dark" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            />
            <button
              type="button"
              aria-label="Preview on light"
              onClick={() => onPreviewThemeChange("light")}
              className={cn(
                "size-5 rounded-full border bg-white transition-shadow",
                previewTheme === "light" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            />
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <div
            ref={previewCardRef}
            className={cn(
              "relative flex h-full w-full items-center justify-center overflow-auto rounded-xl p-10",
              previewTheme === "dark" ? "bg-[#111111] text-white" : "bg-white text-black",
            )}
          >
            {rendered.html && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "absolute right-3 top-3",
                  previewTheme === "dark"
                    ? "border-white/15 bg-white/10 text-white hover:bg-white/20"
                    : "border-black/10 bg-black/5 text-black hover:bg-black/10",
                )}
                onClick={copyWrapped}
              >
                <Copy className="size-3.5" /> Copy
              </Button>
            )}
            <div
              style={{ transform: `scale(${zoom / 100})` }}
              className="transition-transform"
            >
              {rendered.error ? (
                <p className="max-w-sm text-sm text-destructive">{rendered.error}</p>
              ) : rendered.html ? (
                display ? (
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is trusted local rendering
                  <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
                ) : (
                  <p className="max-w-md text-base leading-relaxed">
                    This is how it sits inline within a sentence, like{" "}
                    {/* biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is trusted local rendering */}
                    <span dangerouslySetInnerHTML={{ __html: rendered.html }} />, flowing with the
                    surrounding text.
                  </p>
                )
              ) : (
                <p className="text-sm opacity-60">Type LaTeX math on the left.</p>
              )}
            </div>
          </div>

          <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border bg-card px-2 py-1 shadow-lg">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onZoomChange(Math.max(MIN_ZOOM, zoom - 25))}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="min-w-11 px-1 text-center text-xs text-muted-foreground"
            >
              {zoom}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onZoomChange(Math.min(MAX_ZOOM, zoom + 25))}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onZoomChange(100)}
              aria-label="Reset zoom"
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggleFullscreen}
              aria-label="Fullscreen preview"
            >
              <Maximize className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
