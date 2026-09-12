import { useState } from "react";
import { useTranslation } from "react-i18next";
import katex from "katex";
import {
  ArrowLeft,
  Braces,
  Copy,
  Download,
  FileCode2,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Sigma,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  createImageProject,
  listFiles,
  projectMutationGeneration,
  writeProjectBytes,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import {
  equationToSvgDocument,
  svgDocumentToPngBytes,
} from "@/features/equation-export";
import { toolName } from "@/lib/tool-catalog";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function pngFileName(value: string): string | null {
  const name = value.trim().replace(/\.png$/i, "");
  const hasControlCharacter = [...name].some(
    (character) => character.charCodeAt(0) < 32,
  );
  const windowsStem = name.split(".")[0].toUpperCase();
  const windowsReserved = ["CON", "PRN", "AUX", "NUL"].includes(windowsStem)
    || /^(?:COM|LPT)[1-9]$/.test(windowsStem);
  if (
    !name
    || name.length > 120
    || name === "."
    || name === ".."
    || /[\\/:*?"<>|]/.test(name)
    || hasControlCharacter
    || name.endsWith(".")
    || windowsReserved
  ) {
    return null;
  }
  return `${name}.png`;
}

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
  const projects = useFilesStore((state) => state.projects);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const [assetName, setAssetName] = useState("equation.png");
  const [savingProject, setSavingProject] = useState(false);

  if (activePage !== "equation") return null;

  const rendered = renderEquation(input, display);
  const wrapped = display ? `\\[ ${input} \\]` : `$${input}$`;

  const downloadBlob = (content: string | Blob, type: string, filename: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // True vector export: MathJax renders the equation to an SVG document with
  // glyph paths, rather than rasterizing the KaTeX preview.
  const exportPng = async () => {
    try {
      const svg = await equationToSvgDocument(input, display);
      const bytes = await svgDocumentToPngBytes(
        svg,
        3,
        previewTheme === "dark" ? "#111111" : "#ffffff",
      );
      downloadBlob(
        new Blob([bytes.slice().buffer], { type: "image/png" }),
        "image/png",
        "equation.png",
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : t(($) => $.researchTools.equation.exportImageFailed),
      );
    }
  };

  const exportSvg = async () => {
    try {
      const svg = await equationToSvgDocument(input, display);
      downloadBlob(svg, "image/svg+xml", "equation.svg");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.researchTools.equation.exportSvgFailed),
      );
    }
  };

  const copyMathML = async () => {
    try {
      const markup = katex.renderToString(input, {
        displayMode: display,
        throwOnError: true,
        output: "mathml",
      });
      const math = new DOMParser().parseFromString(markup, "text/html").querySelector("math");
      if (!math) throw new Error("No MathML in output");
      await navigator.clipboard.writeText(math.outerHTML);
      toast.success(t(($) => $.researchTools.equation.copiedMathml));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.researchTools.equation.mathmlFailed),
      );
    }
  };

  const copyHtml = async () => {
    if (!rendered.html) return;
    try {
      await navigator.clipboard.writeText(rendered.html);
      toast.success(t(($) => $.researchTools.equation.copiedKatexHtml));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.researchTools.equation.copyKatexFailed));
    }
  };

  const copyLatex = async () => {
    try {
      await navigator.clipboard.writeText(wrapped);
      toast.success(t(($) => $.researchTools.equation.copiedSource));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.researchTools.equation.copyLatexFailed));
    }
  };

  const equationPng = async () => {
    const svg = await equationToSvgDocument(input, display);
    return svgDocumentToPngBytes(
      svg,
      3,
      previewTheme === "dark" ? "#111111" : "#ffffff",
    );
  };

  const saveToProject = async (project: { id: string; name: string }) => {
    if (savingProject) return;
    const fileName = pngFileName(assetName);
    if (!fileName) {
      toast.error(t(($) => $.researchTools.equation.invalidPngName));
      return;
    }
    const path = `figures/${fileName}`;
    setSavingProject(true);
    try {
      const [files, generation] = await Promise.all([
        listFiles(project.id),
        projectMutationGeneration(project.id),
      ]);
      const exists = files.some((file) => file.path.toLowerCase() === path.toLowerCase());
      if (exists && !window.confirm(t(($) => $.researchTools.equation.replaceConfirm, { path, project: project.name }))) {
        return;
      }
      const bytes = await equationPng();
      await writeProjectBytes(project.id, path, bytesToBase64(bytes), generation);
      await refreshProjects();
      toast.success(t(($) => $.researchTools.equation.savedToProject, { path, project: project.name }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.researchTools.equation.saveFailed));
    } finally {
      setSavingProject(false);
    }
  };

  const saveAsProject = async () => {
    if (savingProject) return;
    const projectName = pngFileName(assetName)?.replace(/\.png$/i, "") || t(($) => $.researchTools.equation.defaultProjectName);
    const math = display ? `\\[\n${input}\n\\]` : `$${input}$`;
    const source = [
      "\\documentclass[border=6pt]{standalone}",
      "\\usepackage{amsmath,amssymb}",
      "\\begin{document}",
      math,
      "\\end{document}",
    ].join("\n");
    setSavingProject(true);
    try {
      await createImageProject(projectName, source);
      await refreshProjects();
      toast.success(t(($) => $.researchTools.equation.projectCreated));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.researchTools.equation.projectCreateFailed));
    } finally {
      setSavingProject(false);
    }
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
          onClick={() => goTo("tools")}
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
          onClick={() => void copyLatex()}
        >
          <Copy className="size-4" /> {t(($) => $.researchTools.equation.copyLatex)}
        </Button>
        {rendered.html && (
          <Popover
            align="right"
            closeOnClick={false}
            ariaLabel={t(($) => $.researchTools.equation.saveToProject)}
            className="w-72 p-2"
            onOpenChange={(open) => {
              if (open) void refreshProjects();
            }}
            trigger={
              <>
                {savingProject ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
                {t(($) => $.researchTools.equation.project)}
              </>
            }
            triggerClassName="border bg-background hover:bg-accent"
            disabled={savingProject}
          >
            <label htmlFor="equation-project-file-name" className="px-1 text-xs font-medium text-muted-foreground">
              {t(($) => $.researchTools.equation.pngFileName)}
            </label>
            <Input
              id="equation-project-file-name"
              value={assetName}
              onChange={(event) => setAssetName(event.target.value)}
              className="mt-1 h-8"
            />
            <div className="my-2 border-t" />
            <PopoverItem onClick={() => void saveAsProject()}>
              <FolderPlus className="size-4" /> {t(($) => $.researchTools.equation.newImageProject)}
            </PopoverItem>
            {projects.length > 0 && <div className="my-1 border-t" />}
            <div className="max-h-52 overflow-y-auto">
              {projects.map((project) => (
                <PopoverItem key={project.id} onClick={() => void saveToProject(project)}>
                  <ImageIcon className="size-4" />
                  <span className="truncate">{project.name}</span>
                </PopoverItem>
              ))}
            </div>
          </Popover>
        )}
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
            <PopoverItem onClick={() => void copyMathML()}>
              <Braces className="size-4" /> {t(($) => $.researchTools.equation.copyMathml)}
            </PopoverItem>
            <PopoverItem onClick={() => void copyHtml()}>
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
