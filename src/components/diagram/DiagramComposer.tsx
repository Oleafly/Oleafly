import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Braces,
  Circle,
  Code2,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Minus,
  MousePointerSquareDashed,
  MoveRight,
  Play,
  Save,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { generateText } from "ai";
import { CmCodeEditor, type CmHandle } from "@/components/diagram/CmCodeEditor";
import { DiagramCanvas } from "@/components/diagram/DiagramCanvas";
import { type DiagramModel, newId } from "@/components/diagram/model";
import { modelToTikz, serializeDiagram, parseEmbeddedModel, DIAGRAM_LIBS } from "@/components/diagram/tikz-serializer";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  compileIsolated,
  readIsolatedPdf,
  writeProjectBytes,
  writeFileContent,
  readFileContent,
  listFiles,
  createImageProject,
  getConfig,
} from "@/lib/tauri";
import { buildStandaloneDoc } from "@/lib/ai-figure";
import { resolveActiveModel, hasConfiguredProvider } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** A small starter diagram so the Draw canvas is not blank on first open. */
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

/** Quick TikZ inserts for the Code tab (mirrors the .tex toolbar idea). */
const TIKZ_SNIPPETS: { label: string; icon: ReactNode; snippet: string }[] = [
  { label: "Rectangle node", icon: <Square className="size-3.5" />, snippet: "\\node (n) [draw, rounded corners] {Label};\n" },
  { label: "Circle node", icon: <Circle className="size-3.5" />, snippet: "\\node (n) [draw, circle] {};\n" },
  { label: "Arrow edge", icon: <MoveRight className="size-3.5" />, snippet: "\\draw[->] (a) -- (b);\n" },
  { label: "Line edge", icon: <Minus className="size-3.5" />, snippet: "\\draw (a) -- (b);\n" },
  { label: "Scope", icon: <Braces className="size-3.5" />, snippet: "\\begin{scope}\n  \n\\end{scope}\n" },
];

/** Turn a user-entered name into a safe file stem (keeps case, no path parts). */
function safeName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

type Mode = "draw" | "code";

/**
 * A full-height composer for making a diagram: draw it visually (React Flow,
 * generates TikZ) or write TikZ by hand, preview the compiled figure, then
 * insert it as vector code or a saved PNG. Drawn diagrams round-trip: the
 * source snippet embeds the model so it can be re-opened and edited.
 */
