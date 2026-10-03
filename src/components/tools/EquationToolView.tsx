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
  Sigma,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverItem } from "@/components/ui/popover";
import {
  CopyLatexLabel,
  EQUATION_EXAMPLES,
  type EquationLanguage,
  EquationPreviewPanel,
  renderEquation,
  useTypstEquationPreview,
} from "@/components/tools/EquationPreviewPanel";
import { latexMathToTypst } from "@oleafly/editor/latex-to-typst-math";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { ThemeMenu } from "@/components/layout/ThemeControls";
import { downloadBlob, downloadBytes } from "@/lib/download-blob";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { WindowControls } from "@/components/layout/WindowControls";
import { notifyError, toast } from "@/lib/toast";
import { logError } from "@/lib/log";
import {
  createImageProject,
  listFiles,
  projectMutationGeneration,
  writeProjectBytes,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import {
  equationToSvgDocument,
  equationFailureMessage,
  svgDocumentToPngBytes,
  typstEquationToPngBytes,
  typstEquationToSvgDocument,
} from "@/features/equation-export";
import { toolName } from "@/lib/tool-catalog";
import { bytesToBase64 } from "@/lib/base64";
import { Spinner } from "@/components/ui/spinner";

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

const EQUATION_PROJECT_TOAST_KEY = "equation-project";

const DARK_BACKDROP = "#111111";
const LIGHT_BACKDROP = "#ffffff";

function typstWrapped(input: string, display: boolean): string {
  const body = input.trim();
  return display ? `$ ${body} $` : `$${body}$`;
}

function equationWrapped(typst: boolean, typstInput: string, input: string, display: boolean): string {
  if (typst) return typstWrapped(typstInput, display);
  return display ? String.raw`\[ ${input} \]` : `$${input}$`;
}

function EquationStatus({ failed, rendering }: Readonly<{ failed: boolean; rendering: boolean }>) {
  const { t } = useTranslation(["researchTools"]);
  let statusLabel = t(($) => $.researchTools.equation.statusRendered);
  if (failed) statusLabel = t(($) => $.researchTools.equation.statusError);
  else if (rendering) statusLabel = t(($) => $.researchTools.equation.statusRendering);
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          failed ? "bg-destructive" : "bg-emerald-500",
        )}
      />
      {statusLabel}
    </div>
  );
}

function typstPngSource(wrapped: string, theme: "light" | "dark"): string {
  return theme === "dark" ? `#set text(fill: rgb("#ffffff"))\n${wrapped}` : wrapped;
}

function showProjectOutcome(kind: "success" | "error", message: string): void {
  if (kind === "success") toast.successUnique(EQUATION_PROJECT_TOAST_KEY, message);
  else toast.errorUnique(EQUATION_PROJECT_TOAST_KEY, message);
}

