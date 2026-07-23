import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Braces,
  Check,
  ChevronRight,
  Circle,
  Code2,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Minus,
  MousePointerSquareDashed,
  MoveRight,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { Extension } from "@codemirror/state";
import { CmCodeEditor, type CmHandle } from "./CmCodeEditor";
import { DiagramCanvas } from "./DiagramCanvas";
import {
  type DiagramModel,
  newId,
  modelToTikz,
  serializeDiagram,
  parseEmbeddedModel,
  buildStandaloneDoc,
  DIAGRAM_LIBS,
} from "@oleafly/latex";
import { useDiagramKit } from "./kit";
import type { DiagramHost } from "./host";
import { cn } from "./cn";

function starterModel(): DiagramModel {
  const a = newId(), b = newId(), c = newId();
  return {
    version: 1,
    nodes: [
      { id: a, shape: "rectangle", x: 200, y: 40, w: 120, h: 52, label: "Dataset", fill: "#eef2ff", stroke: "#1e293b", textColor: "#0f172a", radius: 0 },
      { id: b, shape: "rectangle", x: 200, y: 150, w: 120, h: 52, label: "Encoder", fill: "#eef2ff", stroke: "#1e293b", textColor: "#0f172a", radius: 0 },
      { id: c, shape: "rectangle", x: 200, y: 260, w: 120, h: 52, label: "Classifier", fill: "#eef2ff", stroke: "#1e293b", textColor: "#0f172a", radius: 0 },
    ],
    edges: [
      { id: newId("e"), source: a, target: b, routing: "straight", arrow: "forward", style: "solid" },
      { id: newId("e"), source: b, target: c, routing: "straight", arrow: "forward", style: "solid" },
    ],
  };
}

const TIKZ_SNIPPETS: { label: string; icon: ReactNode; snippet: string }[] = [
  { label: "Rectangle node", icon: <Square className="size-3.5" />, snippet: "\\node (n) [draw, rounded corners] {Label};\n" },
  { label: "Circle node", icon: <Circle className="size-3.5" />, snippet: "\\node (n) [draw, circle] {};\n" },
  { label: "Arrow edge", icon: <MoveRight className="size-3.5" />, snippet: "\\draw[->] (a) -- (b);\n" },
  { label: "Line edge", icon: <Minus className="size-3.5" />, snippet: "\\draw (a) -- (b);\n" },
  { label: "Scope", icon: <Braces className="size-3.5" />, snippet: "\\begin{scope}\n  \n\\end{scope}\n" },
];

function safeName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

type Mode = "draw" | "code";

