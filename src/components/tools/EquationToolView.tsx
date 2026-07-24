import { useState } from "react";
import { ArrowLeft, Copy, Download, Moon, Sigma, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EQUATION_EXAMPLES,
  EquationPreviewPanel,
  renderEquation,
} from "@/components/tools/EquationPreviewPanel";
import { useHomeViewStore } from "@/store/home-view";
import { useTheme } from "@/lib/theme";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { toast } from "@/lib/toast";

export function EquationToolView() {
  const activePage = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);
  const { theme, toggleTheme } = useTheme();
  const fullscreen = useFullscreen();
  const [input, setInput] = useState(EQUATION_EXAMPLES[0].latex);
  const [display, setDisplay] = useState(true);
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("dark");
  const [zoom, setZoom] = useState(100);

  if (activePage !== "equation") return null;

  const rendered = renderEquation(input, display);
  const wrapped = display ? `\\[ ${input} \\]` : `$${input}$`;

  const exportPng = () => {
    if (!rendered.html) return;
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:${previewTheme === "dark" ? "#111111" : "#ffffff"};color:${previewTheme === "dark" ? "#ffffff" : "#000000"};font-size:28px;padding:24px;box-sizing:border-box;">${rendered.html}</div></foreignObject></svg>`;
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
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
      a.download = "equation.png";
      a.click();
    };
    img.onerror = () => toast.error("Couldn't export this equation as an image");
    img.src = svgUrl;
  };

  return (
    <div data-testid="equation-tool-view" className="flex h-full flex-col bg-background">
      <div
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
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="h-6 w-px bg-border" />
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
          <Sigma className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Equation Preview</div>
          <div className="text-xs leading-tight text-muted-foreground">Live LaTeX workspace</div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              rendered.error ? "bg-destructive" : "bg-emerald-500",
            )}
          />
          {rendered.error ? "Error" : "Rendered"}
        </div>
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(wrapped);
            toast.success("Copied LaTeX source");
          }}
        >
          <Copy className="size-4" /> Copy LaTeX
        </Button>
        <Button size="sm" onClick={exportPng} disabled={!rendered.html}>
          <Download className="size-4" /> Export
        </Button>
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
      />
    </div>
  );
}
