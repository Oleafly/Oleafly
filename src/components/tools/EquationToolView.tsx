import { useState } from "react";
import { useTranslation } from "react-i18next";
import katex from "katex";
import {
  ArrowLeft,
  Braces,
  Copy,
  Download,
  FileCode2,
  Image as ImageIcon,
  Sigma,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverItem } from "@/components/ui/popover";
import {
  EQUATION_EXAMPLES,
  EquationPreviewPanel,
  renderEquation,
} from "@/components/tools/EquationPreviewPanel";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { ThemeMenu } from "@/components/layout/ThemeControls";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { WindowControls } from "@/components/layout/WindowControls";
import { toast } from "@/lib/toast";
import { toolName } from "@/lib/tool-catalog";

export function EquationToolView() {
  const { t } = useTranslation(["common", "researchTools"]);
  const activePage = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const fullscreen = useFullscreen();
  const [input, setInput] = useState(EQUATION_EXAMPLES[0].latex);
  const [display, setDisplay] = useState(true);
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("dark");
  const [zoom, setZoom] = useState(100);

  if (activePage !== "equation") return null;

  const rendered = renderEquation(input, display);
  const wrapped = display ? `\\[ ${input} \\]` : `$${input}$`;

  const buildSvgMarkup = () =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:${previewTheme === "dark" ? "#111111" : "#ffffff"};color:${previewTheme === "dark" ? "#ffffff" : "#000000"};font-size:28px;padding:24px;box-sizing:border-box;">${rendered.html}</div></foreignObject></svg>`;

  const downloadBlob = (content: string, type: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPng = () => {
    if (!rendered.html) return;
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSvgMarkup())}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "latex-preview.png";
      a.click();
    };
    img.onerror = () => toast.error(t(($) => $.researchTools.equation.exportImageFailed));
    img.src = svgUrl;
  };

  const exportSvg = () => {
    if (!rendered.html) return;
    downloadBlob(buildSvgMarkup(), "image/svg+xml", "latex-preview.svg");
  };

  const copyMathML = () => {
    try {
      const markup = katex.renderToString(input, {
        displayMode: display,
        throwOnError: true,
        output: "mathml",
      });
      const math = new DOMParser().parseFromString(markup, "text/html").querySelector("math");
      if (!math) throw new Error("No MathML in output");
      void navigator.clipboard.writeText(math.outerHTML);
      toast.success(t(($) => $.researchTools.equation.copiedMathml));
    } catch {
      toast.error(t(($) => $.researchTools.equation.mathmlFailed));
    }
  };

  const copyHtml = () => {
    if (!rendered.html) return;
    void navigator.clipboard.writeText(rendered.html);
    toast.success(t(($) => $.researchTools.equation.copiedKatexHtml));
  };

  return (
    <div data-testid="equation-tool-view" className="flex h-full flex-col bg-background">
      <div
        data-tauri-drag-region
        className={cn(
          "flex items-center gap-3 border-b px-4 py-2.5",
          isMac && !fullscreen && "pl-20",
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goTo("library")}
          data-testid="equation-tool-view-back"
        >
          <ArrowLeft className="size-4" /> {t(($) => $.researchTools.tools.back)}
        </Button>
        <div className="h-6 w-px bg-border" />
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
          <Sigma className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{toolName("equation")}</div>
          <div className="text-xs leading-tight text-muted-foreground">
            {t(($) => $.researchTools.equation.subtitle)}
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              rendered.error ? "bg-destructive" : "bg-emerald-500",
            )}
          />
          {rendered.error
            ? t(($) => $.researchTools.equation.statusError)
            : t(($) => $.researchTools.equation.statusRendered)}
        </div>
        <ThemeMenu testId="equation-theme-menu" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(wrapped);
            toast.success(t(($) => $.researchTools.equation.copiedSource));
          }}
        >
          <Copy className="size-4" /> {t(($) => $.researchTools.equation.copyLatex)}
        </Button>
        {rendered.html ? (
          <Popover
            align="right"
            ariaLabel={t(($) => $.researchTools.equation.exportOptions)}
            className="w-56"
            triggerClassName="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
            trigger={
              <>
                <Download className="size-4" /> {t(($) => $.researchTools.equation.export)}
              </>
            }
          >
            <PopoverItem onClick={exportPng}>
              <ImageIcon className="size-4" /> {t(($) => $.researchTools.equation.downloadPng)}
            </PopoverItem>
            <PopoverItem onClick={exportSvg}>
              <FileCode2 className="size-4" /> {t(($) => $.researchTools.equation.downloadSvg)}
            </PopoverItem>
            <PopoverItem onClick={copyMathML}>
              <Braces className="size-4" /> {t(($) => $.researchTools.equation.copyMathml)}
            </PopoverItem>
            <PopoverItem onClick={copyHtml}>
              <Copy className="size-4" /> {t(($) => $.researchTools.equation.copyKatexHtml)}
            </PopoverItem>
          </Popover>
        ) : (
          <Button size="sm" disabled>
            <Download className="size-4" /> {t(($) => $.researchTools.equation.export)}
          </Button>
        )}
        <WindowControls />
      </div>

      <EquationPreviewPanel
        input={input}
        onInputChange={setInput}
        display={display}
        onDisplayChange={setDisplay}
        rendered={rendered}
        wrapped={wrapped}
        previewTheme={previewTheme}
        onPreviewThemeChange={setPreviewTheme}
        zoom={zoom}
        onZoomChange={setZoom}
        editorTheme={editorTheme}
      />
    </div>
  );
}