// Headless with respect to the app: all compile/file/editor/AI access goes
// through `host` (see DiagramHost) and UI primitives come from DiagramKit.
export function DiagramComposer({
  open,
  projectId,
  projectName,
  initialFilePath,
  onClose,
  host,
  codeExtensions,
  isMac = false,
  fullscreen = false,
}: {
  open: boolean;
  projectId: string | null;
  projectName?: string | null;
  initialFilePath?: string | null;
  onClose: () => void;
  host: DiagramHost;
  codeExtensions?: Extension[];
  isMac?: boolean;
  fullscreen?: boolean;
}) {
  const { Button, Input, ColorPicker, Tooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } =
    useDiagramKit();

  const [mode, setMode] = useState<Mode>("draw");
  const [model, setModel] = useState<DiagramModel>(() => starterModel());
  const [code, setCode] = useState<string>(() => modelToTikz(starterModel()));
  const [name, setName] = useState("diagram");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("diagram");
  const nameEditRef = useRef<HTMLSpanElement>(null);
  const [png, setPng] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasCompiled, setHasCompiled] = useState(false);
  const [scale, setScale] = useState(2);
  // Figure page background: hex "#RRGGBB", or "" for transparent. Default white.
  const [background, setBackground] = useState("#ffffff");
  // Preview is on-demand (not realtime): open after Compile, hide when minimized.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const cmRef = useRef<CmHandle>(null);
  const codeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stem = useMemo(() => safeName(name), [name]);
  const hasDrawing = model.nodes.length > 0;

  // Model -> code (debounced), so the Code tab and compile reflect the drawing.
  const onModelChange = useCallback((m: DiagramModel) => {
    setModel(m);
    if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
    codeTimerRef.current = setTimeout(() => setCode(modelToTikz(m)), 200);
  }, []);

  const applyLoadedContent = useCallback((content: string) => {
    const m = parseEmbeddedModel(content);
    if (m) {
      setModel(m);
      setCode(modelToTikz(m));
      // Keep "" (transparent) if the snippet stored it; only missing → white default.
      setBackground(m.background !== undefined ? m.background : "#ffffff");
      setMode("draw");
    } else {
      setCode(content);
      setMode("code");
    }
    setPng(null);
    return Boolean(m);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setPng(null);
    setLog("");
    setHasCompiled(false);
    setPreviewOpen(false);
    setSavedProjectId(null);
    let cancelled = false;
    void host.findProjectIdByName(`Diagram - ${projectName?.trim() || "Untitled"}`).then((id) => {
      if (!cancelled) setSavedProjectId(id);
    });
    if (projectId && initialFilePath) {
      const base = initialFilePath.split("/").pop() ?? initialFilePath;
      const stemFromPath = base.replace(/\.tikz$/i, "");
      setName(stemFromPath);
      void host.readFileContent(projectId, initialFilePath).then((content) => {
        if (!cancelled) applyLoadedContent(content);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, projectId, projectName, initialFilePath, host, applyLoadedContent]);

  const compile = useCallback(async (overrideCode?: string, overrideBackground?: string) => {
    if (!projectId || busy) return;
    // In draw mode the code is debounced; compile the freshest generated TikZ.
    const raw = overrideCode ?? (hasDrawing && mode === "draw" ? modelToTikz(model) : code);
    const nextBackground = overrideBackground !== undefined ? overrideBackground : background;
    const source = buildStandaloneDoc({
      code: raw,
      libraries: DIAGRAM_LIBS,
      background: nextBackground,
    });
    setBusy(true);
    setLog("");
    setPreviewOpen(true);
    try {
      const result = await host.compileIsolated(projectId, source);
      setLog((result.log ?? "").slice(-4000));
      if (result.has_pdf) {
        const bytes = new Uint8Array(await host.readIsolatedPdf(projectId));
        // The PDF already carries the chosen background (\pagecolor), so render as-is.
        setPng(
          await host.pdfToPng(
            bytes,
            1,
            scale,
            nextBackground || "rgba(0,0,0,0)",
          ),
        );
      } else {
        setPng(null);
        toast.error("Diagram did not compile. Check the log below.");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      setHasCompiled(true);
    }
  }, [projectId, busy, code, model, mode, hasDrawing, scale, background, host, toast]);

  const confirmOverwrite = useCallback(
    async (paths: string[]): Promise<boolean> => {
      if (!projectId) return false;
      try {
        const files = await host.listFiles(projectId);
        const existing = new Set(files.map((f) => f.path));
        const clash = paths.filter((p) => existing.has(p));
        if (clash.length === 0) return true;
        return window.confirm(
          `${clash.join(", ")} already exists. Overwrite? (Choose a different name to keep both.)`,
        );
      } catch {
        return true;
      }
    },
    [projectId, host],
  );

  // Clean TikZ for the document; the on-disk snippet embeds the model so a drawn
  // diagram can be re-opened and edited.
  const docCode = hasDrawing ? modelToTikz(model) : code;
  const snippetCode = hasDrawing ? serializeDiagram({ ...model, background }) : code;

  // Ensure the main document's preamble loads tikz + the shape libraries, so an
  // inserted diagram actually compiles. Best-effort; runs after the figure is
  // saved so it patches content that already includes the figure.
  const ensurePreamble = useCallback(async () => {
    if (!projectId) return;
    const mainDoc = host.getMainDoc() || "main.tex";
    let content: string;
    try {
      content = await host.readFileContent(projectId, mainDoc);
    } catch {
      return;
    }
    const additions: string[] = [];
    if (!/\\usepackage(\[[^\]]*\])?\{[^}]*tikz[^}]*\}/.test(content)) {
      additions.push("\\usepackage{tikz}");
    }
    const missing = DIAGRAM_LIBS.filter((l) => !content.includes(l));
    if (missing.length) additions.push(`\\usetikzlibrary{${missing.join(",")}}`);
    if (!additions.length) return;
    const marker = "\\begin{document}";
    const idx = content.indexOf(marker);
    const block = `${additions.join("\n")}\n`;
    const updated = idx >= 0 ? content.slice(0, idx) + block + content.slice(idx) : block + content;
    await host.writeFileContent(projectId, mainDoc, updated);
    host.applyExternalWrite(mainDoc, updated);
  }, [projectId, host]);

  const insertAsCode = useCallback(async () => {
    if (!projectId) return;
    if (!stem) { toast.error("Enter a name for the diagram first."); return; }
    if (!(await confirmOverwrite([`figures/${stem}.tikz`]))) return;
    const latex = `\\begin{figure}[htbp]\n\\centering\n${docCode}\n\\caption{}\n\\label{fig:${stem}}\n\\end{figure}`;
    host.insertAtCursor(latex);
    try {
      // Persist the figure into the active file, then patch the preamble on the
      // saved content so the tikz libraries are present without losing the figure.
      await host.saveActive();
      await ensurePreamble();
      await host.writeFileContent(projectId, `figures/${stem}.tikz`, snippetCode);
      await host.refreshTree();
    } catch {
      /* snippet/preamble steps are best-effort; the code is already inserted */
    }
    toast.success("Diagram inserted as code.");
    onClose();
  }, [projectId, stem, docCode, snippetCode, confirmOverwrite, ensurePreamble, onClose, host, toast]);

  const insertAsImage = useCallback(async () => {
    if (!projectId) return;
    if (!stem) { toast.error("Enter a name for the diagram first."); return; }
    if (!png) { toast.error("Compile the diagram first so there is an image to insert."); return; }
    if (!(await confirmOverwrite([`figures/${stem}.png`, `figures/${stem}.tikz`]))) return;
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      await host.writeProjectBytes(projectId, `figures/${stem}.png`, b64);
      await host.writeFileContent(projectId, `figures/${stem}.tikz`, snippetCode);
      await host.refreshTree();
    } catch (e) {
      toast.error(`Could not save the image: ${e}`);
      return;
    }
    const latex = `\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{figures/${stem}.png}\n\\caption{}\n\\label{fig:${stem}}\n\\end{figure}`;
    host.insertAtCursor(latex);
    toast.success("Diagram inserted as image.");
    onClose();
  }, [projectId, stem, png, snippetCode, confirmOverwrite, onClose, host, toast]);

  const saveToFigures = useCallback(async () => {
    if (!projectId) return;
    if (!stem) { toast.error("Enter a name for the diagram first."); return; }
    if (!png) { toast.error("Compile the diagram first so there is an image to save."); return; }
    if (!(await confirmOverwrite([`figures/${stem}.png`, `figures/${stem}.tikz`]))) return;
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      await host.writeProjectBytes(projectId, `figures/${stem}.png`, b64);
      await host.writeFileContent(projectId, `figures/${stem}.tikz`, snippetCode);
      await host.refreshTree();
      toast.success(`Saved to figures/${stem}.png`);
    } catch (e) {
      toast.error(`Could not save the diagram: ${e}`);
    }
  }, [projectId, stem, png, snippetCode, confirmOverwrite, host, toast]);

  const loadExisting = useCallback(async () => {
    if (!projectId || !stem) return;
    try {
      const content = await host.readFileContent(projectId, `figures/${stem}.tikz`);
      const drawable = applyLoadedContent(content);
      toast.success(
        drawable
          ? `Loaded figures/${stem}.tikz for editing.`
          : `Loaded figures/${stem}.tikz (code only, not drawable).`,
      );
    } catch {
      toast.error(`No figures/${stem}.tikz to load.`);
    }
  }, [projectId, stem, host, toast, applyLoadedContent]);

  const saveAsProject = useCallback(async () => {
    const src = buildStandaloneDoc({
      code: hasDrawing ? serializeDiagram({ ...model, background }) : code,
      libraries: DIAGRAM_LIBS,
      background,
    });
    const targetName = `Diagram - ${projectName?.trim() || "Untitled"}`;
    try {
      let id = savedProjectId ?? (await host.findProjectIdByName(targetName));
      if (id) {
        await host.writeFileContent(id, "main.tex", src);
        toast.success("Diagram project updated.");
      } else {
        id = await host.createImageProject(targetName, src);
        toast.success("Saved as an image project. Find it on your home screen.");
      }
      setSavedProjectId(id);
      await host.refreshProjects();
    } catch (e) {
      toast.error(`Could not save as project: ${e}`);
    }
  }, [projectName, savedProjectId, model, code, hasDrawing, background, host, toast]);

  // Ask the configured AI to fix a failed compile from the log. One-shot: it
  // returns corrected TikZ, which we drop into Code and recompile (undoable in
  // the editor).
  const [fixing, setFixing] = useState(false);
  const fixWithAi = useCallback(async () => {
    if (fixing || !host.fixWithAi) return;
    setFixing(true);
    try {
      const cur = hasDrawing && mode === "draw" ? modelToTikz(model) : code;
      const fixed = await host.fixWithAi(cur, log.slice(-3000));
      if (!fixed) {
        toast.error("The AI did not return a fix.");
        return;
      }
      setCode(fixed);
      setMode("code");
      toast.success("Applied an AI fix. Recompiling…");
      await compile(fixed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Fix failed: ${e}`);
    } finally {
      setFixing(false);
    }
  }, [fixing, hasDrawing, mode, model, code, log, compile, host, toast]);

  const compileFailed = !!log && !png;

  // Clicking outside the name editor cancels (same as project title in TopToolbar).
  useEffect(() => {
    if (!editingName) return;
    const onDown = (e: MouseEvent) => {
      if (nameEditRef.current && !nameEditRef.current.contains(e.target as Node)) {
        setEditingName(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [editingName]);

  const startEditName = () => {
    setNameDraft(name);
    setEditingName(true);
  };
  const commitName = () => {
    const next = safeName(nameDraft) || "diagram";
    setName(next);
    setNameDraft(next);
    setEditingName(false);
  };
  const cancelEditName = () => {
    setNameDraft(name);
    setEditingName(false);
  };

  const diagramExt = "tikz";
  const displayFile = `${stem || "diagram"}.${diagramExt}`;

  if (!open) return null;

  const switchMode = (m: Mode) => {
    // Entering Code: flush debounced generation so Code mirrors the canvas.
    if (m === "code" && hasDrawing) {
      if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
      setCode(modelToTikz(model));
    }
    setMode(m);
  };

  const hasPreviewResult = !!(png || log);
  const showPreview = previewOpen;

  const previewOpts = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        PNG scale
        <Select value={String(scale)} onValueChange={(v) => setScale(Number(v))}>
          <SelectTrigger className="h-7 w-16 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value="1" className="text-xs">1x</SelectItem>
            <SelectItem value="2" className="text-xs">2x</SelectItem>
            <SelectItem value="3" className="text-xs">3x</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Background
        <ColorPicker
          value={background}
          allowTransparent
          ariaLabel="Figure background color"
          onChange={(value) => {
            setBackground(value);
            if (!value) void compile(undefined, "");
          }}
        />
      </div>
    </>
  );

  return (
    <div
      role="dialog"
      aria-label="Insert diagram"
      aria-modal="true"
      aria-labelledby="diagram-composer-title"
      data-tour="diagram-composer"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div
        className={cn(
          "relative flex h-12 shrink-0 items-center gap-2 border-b bg-background pr-4",
          isMac && !fullscreen && "pl-[78px]",
          isMac && fullscreen && "pl-4",
          !isMac && "pl-4",
        )}
      >
        <Tooltip label="Back to project">
          <button
            type="button"
            aria-label="Back to project"
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
        </Tooltip>
        <h2
          id="diagram-composer-title"
          className="max-w-[15ch] shrink-0 truncate text-sm font-semibold"
          title={projectName || "Insert diagram"}
        >
          {projectName || "Insert diagram"}
        </h2>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
        <div className="flex min-w-0 items-center gap-1">
          {editingName ? (
            <span ref={nameEditRef} className="flex items-center gap-1">
              <Input
                id="diagram-name"
                aria-label="Diagram name"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitName();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditName();
                  }
                }}
                className="h-6 w-[160px] rounded border bg-muted px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">.{diagramExt}</span>
              <Tooltip label="Save (Enter)">
                <button
                  type="button"
                  onClick={commitName}
                  aria-label="Save name"
                  className="flex size-6 items-center justify-center rounded text-emerald-600 hover:bg-accent dark:text-emerald-400"
                >
                  <Check className="size-3.5" />
                </button>
              </Tooltip>
              <Tooltip label="Cancel (Esc)">
                <button
                  type="button"
                  onClick={cancelEditName}
                  aria-label="Cancel rename"
                  className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </Tooltip>
            </span>
          ) : (
            <button
              type="button"
              data-testid="diagram-name-display"
              onClick={startEditName}
              title="Rename diagram"
              className="flex min-w-0 items-center rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="max-w-[220px] truncate font-normal">{displayFile}</span>
            </button>
          )}
          <Tooltip label={`Load figures/${displayFile} to edit`}>
            <button
              type="button"
              aria-label="Load existing diagram"
              onClick={() => void loadExisting()}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <FolderOpen className="size-4" />
            </button>
          </Tooltip>
        </div>

        <div data-tour="diagram-modes" className="group absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-lg border bg-background/80 p-0.5">
          {(["draw", "code"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`diagram-tab-${m}`}
              onClick={() => switchMode(m)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors",
                mode === m
                  ? "bg-accent text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent/50 group-data-[tour-active=true]:text-foreground",
              )}
            >
              {m === "draw" ? <MousePointerSquareDashed className="size-3.5" /> : <Code2 className="size-3.5" />}
              {m === "draw" ? "Draw" : "Code"}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {compileFailed && host.fixWithAi && (
            <Tooltip label="Ask AI to fix the compile error">
              <Button variant="secondary" size="sm" onClick={() => void fixWithAi()} disabled={fixing}>
                {fixing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                Fix with AI
              </Button>
            </Tooltip>
          )}
          <Button data-tour="diagram-compile" data-testid="diagram-compile" size="sm" onClick={() => void compile()} disabled={busy}>
            {busy ? (
              <Loader2 className="compile-shimmer-icon size-3.5" />
            ) : hasCompiled ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            <span className={busy ? "ai-shimmer" : undefined}>
              {busy ? "Compiling…" : hasCompiled ? "Recompile" : "Compile"}
            </span>
          </Button>
          <Tooltip label="Save this diagram as a reusable image project">
            <Button data-tour="diagram-save-project" variant="secondary" size="sm" onClick={() => void saveAsProject()}>
              <Save className="size-3.5" /> {savedProjectId ? "Save" : "Save as project"}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div
        data-tour="diagram-preview-affordance"
        className={cn("min-h-0 flex-1", showPreview ? "grid grid-cols-2" : "flex")}
      >
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showPreview && "border-r")}>
          {mode === "draw" ? (
            <DiagramCanvas
              model={model}
              onChange={onModelChange}
              showPreviewAction={hasPreviewResult && !showPreview}
              onShowPreview={() => setPreviewOpen(true)}
            />
          ) : (
            <>
              <div className="flex h-[34px] shrink-0 items-center gap-0.5 border-b bg-sidebar px-2">
                <span className="mr-1 text-[11px] text-muted-foreground">Snippets</span>
                {TIKZ_SNIPPETS.map((s) => (
                  <Tooltip key={s.label} label={s.label} side="bottom">
                    <button
                      type="button"
                      aria-label={s.label}
                      onClick={() => cmRef.current?.insert(s.snippet)}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {s.icon}
                    </button>
                  </Tooltip>
                ))}
                {hasPreviewResult && !showPreview && (
                  <div className="ml-auto">
                    <Tooltip label="Show compiled preview">
                      <button
                        type="button"
                        aria-label="Show preview"
                        onClick={() => setPreviewOpen(true)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <PanelRightOpen className="size-3.5" />
                        Preview
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 bg-background">
                <CmCodeEditor ref={cmRef} value={code} onChange={setCode} extensions={codeExtensions} />
              </div>
            </>
          )}
        </div>

        {showPreview && (
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex min-h-[34px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-sidebar px-3 py-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
              {previewOpts}
              <div className="ml-auto flex items-center gap-1">
                {busy && (
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Compiling…
                  </span>
                )}
                {png && projectId && (
                  <Tooltip label={`Save to figures/${stem || "name"}.png`}>
                    <button
                      type="button"
                      aria-label="Save diagram to project"
                      onClick={() => void saveToFigures()}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Save className="size-3.5" />
                      Save to project
                    </button>
                  </Tooltip>
                )}
                <Tooltip label="Minimize preview">
                  <button
                    type="button"
                    aria-label="Minimize preview"
                    onClick={() => {
                      setPreviewOpen(false);
                    }}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <PanelRightClose className="size-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-sidebar p-3">
              {busy && !png && !log ? (
                <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Compiling…
                </div>
              ) : png ? (
                <div className="flex h-full items-center justify-center">
                  <img
                    src={png}
                    alt="Diagram preview"
                    className={cn(
                      "max-h-full max-w-full object-contain",
                      background === "" &&
                        "bg-[length:16px_16px] bg-[linear-gradient(45deg,#252525_25%,transparent_25%,transparent_75%,#252525_75%,#252525),linear-gradient(45deg,#252525_25%,#333_25%,#333_75%,#252525_75%,#252525)] bg-[position:0_0,8px_8px]",
                    )}
                  />
                </div>
              ) : log ? (
                <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground">{log}</pre>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
                  Compile to see a preview.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {mode === "code" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-sidebar px-3 py-2">
          <p className="mr-auto text-[11px] text-muted-foreground">
            Saves to <code className="font-mono">figures/{stem || "name"}.tikz</code>
            {hasDrawing ? " (re-openable)" : ""}.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void insertAsCode()}>
            <Code2 className="size-3.5" /> Insert as code (vector)
          </Button>
          <Button data-testid="diagram-insert-image" size="sm" onClick={() => void insertAsImage()} disabled={!png}>
            <ImageIcon className="size-3.5" /> Insert as image (PNG)
          </Button>
        </div>
      )}
    </div>
  );
}
