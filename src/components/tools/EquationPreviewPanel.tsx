import { useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import katex from "katex";
import "katex/dist/katex.min.css";
// Chemistry equations (\ce{...}) for the examples below.
import "katex/contrib/mhchem";
import { Copy, Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeField } from "@/components/tools/CodeField";
import { ToolSplitView } from "@/components/tools/ToolWorkspace";
import { latexMathLanguage } from "@/components/editor/cm/latex";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { i18n } from "@/i18n";

export const EQUATION_EXAMPLES: { id: string; label: () => string; latex: string }[] = [
  {
    id: "quadratic",
    label: () => i18n.t(($) => $.researchTools.equation.example.quadratic),
    latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  },
  {
    id: "euler",
    label: () => i18n.t(($) => $.researchTools.equation.example.euler),
    latex: "e^{i\\pi} + 1 = 0",
  },
  {
    id: "integral",
    label: () => i18n.t(($) => $.researchTools.equation.example.integral),
    latex: "\\int_{a}^{b} f(x)\\,dx",
  },
  {
    id: "matrix",
    label: () => i18n.t(($) => $.researchTools.equation.example.matrix),
    latex: "A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
  },
  {
    id: "cases",
    label: () => i18n.t(($) => $.researchTools.equation.example.cases),
    latex: "f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}",
  },
  {
    id: "aligned",
    label: () => i18n.t(($) => $.researchTools.equation.example.aligned),
    latex:
      "\\begin{aligned} (a+b)^2 &= a^2 + 2ab + b^2 \\\\ &= a^2 + b^2 + 2ab \\end{aligned}",
  },
  {
    id: "series",
    label: () => i18n.t(($) => $.researchTools.equation.example.series),
    latex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
  },
  {
    id: "limit",
    label: () => i18n.t(($) => $.researchTools.equation.example.limit),
    latex: "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
  },
  {
    id: "binomial",
    label: () => i18n.t(($) => $.researchTools.equation.example.binomial),
    latex: "\\binom{n}{k} = \\frac{n!}{k!\\,(n-k)!}",
  },
  {
    id: "chemistry",
    label: () => i18n.t(($) => $.researchTools.equation.example.chemistry),
    latex: "\\ce{2H2 + O2 -> 2H2O}",
  },
];

function InlineFormula({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is trusted local rendering
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

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
  const { t } = useTranslation(["common", "researchTools"]);
  const previewCardRef = useRef<HTMLDivElement>(null);

  const copyWrapped = () => {
    void navigator.clipboard.writeText(wrapped);
    toast.success(t(($) => $.researchTools.equation.copiedSource));
  };

  const toggleFullscreen = () => {
    const card = previewCardRef.current;
    if (!card) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void card.requestFullscreen();
  };

  return (
    <ToolSplitView storageId="latex-equation-preview">
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground">
            {t(($) => $.researchTools.equation.sourceHeading)}
          </span>
          <div className="flex h-7 items-center rounded-full bg-muted p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => onDisplayChange(false)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                !display ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t(($) => $.researchTools.equation.inline)}
            </button>
            <button
              type="button"
              onClick={() => onDisplayChange(true)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                display ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t(($) => $.researchTools.equation.display)}
            </button>
          </div>
        </div>

        <CodeField
          value={input}
          onChange={onInputChange}
          language={latexMathLanguage}
          themeId={editorTheme}
          testId="equation-latex-field"
          className="min-h-0 flex-1 overflow-auto text-sm [&_.cm-editor]:h-full"
        />

        <div className="border-t px-4 py-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
            {t(($) => $.researchTools.equation.examples)}
          </div>
          <div className="flex flex-wrap gap-2">
            {EQUATION_EXAMPLES.map((ex) => (
              <Button
                key={ex.id}
                variant="outline"
                size="sm"
                onClick={() => onInputChange(ex.latex)}
              >
                {ex.label()}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex h-full min-w-0 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">
              {t(($) => $.researchTools.equation.previewHeading)}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {display
                ? t(($) => $.researchTools.equation.display)
                : t(($) => $.researchTools.equation.inline)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={t(($) => $.researchTools.equation.previewDark)}
              onClick={() => onPreviewThemeChange("dark")}
              className={cn(
                "size-5 rounded-full border bg-[#111111] transition-shadow",
                previewTheme === "dark" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            />
            <button
              type="button"
              aria-label={t(($) => $.researchTools.equation.previewLight)}
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
                <Copy className="size-3.5" /> {t(($) => $.common.actions.copy)}
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
                    <Trans
                      ns="researchTools"
                      i18nKey={($) => $.researchTools.equation.inlineSample}
                      components={{ formula: <InlineFormula html={rendered.html} /> }}
                    />
                  </p>
                )
              ) : (
                <p className="text-sm opacity-60">{t(($) => $.researchTools.equation.empty)}</p>
              )}
            </div>
          </div>

          <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border bg-card px-2 py-1 shadow-lg">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onZoomChange(Math.max(MIN_ZOOM, zoom - 25))}
              aria-label={t(($) => $.researchTools.equation.zoomOut)}
            >
              <ZoomOut className="size-4" />
            </Button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="min-w-11 px-1 text-center text-xs text-muted-foreground"
            >
              {`${zoom}%`}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onZoomChange(Math.min(MAX_ZOOM, zoom + 25))}
              aria-label={t(($) => $.researchTools.equation.zoomIn)}
            >
              <ZoomIn className="size-4" />
            </Button>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onZoomChange(100)}
              aria-label={t(($) => $.researchTools.equation.resetZoom)}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggleFullscreen}
              aria-label={t(($) => $.researchTools.equation.fullscreen)}
            >
              <Maximize className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </ToolSplitView>
  );
}
