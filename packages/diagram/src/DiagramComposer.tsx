import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Download,
  FolderOpen,
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
  Upload,
  X,
} from "lucide-react";
import type { Extension } from "@codemirror/state";
import { CmCodeEditor, type CmHandle } from "./CmCodeEditor";
import { DiagramCanvas } from "./DiagramCanvas";
import {
  type DiagramModel,
  type EdgeRouting,
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
  const STROKE = "#1e293b";
  const INK = "#0f172a";
  const PINK = "#f9d7d9";
  const ORANGE = "#fde3c7";
  const YELLOW_GREEN = "#eef2c3";
  const BLUE = "#cfe8f8";
  const PURPLE = "#dad2f0";
  const GREEN = "#cdedd0";
  const GREY = "#e9e9ec";

  const BW = 170, BH = 46;
  const ENC_CX = 250, DEC_CX = 650;
  const box = (
    cx: number,
    y: number,
    label: string,
    fill: string,
    w = BW,
    h = BH,
  ) => ({
    id: newId(),
    shape: "rectangle" as const,
    x: cx - w / 2,
    y,
    w,
    h,
    label,
    fill,
    stroke: STROKE,
    textColor: INK,
    radius: 4,
  });
  const text = (cx: number, y: number, label: string, w = 170, h = 40) => ({
    id: newId(),
    shape: "text" as const,
    x: cx - w / 2,
    y,
    w,
    h,
    label,
    fill: "",
    stroke: "",
    textColor: INK,
  });
  const circle = (cx: number, y: number, label = "") => ({
    id: newId(),
    shape: "circle" as const,
    x: cx - 17,
    y,
    w: 34,
    h: 34,
    label,
    fill: "#ffffff",
    stroke: STROKE,
    textColor: INK,
  });
  const bg = (x: number, y: number, w: number, h: number) => ({
    id: newId(),
    shape: "roundrect" as const,
    x,
    y,
    w,
    h,
    label: "",
    fill: GREY,
    stroke: "#c7c7cc",
    textColor: INK,
    radius: 16,
  });

  const encInputs = text(ENC_CX, 850, "Inputs");
  const encEmbed = box(ENC_CX, 780, "Input Embedding", PINK);
  const encPosCircle = circle(ENC_CX - 80, 710);
  const encPlusCircle = circle(ENC_CX, 710, "+");
  const encPosText = text(ENC_CX - 145, 755, "Positional Encoding", 140, 40);
  const encMHA = box(ENC_CX, 630, "Multi-Head Attention", ORANGE);
  const encAddNorm1 = box(ENC_CX, 560, "Add & Norm", YELLOW_GREEN);
  const encFF = box(ENC_CX, 480, "Feed Forward", BLUE);
  const encAddNorm2 = box(ENC_CX, 410, "Add & Norm", YELLOW_GREEN);
  const encNxBg = bg(ENC_CX - BW / 2 - 25, 390, BW + 50, 306);
  const encNxLabel = text(ENC_CX - BW / 2 - 90, 528, "N×", 50, 30);

  const decOutputs = text(DEC_CX, 850, "Outputs (shifted right)");
  const decEmbed = box(DEC_CX, 780, "Output Embedding", PINK);
  const decPlusCircle = circle(DEC_CX, 710, "+");
  const decPosCircle = circle(DEC_CX + 80, 710);
  const decPosText = text(DEC_CX + 145, 755, "Positional Encoding", 140, 40);
  const decMaskedMHA = box(DEC_CX, 630, "Masked Multi-Head Attention", ORANGE);
  const decAddNorm1 = box(DEC_CX, 560, "Add & Norm", YELLOW_GREEN);
  const decMHA = box(DEC_CX, 480, "Multi-Head Attention", ORANGE);
  const decAddNorm2 = box(DEC_CX, 410, "Add & Norm", YELLOW_GREEN);
  const decFF = box(DEC_CX, 330, "Feed Forward", BLUE);
  const decAddNorm3 = box(DEC_CX, 260, "Add & Norm", YELLOW_GREEN);
  const decNxBg = bg(DEC_CX - BW / 2 - 25, 240, BW + 50, 456);
  const decNxLabel = text(DEC_CX + BW / 2 + 40, 458, "N×", 50, 30);
  const decLinear = box(DEC_CX, 170, "Linear", PURPLE, BW, 44);
  const decSoftmax = box(DEC_CX, 90, "Softmax", GREEN, BW, 44);
  const decOutputProbs = text(DEC_CX, 10, "Output Probabilities", 180, 50);

  const nodes = [
    encNxBg,
    decNxBg,
    encInputs,
    encEmbed,
    encPosCircle,
    encPlusCircle,
    encPosText,
    encMHA,
    encAddNorm1,
    encFF,
    encAddNorm2,
    encNxLabel,
    decOutputs,
    decEmbed,
    decPlusCircle,
    decPosCircle,
    decPosText,
    decMaskedMHA,
    decAddNorm1,
    decMHA,
    decAddNorm2,
    decFF,
    decAddNorm3,
    decNxLabel,
    decLinear,
    decSoftmax,
    decOutputProbs,
  ];

  const link = (
    source: { id: string },
    target: { id: string },
    opts: { routing?: EdgeRouting; sourceHandle?: string; targetHandle?: string } = {},
  ) => ({
    id: newId("e"),
    source: source.id,
    target: target.id,
    routing: opts.routing ?? ("orthogonal" as EdgeRouting),
    arrow: "forward" as const,
    style: "solid" as const,
    sourceHandle: opts.sourceHandle ?? "t",
    targetHandle: opts.targetHandle ?? "b",
  });

  const edges = [
    link(encInputs, encEmbed),
    link(encEmbed, encPlusCircle),
    link(encPosCircle, encPlusCircle, { sourceHandle: "r", targetHandle: "l" }),
    link(encPlusCircle, encMHA),
    link(encMHA, encAddNorm1),
    link(encAddNorm1, encFF),
    link(encFF, encAddNorm2),
    link(decOutputs, decEmbed),
    link(decEmbed, decPlusCircle),
    link(decPosCircle, decPlusCircle, { sourceHandle: "l", targetHandle: "r" }),
    link(decPlusCircle, decMaskedMHA),
    link(decMaskedMHA, decAddNorm1),
    link(decAddNorm1, decMHA),
    link(decMHA, decAddNorm2),
    link(decAddNorm2, decFF),
    link(decFF, decAddNorm3),
    link(decAddNorm3, decLinear),
    link(decLinear, decSoftmax),
    link(decSoftmax, decOutputProbs),
    link(encAddNorm2, decMHA, { sourceHandle: "r", targetHandle: "l" }),
    link(encPlusCircle, encAddNorm1, { sourceHandle: "l", targetHandle: "l" }),
    link(encAddNorm1, encAddNorm2, { sourceHandle: "l", targetHandle: "l" }),
    link(decPlusCircle, decAddNorm1, { sourceHandle: "r", targetHandle: "r" }),
    link(decAddNorm1, decAddNorm2, { sourceHandle: "r", targetHandle: "r" }),
    link(decAddNorm2, decAddNorm3, { sourceHandle: "r", targetHandle: "r" }),
  ];

  return { version: 1, nodes, edges };
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
  onClose,
  host,
  codeExtensions,
  isMac = false,
  fullscreen = false,
  forcePreviewOpen = false,
  brand,
}: {
  open: boolean;
  projectId: string | null;
  projectName?: string | null;
  onClose: () => void;
  host: DiagramHost;
  codeExtensions?: Extension[];
  isMac?: boolean;
  fullscreen?: boolean;
  // Shows the (empty, pre-compile) preview pane layout without actually
  // compiling anything. Lets an app-level caller (e.g. a product tour) point
  // at the real preview affordance instead of describing UI that isn't there.
  forcePreviewOpen?: boolean;
  // App-supplied brand/back element, rendered in place of the default back
  // button + title so this matches the app's own project toolbar.
  brand?: ReactNode;
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
  const cmRef = useRef<CmHandle>(null);
  const codeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePickerRef = useRef<HTMLDivElement>(null);
  const downloadPickerRef = useRef<HTMLDivElement>(null);

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
  }, [open]);

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

  const snippetCode = hasDrawing ? serializeDiagram({ ...model, background }) : code;

  const [savePickerOpen, setSavePickerOpen] = useState(false);
  const [saveToProjectHover, setSaveToProjectHover] = useState(false);
  const [projectPicks, setProjectPicks] = useState<{ id: string; name: string }[]>([]);

  const openSavePicker = useCallback(async () => {
    if (!png) { toast.error("Compile the diagram first so there is something to save."); return; }
    setProjectPicks(await host.listProjectNames());
    setSavePickerOpen(true);
  }, [png, host, toast]);

  const saveToExistingProject = useCallback(async (targetProjectId: string) => {
    if (!stem) { toast.error("Enter a name for the diagram first."); return; }
    if (!png) return;
    if (!(await confirmOverwrite([`figures/${stem}.png`, `figures/${stem}.tikz`]))) return;
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      await host.writeProjectBytes(targetProjectId, `figures/${stem}.png`, b64);
      await host.writeFileContent(targetProjectId, `figures/${stem}.tikz`, snippetCode);
      await host.refreshTree();
      toast.success(`Saved to figures/${stem}.png`);
    } catch (e) {
      toast.error(`Could not save the diagram: ${e}`);
    } finally {
      setSavePickerOpen(false);
    }
  }, [stem, png, snippetCode, confirmOverwrite, host, toast]);

  const saveAsNewProject = useCallback(async () => {
    const src = buildStandaloneDoc({
      code: hasDrawing ? serializeDiagram({ ...model, background }) : code,
      libraries: DIAGRAM_LIBS,
      background,
    });
    const targetName = name.trim() || "Untitled Diagram";
    try {
      await host.createDiagramProject(targetName, src);
      await host.refreshProjects();
      toast.success("Saved as a new diagram project. Find it on your home screen.");
    } catch (e) {
      toast.error(`Could not save as a project: ${e}`);
    } finally {
      setSavePickerOpen(false);
    }
  }, [name, model, code, hasDrawing, background, host, toast]);

  const saveFigureGlobally = useCallback(async () => {
    if (!stem) { toast.error("Enter a name for the diagram first."); return; }
    if (!png) { toast.error("Compile the diagram first so there is something to save."); return; }
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      const result = await host.saveFigureToCache(stem, b64, snippetCode);
      toast.success(result.alreadyCached ? "Already cached, reusing the existing figure." : "Saved to your figures cache.");
    } catch (e) {
      toast.error(`Could not save the figure: ${e}`);
    }
  }, [stem, png, snippetCode, host, toast]);

  const [downloadPickerOpen, setDownloadPickerOpen] = useState(false);

  const downloadFigure = useCallback(async (format: "png") => {
    if (!png) { toast.error("Compile the diagram first so there is something to download."); return; }
    setDownloadPickerOpen(false);
    const b64 = png.slice(png.indexOf(",") + 1);
    const saved = await host.saveBytesToDisk(stem || "diagram", format, b64);
    if (saved) toast.success("Downloaded.");
  }, [png, stem, host, toast]);

  const [importing, setImporting] = useState(false);
  const importTikzFile = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const picked = await host.pickTikzFile();
      if (!picked) return;
      const drawable = applyLoadedContent(picked.content);
      const importedName = safeName(picked.name.replace(/\.(tikz|tex)$/i, ""));
      if (importedName) {
        setName(importedName);
        setNameDraft(importedName);
      }
      toast.success(
        drawable
          ? `Imported ${picked.name} for editing.`
          : `Imported ${picked.name} (code only, not drawable).`,
      );
    } catch (e) {
      toast.error(`Could not import that file: ${e}`);
    } finally {
      setImporting(false);
    }
  }, [importing, host, toast, applyLoadedContent]);

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

  useEffect(() => {
    if (!savePickerOpen && !downloadPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (savePickerOpen && savePickerRef.current && !savePickerRef.current.contains(e.target as Node)) {
        setSavePickerOpen(false);
      }
      if (downloadPickerOpen && downloadPickerRef.current && !downloadPickerRef.current.contains(e.target as Node)) {
        setDownloadPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [savePickerOpen, downloadPickerOpen]);

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
  const showPreview = previewOpen || forcePreviewOpen;

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
      aria-labelledby={brand ? undefined : "diagram-composer-title"}
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
        {brand ?? (
          <>
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
          </>
        )}
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
            <Tooltip label={displayFile}>
              <button
                type="button"
                data-testid="diagram-name-display"
                onClick={startEditName}
                title="Rename diagram"
                className="flex min-w-0 items-center rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <span className="max-w-[220px] truncate font-normal">{displayFile}</span>
              </button>
            </Tooltip>
          )}
          <Tooltip label="Import a .tikz or .tex file, replacing this draft">
            <button
              type="button"
              data-tour="diagram-import"
              aria-label="Import TikZ file"
              onClick={() => void importTikzFile()}
              disabled={importing}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
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
          <div className="relative" ref={savePickerRef}>
            <Tooltip label="Save this diagram">
              <Button
                data-tour="diagram-save-project"
                variant="ghost"
                size="sm"
                aria-label="Save"
                onClick={() => void openSavePicker()}
              >
                <Save className="size-3.5" />
                <ChevronRight className="size-3 rotate-90" />
              </Button>
            </Tooltip>
            {savePickerOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-background p-1 shadow-lg">
                <div
                  className="relative"
                  onMouseEnter={() => setSaveToProjectHover(true)}
                  onMouseLeave={() => setSaveToProjectHover(false)}
                >
                  <button
                    type="button"
                    data-testid="diagram-save-to-project"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex flex-1 items-center justify-end gap-2">
                      Save to project <FolderOpen className="size-3.5" />
                    </span>
                  </button>
                  {saveToProjectHover && (
                    <div className="absolute right-full top-0 z-30 mr-1 w-64 rounded-md border bg-background p-2 shadow-lg">
                      <button
                        type="button"
                        onClick={() => void saveAsNewProject()}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <Save className="size-3.5" /> New project
                      </button>
                      <div className="my-1 border-t" />
                      <div className="max-h-40 overflow-auto">
                        {projectPicks.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">No other projects yet.</div>
                        ) : (
                          projectPicks.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => void saveToExistingProject(p.id)}
                              className="flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                            >
                              {p.name}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="my-1 border-t" />
                <button
                  type="button"
                  onClick={() => void saveFigureGlobally()}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Save className="size-3.5" /> Save Figure
                </button>
              </div>
            )}
          </div>
          <div className="relative" ref={downloadPickerRef}>
            <Tooltip label="Download this diagram">
              <Button
                variant="ghost"
                size="sm"
                data-tour="diagram-download"
                aria-label="Download"
                onClick={() => setDownloadPickerOpen((v) => !v)}
              >
                <Download className="size-3.5" />
                <ChevronRight className="size-3 rotate-90" />
              </Button>
            </Tooltip>
            {downloadPickerOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border bg-background p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => void downloadFigure("png")}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  PNG
                </button>
                <Tooltip label="SVG export needs a vector renderer, not available yet">
                  <button
                    type="button"
                    disabled
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground/50"
                  >
                    SVG (coming soon)
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
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

    </div>
  );
}