export function DiagramComposer() {
  const open = useSettingsStore((s) => s.diagramComposerOpen);
  const setOpen = useSettingsStore((s) => s.setDiagramComposerOpen);
  const projectId = useFilesStore((s) => s.projectId);

  const [mode, setMode] = useState<Mode>("draw");
  const [model, setModel] = useState<DiagramModel>(() => starterModel());
  const [code, setCode] = useState<string>(() => modelToTikz(starterModel()));
  const [name, setName] = useState("diagram");
  const [png, setPng] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(2);
  // Figure page background: "" = transparent, else a hex color.
  const [background, setBackground] = useState("");
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

  // Close on Escape (unless focus is in an input/textarea/canvas field).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Clear any stale preview/log from a previous session when the modal opens.
  useEffect(() => {
    if (open) {
      setPng(null);
      setLog("");
    }
  }, [open]);

  const compile = useCallback(async (overrideCode?: string) => {
    if (!projectId || busy) return;
    // In draw mode the code is debounced; compile the freshest generated TikZ.
    const raw = overrideCode ?? (hasDrawing && mode === "draw" ? modelToTikz(model) : code);
    const source = buildStandaloneDoc({ code: raw, libraries: DIAGRAM_LIBS, background });
    setBusy(true);
    setLog("");
    try {
      const result = await compileIsolated(projectId, source, useSettingsStore.getState().offline);
      setLog((result.log ?? "").slice(-4000));
      if (result.has_pdf) {
        const bytes = new Uint8Array(await readIsolatedPdf(projectId));
        // The PDF already carries the chosen background (\pagecolor), so render as-is.
        setPng(await pdfPageToPng(bytes, 1, scale));
      } else {
        setPng(null);
        toast.error("Diagram did not compile. Check the log below.");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, busy, code, model, mode, hasDrawing, scale, background]);

  // Warn before overwriting an existing figures/<stem>.* artifact.
  const confirmOverwrite = useCallback(
    async (paths: string[]): Promise<boolean> => {
      if (!projectId) return false;
      try {
        const files = await listFiles(projectId);
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
    [projectId],
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
    const mainDoc = useFilesStore.getState().mainDoc || "main.tex";
    let content: string;
    try {
      content = await readFileContent(projectId, mainDoc);
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
    await writeFileContent(projectId, mainDoc, updated);
    useFilesStore.getState().applyExternalWrite(mainDoc, updated);
  }, [projectId]);

  const insertAsCode = useCallback(async () => {
    if (!projectId) return;
    if (!stem) { toast.error("Enter a name for the diagram first."); return; }
    if (!(await confirmOverwrite([`figures/${stem}.tikz`]))) return;
    const latex = `\\begin{figure}[htbp]\n\\centering\n${docCode}\n\\caption{}\n\\label{fig:${stem}}\n\\end{figure}`;
    insertAtCursor(latex);
    try {
      // Persist the figure into the active file, then patch the preamble on the
      // saved content so the tikz libraries are present without losing the figure.
      await useFilesStore.getState().saveActive();
      await ensurePreamble();
      await writeFileContent(projectId, `figures/${stem}.tikz`, snippetCode);
      await useFilesStore.getState().refreshTree();
    } catch {
      /* snippet/preamble steps are best-effort; the code is already inserted */
    }
    toast.success("Diagram inserted as code.");
    setOpen(false);
  }, [projectId, stem, docCode, snippetCode, confirmOverwrite, ensurePreamble, setOpen]);

  const insertAsImage = useCallback(async () => {
    if (!projectId) return;
    if (!stem) { toast.error("Enter a name for the diagram first."); return; }
    if (!png) { toast.error("Compile the diagram first so there is an image to insert."); return; }
    if (!(await confirmOverwrite([`figures/${stem}.png`, `figures/${stem}.tikz`]))) return;
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      await writeProjectBytes(projectId, `figures/${stem}.png`, b64);
      await writeFileContent(projectId, `figures/${stem}.tikz`, snippetCode);
      await useFilesStore.getState().refreshTree();
    } catch (e) {
      toast.error(`Could not save the image: ${e}`);
      return;
    }
    const latex = `\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{figures/${stem}.png}\n\\caption{}\n\\label{fig:${stem}}\n\\end{figure}`;
    insertAtCursor(latex);
    toast.success("Diagram inserted as image.");
    setOpen(false);
  }, [projectId, stem, png, snippetCode, confirmOverwrite, setOpen]);

  // Re-open an existing figures/<name>.tikz to edit (round-trip drawn diagrams).
  const loadExisting = useCallback(async () => {
    if (!projectId || !stem) return;
    try {
      const content = await readFileContent(projectId, `figures/${stem}.tikz`);
      const m = parseEmbeddedModel(content);
      if (m) {
        setModel(m);
        setCode(modelToTikz(m));
        setBackground(m.background ?? "");
        setMode("draw");
        toast.success(`Loaded figures/${stem}.tikz for editing.`);
      } else {
        setCode(content);
        setMode("code");
        toast.success(`Loaded figures/${stem}.tikz (code only, not drawable).`);
      }
      setPng(null);
    } catch {
      toast.error(`No figures/${stem}.tikz to load.`);
    }
  }, [projectId, stem]);

  // Save the whole diagram (figure + TikZ + editor model) as a reusable image
  // project that appears on the home screen and re-opens in the image editor.
  const saveAsProject = useCallback(async () => {
    const src = buildStandaloneDoc({
      code: hasDrawing ? serializeDiagram({ ...model, background }) : code,
      libraries: DIAGRAM_LIBS,
      background,
    });
    try {
      await createImageProject(name.trim() || "Diagram", src);
      await useFilesStore.getState().refreshProjects();
      toast.success("Saved as an image project. Find it on your home screen.");
    } catch (e) {
      toast.error(`Could not save as project: ${e}`);
    }
  }, [name, model, code, hasDrawing, background]);

  // Ask the configured AI to fix a failed compile from the log. One-shot: it
  // returns corrected TikZ, which we drop into Code and recompile (undoable in
  // the editor).
  const [fixing, setFixing] = useState(false);
  const fixWithAi = useCallback(async () => {
    if (fixing) return;
    setFixing(true);
    try {
      const cfg = await getConfig();
      if (!hasConfiguredProvider(cfg)) {
        toast.error("Connect an AI provider in Settings to use Fix with AI.");
        return;
      }
      const { model: aiModel } = resolveActiveModel(cfg);
      const cur = hasDrawing && mode === "draw" ? modelToTikz(model) : code;
      const { text } = await generateText({
        model: aiModel,
        system:
          "You fix LaTeX/TikZ figure code so it compiles under Tectonic (XeLaTeX) in a standalone document with tikz + shapes.geometric, arrows.meta, positioning, calc loaded. Return ONLY the corrected figure body: the \\begin{tikzpicture}...\\end{tikzpicture} plus any \\definecolor lines. No preamble, no \\documentclass, no explanation, no markdown code fences. Never use em dashes.",
        prompt: `This TikZ figure failed to compile. Fix it.\n\nCODE:\n${cur}\n\nCOMPILE LOG (tail):\n${log.slice(-3000)}`,
      });
      const fixed = text
        .replace(/^```[a-zA-Z]*\n?/gm, "")
        .replace(/```$/gm, "")
        .trim();
      if (!fixed) {
        toast.error("The AI did not return a fix.");
        return;
      }
      setCode(fixed);
      setMode("code");
      toast.success("Applied an AI fix. Recompiling…");
      await compile(fixed);
    } catch (e) {
      toast.error(`Fix failed: ${e}`);
    } finally {
      setFixing(false);
    }
  }, [fixing, hasDrawing, mode, model, code, log, compile]);

  const compileFailed = !!log && !png;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Insert diagram"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-sidebar px-4 py-2.5">
        <h2 className="text-sm font-semibold">Insert diagram</h2>
        <div className="ml-2 flex items-center gap-1.5">
          <label htmlFor="diagram-name" className="text-xs text-muted-foreground">Name</label>
          <input
            id="diagram-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="diagram"
            className="w-48 rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:border-primary"
          />
          <Tooltip label={`Load figures/${stem || "name"}.tikz to edit`}>
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
        <div className="ml-auto flex items-center gap-2">
          {compileFailed && (
            <Tooltip label="Ask AI to fix the compile error">
              <Button variant="secondary" size="sm" onClick={() => void fixWithAi()} disabled={fixing}>
                {fixing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                Fix with AI
              </Button>
            </Tooltip>
          )}
          <Tooltip label="Save this diagram as a reusable image project">
            <Button variant="secondary" size="sm" onClick={() => void saveAsProject()}>
              <Save className="size-3.5" /> Save as project
            </Button>
          </Tooltip>
          <Button size="sm" onClick={() => void compile()} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Compile
          </Button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Tab bar (full width): Draw | Code, plus the snippet toolbar in Code. */}
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b bg-sidebar px-2">
        {(["draw", "code"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              // Entering Code: reflect the current drawing immediately (flush the
              // debounced generation) so Code always mirrors the canvas.
              if (m === "code" && hasDrawing) {
                if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
                setCode(modelToTikz(model));
              }
              setMode(m);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            {m === "draw" ? <MousePointerSquareDashed className="size-3.5" /> : <Code2 className="size-3.5" />}
            {m === "draw" ? "Draw" : "Code"}
          </button>
        ))}
        {mode === "code" && (
          <div className="ml-auto flex items-center gap-0.5">
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
          </div>
        )}
      </div>

      {/* Body: Draw uses the full width; Code splits code | preview. */}
      <div className="min-h-0 flex-1">
        {mode === "draw" ? (
          <DiagramCanvas model={model} onChange={onModelChange} />
        ) : (
          <div className="grid h-full grid-cols-2">
            <div className="min-h-0 border-r bg-background">
              <CmCodeEditor ref={cmRef} value={code} onChange={setCode} />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="flex h-[34px] shrink-0 items-center border-b px-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-sidebar p-3">
                {png ? (
                  <div className="flex h-full items-center justify-center">
                    <img src={png} alt="Diagram preview" className="max-h-full max-w-full object-contain" />
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
          </div>
        )}
      </div>

      {/* Footer: export options + insert actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t bg-sidebar px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">
            Saves the source to <code className="font-mono">figures/{stem || "name"}.tikz</code>{hasDrawing ? " (re-openable to edit)" : ""}.
          </p>
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
            <button
              type="button"
              onClick={() => setBackground("")}
              className={cn(
                "rounded-md border px-2 py-1 transition-colors",
                background === "" ? "border-primary/50 bg-primary/10 text-foreground" : "hover:bg-accent",
              )}
            >
              None
            </button>
            <input
              type="color"
              value={background || "#ffffff"}
              onChange={(e) => setBackground(e.target.value)}
              aria-label="Background color"
              title="Figure background color"
              className={cn(
                "h-7 w-9 cursor-pointer rounded border bg-background",
                background !== "" && "ring-2 ring-primary",
              )}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void insertAsCode()}>
              <Code2 className="size-3.5" /> Insert as code (vector)
            </Button>
            <Button size="sm" onClick={() => void insertAsImage()} disabled={!png}>
              <ImageIcon className="size-3.5" /> Insert as image (PNG)
            </Button>
          </div>
        </div>
      </div>
  );
}
