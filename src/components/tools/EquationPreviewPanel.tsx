import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import katex from "katex";
import "katex/dist/katex.min.css";
// Chemistry equations (\ce{...}) for the examples below.
import "katex/contrib/mhchem";
import { AlertCircle, Check, Copy, Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeField } from "@/components/tools/CodeField";
import { ToolSplitView } from "@/components/tools/ToolWorkspace";
import { latexMathLanguage } from "@/components/editor/cm/latex";
import { cn } from "@/lib/utils";
import { logError } from "@/lib/log";
import { i18n } from "@/i18n";

export type CopyStatus = "idle" | "copied" | "failed";

export const COPIED_FEEDBACK_MS = 1500;
export const COPY_FAILED_FEEDBACK_MS = 4000;

export function useCopyStatus(scope: string): {
  status: CopyStatus;
  copy: (text: string) => Promise<void>;
} {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      let next: CopyStatus = "copied";
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        next = "failed";
        void logError(scope, error);
      }
      if (!mounted.current) return;
      if (timer.current) clearTimeout(timer.current);
      setStatus(next);
      timer.current = setTimeout(
        () => setStatus("idle"),
        next === "copied" ? COPIED_FEEDBACK_MS : COPY_FAILED_FEEDBACK_MS,
      );
    },
    [scope],
  );

  return { status, copy };
}

export function CopyLatexLabel({
  status,
  idleLabel,
  iconClassName,
}: Readonly<{ status: CopyStatus; idleLabel: string; iconClassName: string }>) {
  const { t } = useTranslation(["common", "researchTools"]);
  let icon = <Copy aria-hidden className={iconClassName} />;
  let label = idleLabel;
  if (status === "copied") {
    icon = <Check aria-hidden className={iconClassName} />;
    label = t(($) => $.common.actions.copied);
  } else if (status === "failed") {
    icon = <AlertCircle aria-hidden className={cn(iconClassName, "text-destructive")} />;
    label = t(($) => $.researchTools.equation.copyLatexFailed);
  }
  return (
    <>
      {icon}
      <span aria-live="polite">{label}</span>
    </>
  );
}

export const EQUATION_EXAMPLES: { id: string; label: () => string; latex: string }[] = [
  {
    id: "quadratic",
    label: () => i18n.t(($) => $.researchTools.equation.example.quadratic),
    latex: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
  },
  {
    id: "euler",
    label: () => i18n.t(($) => $.researchTools.equation.example.euler),
    latex: String.raw`e^{i\pi} + 1 = 0`,
  },
  {
    id: "integral",
    label: () => i18n.t(($) => $.researchTools.equation.example.integral),
    latex: String.raw`\int_{a}^{b} f(x)\,dx`,
  },
  {
    id: "matrix",
    label: () => i18n.t(($) => $.researchTools.equation.example.matrix),
    latex: String.raw`A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
  },
  {
    id: "cases",
    label: () => i18n.t(($) => $.researchTools.equation.example.cases),
    latex: String.raw`f(x) = \begin{cases} x^2 & x \ge 0 \\ -x & x < 0 \end{cases}`,
  },
  {
    id: "aligned",
    label: () => i18n.t(($) => $.researchTools.equation.example.aligned),
    latex:
      String.raw`\begin{aligned} (a+b)^2 &= a^2 + 2ab + b^2 \\ &= a^2 + b^2 + 2ab \end{aligned}`,
  },
  {
    id: "series",
    label: () => i18n.t(($) => $.researchTools.equation.example.series),
    latex: String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}`,
  },
  {
    id: "limit",
    label: () => i18n.t(($) => $.researchTools.equation.example.limit),
    latex: String.raw`\lim_{x \to 0} \frac{\sin x}{x} = 1`,
  },
  {
    id: "binomial",
    label: () => i18n.t(($) => $.researchTools.equation.example.binomial),
    latex: String.raw`\binom{n}{k} = \frac{n!}{k!\,(n-k)!}`,
  },
  {
    id: "chemistry",
    label: () => i18n.t(($) => $.researchTools.equation.example.chemistry),
    latex: String.raw`\ce{2H2 + O2 -> 2H2O}`,
  },
];

function InlineFormula({ html }: Readonly<{ html: string }>) {
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
}: Readonly<EquationPreviewPanelProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const previewCardRef = useRef<HTMLDivElement>(null);
  const latexCopy = useCopyStatus("equation copy latex from preview");

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
                previewTheme === "dark" && "border-2 border-primary",
              )}
            />
            <button
              type="button"
              aria-label={t(($) => $.researchTools.equation.previewLight)}
              onClick={() => onPreviewThemeChange("light")}
              className={cn(
                "size-5 rounded-full border bg-white transition-shadow",
                previewTheme === "light" && "border-2 border-primary",
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
                onClick={() => void latexCopy.copy(wrapped)}
              >
                <CopyLatexLabel
                  status={latexCopy.status}
                  idleLabel={t(($) => $.common.actions.copy)}
                  iconClassName="size-3.5"
                />
              </Button>
            )}
            <div
              style={{ transform: `scale(${zoom / 100})` }}
              className="transition-transform"
            >
              {rendered.error ? (
                <p className="max-w-sm text-sm text-destructive">{rendered.error}</p>
              ) : null}
              {!rendered.error && rendered.html && display ? (
                // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is trusted local rendering
                <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
              ) : null}
              {!rendered.error && rendered.html && !display ? (
                <p className="max-w-md text-base leading-relaxed">
                  <Trans
                    ns="researchTools"
                    i18nKey={($) => $.researchTools.equation.inlineSample}
                    components={{ formula: <InlineFormula html={rendered.html} /> }}
                  />
                </p>
              ) : null}
              {!rendered.error && !rendered.html ? (
                <p className="text-sm opacity-60">{t(($) => $.researchTools.equation.empty)}</p>
              ) : null}
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