export function EquationToolView() {
  const { t } = useTranslation(["common", "researchTools"]);
  const activePage = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const fullscreen = useFullscreen();
  const [input, setInput] = useState(EQUATION_EXAMPLES[0].latex);
  const [language, setLanguage] = useState<EquationLanguage>("latex");
  const [typstInput, setTypstInput] = useState("");
  const [convertedLatex, setConvertedLatex] = useState<string | null>(null);
  const [display, setDisplay] = useState(true);
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("dark");
  const [zoom, setZoom] = useState(100);
  const projects = useFilesStore((state) => state.projects);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const [assetName, setAssetName] = useState("equation.png");
  const [savingProject, setSavingProject] = useState(false);
  const latexCopy = useCopyStatus({
    onError: (error) => void logError("equation copy latex", error),
  });
  const typst = language === "typst";
  const typstPreview = useTypstEquationPreview(typstInput, display, previewTheme, typst);

  if (activePage !== "equation") return null;

  const rendered = typst ? { html: "", error: null } : renderEquation(input, display);
  const wrapped = equationWrapped(typst, typstInput, input, display);
  const ready = typst ? typstPreview.status === "rendered" : Boolean(rendered.html);
  const failed = typst ? typstPreview.status === "error" : Boolean(rendered.error);
  const backdrop = previewTheme === "dark" ? DARK_BACKDROP : LIGHT_BACKDROP;

  const switchLanguage = (next: EquationLanguage) => {
    if (next === language) return;
    if (next === "typst" && convertedLatex !== input) {
      setTypstInput(latexMathToTypst(input));
      setConvertedLatex(input);
    }
    setLanguage(next);
  };

  const exportTypstPng = () =>
    typstEquationToPngBytes(typstPngSource(wrapped, previewTheme), 3, backdrop);

  // True vector export: MathJax renders the equation to an SVG document with
  // glyph paths, rather than rasterizing the KaTeX preview.
  const exportPng = async () => {
    if (typst) {
      try {
        downloadBytes(await exportTypstPng(), "image/png", "equation.png");
      } catch (e) {
        notifyError(
          "equation export png",
          e,
          equationFailureMessage(e, t(($) => $.researchTools.equation.exportImageFailed)),
        );
      }
      return;
    }
    try {
      const svg = await equationToSvgDocument(input, display);
      const bytes = await svgDocumentToPngBytes(
        svg,
        3,
        previewTheme === "dark" ? "#111111" : "#ffffff",
      );
      downloadBytes(bytes, "image/png", "equation.png");
    } catch (e) {
      notifyError("equation export png", e, t(($) => $.researchTools.equation.exportImageFailed));
    }
  };

  const exportSvg = async () => {
    if (typst) {
      try {
        const svg = await typstEquationToSvgDocument(wrapped);
        downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "equation.svg");
      } catch (e) {
        notifyError(
          "equation export svg",
          e,
          equationFailureMessage(e, t(($) => $.researchTools.equation.exportSvgFailed)),
        );
      }
      return;
    }
    try {
      const svg = await equationToSvgDocument(input, display);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "equation.svg");
    } catch (e) {
      notifyError("equation export svg", e, t(($) => $.researchTools.equation.exportSvgFailed));
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
      notifyError("equation copy mathml", error, t(($) => $.researchTools.equation.mathmlFailed));
    }
  };

  const copyHtml = async () => {
    if (!rendered.html) return;
    try {
      await navigator.clipboard.writeText(rendered.html);
      toast.success(t(($) => $.researchTools.equation.copiedKatexHtml));
    } catch (error) {
      notifyError("equation copy katex html", error, t(($) => $.researchTools.equation.copyKatexFailed));
    }
  };

  const refreshProjectList = () =>
    refreshProjects().catch((error: unknown) => logError("equation refresh projects", error));

  const equationPng = async () => {
    if (typst) return exportTypstPng();
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
      showProjectOutcome("error", t(($) => $.researchTools.equation.invalidPngName));
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
      await refreshProjectList();
      showProjectOutcome("success", t(($) => $.researchTools.equation.savedToProject, { path, project: project.name }));
    } catch (error) {
      void logError("equation save to project", error);
      showProjectOutcome("error", equationFailureMessage(error, t(($) => $.researchTools.equation.saveFailed)));
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
      await refreshProjectList();
      showProjectOutcome("success", t(($) => $.researchTools.equation.projectCreated));
    } catch (error) {
      void logError("equation create image project", error);
      showProjectOutcome("error", equationFailureMessage(error, t(($) => $.researchTools.equation.projectCreateFailed)));
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
            {typst
              ? t(($) => $.researchTools.equation.subtitleTypst)
              : t(($) => $.researchTools.equation.subtitle)}
          </div>
        </div>

        <div className="flex-1" />

        <fieldset
          aria-label={t(($) => $.researchTools.equation.mathLanguage)}
          className="m-0 flex h-7 items-center rounded-full border-0 bg-muted p-0.5 text-xs font-medium"
        >
          {(["latex", "typst"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              onClick={() => switchLanguage(option)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                language === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {option === "typst"
                ? t(($) => $.researchTools.equation.languageTypst)
                : t(($) => $.researchTools.equation.languageLatex)}
            </button>
          ))}
        </fieldset>

        <EquationStatus failed={failed} rendering={typst && typstPreview.status === "rendering"} />
        <ThemeMenu testId="equation-theme-menu" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void latexCopy.copy(wrapped)}
        >
          <CopyLatexLabel
            status={latexCopy.status}
            idleLabel={
              typst
                ? t(($) => $.researchTools.equation.copyTypst)
                : t(($) => $.researchTools.equation.copyLatex)
            }
            failedLabel={typst ? t(($) => $.researchTools.equation.copyTypstFailed) : undefined}
            iconClassName="size-4"
          />
        </Button>
        {ready && (
          <Popover
            align="right"
            closeOnClick={false}
            ariaLabel={t(($) => $.researchTools.equation.saveToProject)}
            className="w-72 p-2"
            onOpenChange={(open) => {
              if (open) void refreshProjectList();
            }}
            trigger={
              <>
                {savingProject ? <Spinner /> : <FolderPlus className="size-4" />}
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
            {!typst && (
              <PopoverItem onClick={() => void saveAsProject()}>
                <FolderPlus className="size-4" /> {t(($) => $.researchTools.equation.newImageProject)}
              </PopoverItem>
            )}
            {!typst && projects.length > 0 && <div className="my-1 border-t" />}
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
        {ready ? (
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
            {!typst && (
              <PopoverItem onClick={() => void copyMathML()}>
                <Braces className="size-4" /> {t(($) => $.researchTools.equation.copyMathml)}
              </PopoverItem>
            )}
            {!typst && (
              <PopoverItem onClick={() => void copyHtml()}>
                <Copy className="size-4" /> {t(($) => $.researchTools.equation.copyKatexHtml)}
              </PopoverItem>
            )}
          </Popover>
        ) : (
          <Button size="sm" disabled>
            <Download className="size-4" /> {t(($) => $.researchTools.equation.export)}
          </Button>
        )}
        <WindowControls />
      </div>

      <EquationPreviewPanel
        language={language}
        typst={typstPreview}
        input={typst ? typstInput : input}
        onInputChange={typst ? setTypstInput : setInput}
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
