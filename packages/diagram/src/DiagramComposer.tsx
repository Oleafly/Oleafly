import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Download,
  FileDown,
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
  TextCursorInput,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Extension } from "@codemirror/state";
import { CmCodeEditor, type CmHandle } from "./CmCodeEditor";
import { DiagramCanvas } from "./DiagramCanvas";
import { type DiagramModel, emptyModel, buildStandaloneDoc, DIAGRAM_LIBS } from "@oleafly/latex";
import {
  drawnSync,
  emptySync,
  readSync,
  shouldPublishModel,
  shouldReadCode,
  shouldWriteCode,
  sourceToCompile,
  typedSync,
  type ComposerSync,
} from "./sync";
import { useDiagramKit } from "./kit";
import type { DiagramHost, DiagramRenderDiagnostic } from "./host";
import { cn } from "./cn";
import type { DiagramMessageKey, DiagramTranslator } from "./messages";
import { starterModel } from "./starter";
import {
  DIAGRAM_LANGUAGES,
  diagramLanguage,
  languageForPath,
  TYPST_PREVIEW_PREFIX_LINES,
  typstPageLine,
  typstPreviewDocument,
  type DiagramLanguage,
  type DiagramLanguageId,
  type DiagramNote,
  type DiagramRead,
  type DiagramSnippetId,
} from "./languages";
import { convertModel } from "./languages/convert";
import { pngWithDpi } from "./languages/png";
import { mermaidCodeFence as mermaidFence, mermaidFigurePath } from "./languages/mermaid-figure";

function CompileIcon({ busy, hasCompiled }: Readonly<{ busy: boolean; hasCompiled: boolean }>) {
  if (busy) return <Loader2 className="compile-shimmer-icon size-3.5" />;
  if (hasCompiled) return <RefreshCw className="size-3.5" />;
  return <Play className="size-3.5" />;
}

function compileLabel(t: DiagramTranslator, busy: boolean, hasCompiled: boolean): string {
  if (busy) return t("composer.compiling");
  if (hasCompiled) return t("composer.recompile");
  return t("composer.compile");
}

type CompileFailure = { kind: "failed" } | { kind: "package" } | { kind: "error"; detail: string };

const SAVE_TOAST_KEY = "diagram-save";

function errorDetail(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return String(e);
}

function failureText(t: DiagramTranslator, failure: CompileFailure): string {
  if (failure.kind === "error") return t("toast.compileError", { detail: failure.detail });
  if (failure.kind === "package") return t("toast.typstPackageMissing");
  return t("toast.compileFailed");
}

function DiagnosticList({
  diagnostics,
  onReveal,
  t,
}: Readonly<{
  diagnostics: DiagramRenderDiagnostic[];
  onReveal: (line: number, column: number | null) => void;
  t: DiagramTranslator;
}>) {
  return (
    <ul data-testid="diagram-diagnostics" className="flex flex-col gap-1">
      {diagnostics.map((diagnostic, index) => {
        const text =
          diagnostic.line === null
            ? diagnostic.message
            : t("preview.diagnosticAt", { line: diagnostic.line, message: diagnostic.message });
        return (
          <li key={`${index}:${diagnostic.message}`}>
            {diagnostic.line === null ? (
              <span className="block rounded-md border bg-muted/30 px-2 py-1 font-mono text-[0.6875rem] text-muted-foreground">
                {text}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onReveal(diagnostic.line as number, diagnostic.column)}
                className={cn(
                  "w-full rounded-md border bg-muted/30 px-2 py-1 text-left font-mono text-[0.6875rem] hover:bg-accent",
                  diagnostic.severity === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {text}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PreviewBody({
  busy,
  png,
  log,
  failure,
  diagnostics,
  background,
  onReveal,
  t,
}: Readonly<{
  busy: boolean;
  png: string | null;
  log: string;
  failure: CompileFailure | null;
  diagnostics: DiagramRenderDiagnostic[];
  background: string;
  onReveal: (line: number, column: number | null) => void;
  t: DiagramTranslator;
}>) {
  if (busy && !png && !log && diagnostics.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t("composer.compiling")}
      </div>
    );
  }
  const notice = failure ? (
    <p role="alert" data-testid="diagram-compile-failure" className="mb-2 shrink-0 text-xs text-destructive">
      {failureText(t, failure)}
    </p>
  ) : null;
  const details = diagnostics.length > 0 ? (
    <DiagnosticList diagnostics={diagnostics} onReveal={onReveal} t={t} />
  ) : null;
  if (png) {
    return (
      <div className="flex h-full flex-col">
        {notice}
        {details ? <div className="mb-2 shrink-0">{details}</div> : null}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <img
            src={png}
            alt={t("preview.alt")}
            className={cn(
              "max-h-full max-w-full object-contain",
              background === "" &&
                "bg-[length:16px_16px] bg-[linear-gradient(45deg,#252525_25%,transparent_25%,transparent_75%,#252525_75%,#252525),linear-gradient(45deg,#252525_25%,#333_25%,#333_75%,#252525_75%,#252525)] bg-[position:0_0,8px_8px]",
            )}
          />
        </div>
      </div>
    );
  }
  if (log || notice || details) {
    return (
      <>
        {notice}
        {details}
        {log && !details ? (
          <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[0.625rem] text-muted-foreground">{log}</pre>
        ) : null}
      </>
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
      {t("preview.empty")}
    </div>
  );
}

const SNIPPETS: { id: DiagramSnippetId; key: DiagramMessageKey; icon: ReactNode }[] = [
  { id: "rectangleNode", key: "snippets.rectangleNode", icon: <Square className="size-3.5" /> },
  { id: "circleNode", key: "snippets.circleNode", icon: <Circle className="size-3.5" /> },
  { id: "arrowEdge", key: "snippets.arrowEdge", icon: <MoveRight className="size-3.5" /> },
  { id: "lineEdge", key: "snippets.lineEdge", icon: <Minus className="size-3.5" /> },
  { id: "scope", key: "snippets.scope", icon: <Braces className="size-3.5" /> },
];

const INSERT_KEYS: Record<DiagramLanguageId, { label: DiagramMessageKey; done: DiagramMessageKey }> = {
  tikz: { label: "composer.insertLatex", done: "toast.insertedLatex" },
  typst: { label: "composer.insertTypst", done: "toast.insertedTypst" },
  mermaid: { label: "composer.insertMermaid", done: "toast.insertedMermaid" },
};

const FORMAT_KEYS: Record<DiagramLanguageId, DiagramMessageKey> = {
  tikz: "composer.formatTikz",
  typst: "composer.formatTypst",
  mermaid: "composer.formatMermaid",
};

const LABEL_KEYS: Record<DiagramLanguageId, DiagramMessageKey> = {
  tikz: "inspector.nodeLabel",
  typst: "inspector.nodeLabelTypst",
  mermaid: "inspector.edgeLabel",
};

const NOTE_HEADINGS: Record<DiagramNote["kind"], DiagramMessageKey> = {
  kept: "notes.keptHeading",
  approximated: "notes.approximatedHeading",
  dropped: "notes.droppedHeading",
};

const IMPORT_ACCEPT = [...new Set(Object.values(DIAGRAM_LANGUAGES).flatMap((language) => language.importExtensions))].join(",");

function trimDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") start++;
  while (end > start && value[end - 1] === "-") end--;
  return value.slice(start, end);
}

function utf8Base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

export function safeName(name: string): string {
  return trimDashes(name.trim().replace(/[^A-Za-z0-9_-]+/g, "-")).slice(0, 64);
}

function readNow(language: DiagramLanguage, source: string, hint: DiagramModel | null): DiagramRead {
  try {
    return language.read(source, { hint });
  } catch {
    return { model: null, extras: null, notes: [] };
  }
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
  languageExtensions,
  isMac = false,
  fullscreen = false,
  forcePreviewOpen = false,
  brand,
  windowControls,
  language: requestedLanguage = "tikz",
  languageRequest = 0,
}: Readonly<{
  open: boolean;
  projectId: string | null;
  projectName?: string | null;
  onClose: () => void;
  host: DiagramHost;
  codeExtensions?: Extension[];
  languageExtensions?: Partial<Record<DiagramLanguageId, Extension[]>>;
  isMac?: boolean;
  fullscreen?: boolean;
  // Opens the preview pane and compiles the current drawing once so there is
  // something in it. Lets an app-level caller (e.g. a product tour) point at
  // a real compiled preview instead of describing UI that isn't there.
  forcePreviewOpen?: boolean;
  // App-supplied brand/back element, rendered in place of the default back
  // button + title so this matches the app's own project toolbar.
  brand?: ReactNode;
  // App-supplied OS window controls (min/max/close), rendered at the far right
  // of the toolbar on platforms that draw a frameless window (e.g. Windows).
  windowControls?: ReactNode;
  language?: DiagramLanguageId;
  languageRequest?: number;
}>) {
  const { Button, Input, ColorPicker, Tooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast, t } =
    useDiagramKit();

  const [language, setLanguage] = useState<DiagramLanguageId>(requestedLanguage);
  const lang = diagramLanguage(language);
  const languageRef = useRef(language);
  languageRef.current = language;
  const extrasRef = useRef<unknown>(null);
  const [notes, setNotes] = useState<DiagramNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [initial] = useState(() => {
    const drawing = starterModel();
    return { model: drawing, code: diagramLanguage(requestedLanguage).write(drawing) };
  });
  const [mode, setMode] = useState<Mode>("draw");
  const [model, setModel] = useState<DiagramModel>(initial.model);
  const [code, setCode] = useState<string>(initial.code);
  const [name, setName] = useState("diagram");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("diagram");
  const nameEditRef = useRef<HTMLSpanElement>(null);
  const [png, setPng] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagramRenderDiagnostic[]>([]);
  const [failure, setFailure] = useState<CompileFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasCompiled, setHasCompiled] = useState(false);
  const [scale, setScale] = useState(2);
  // Figure page background: hex "#RRGGBB", or "" for transparent. Default white.
  const [background, setBackground] = useState("#ffffff");
  // Preview is on-demand (not realtime): open after Compile, hide when minimized.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingLine, setPendingLine] = useState<{ line: number; column: number | null } | null>(null);
  const cmRef = useRef<CmHandle>(null);
  const codeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the code buffer holds hand-written content the drawing model
  // does not describe. While set, nothing may regenerate code from the model:
  // that is how pasted TikZ used to be silently replaced on a tab switch.
  // Which side owns the buffer, and what the model was last read out of, so a
  // Draw/Code round trip neither re-parses needlessly nor loses canvas edits.
  const syncRef = useRef<ComposerSync>(emptySync());
  const savePickerRef = useRef<HTMLDivElement>(null);
  const downloadPickerRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  const stem = useMemo(() => safeName(name), [name]);
  const hasDrawing = model.nodes.length > 0;
  const insertTarget = host.insertTarget?.() ?? null;
  const canInsert =
    insertTarget !== null && (hasDrawing || (insertTarget.language === language && code.trim() !== ""));

  const typstVersion = useCallback(() => host.typstContext?.()?.typstVersion ?? null, [host]);

  const writeCode = useCallback(
    (m: DiagramModel, id: DiagramLanguageId = languageRef.current) =>
      diagramLanguage(id).write(m, {
        extras: id === languageRef.current ? extrasRef.current : null,
        typstVersion: typstVersion(),
      }),
    [typstVersion],
  );

  useEffect(() => {
    void lang.load().catch(() => undefined);
  }, [lang]);

  // Model -> code (debounced), so the Code tab and compile reflect the drawing.
  const onModelChange = useCallback((m: DiagramModel) => {
    if (!shouldPublishModel(syncRef.current, m)) return;
    syncRef.current = drawnSync(syncRef.current);
    setModel(m);
    if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
    codeTimerRef.current = setTimeout(() => {
      syncRef.current = emptySync();
      setCode(writeCode(m));
      if (languageRef.current === "tikz") {
        extrasRef.current = null;
        setNotes([]);
      }
    }, 200);
  }, [writeCode]);

  const adoptRead = useCallback((read: DiagramRead) => {
    extrasRef.current = read.extras;
    setNotes(read.notes);
  }, []);

  const applyLoadedContent = useCallback(async (content: string, id: DiagramLanguageId, nextBackground?: string) => {
    // A React Flow change can leave a debounced model-to-code update pending.
    // Imported/loaded content is authoritative, so cancel that older write
    // before replacing the editor document.
    if (codeTimerRef.current) {
      clearTimeout(codeTimerRef.current);
      codeTimerRef.current = null;
    }
    const target = diagramLanguage(id);
    await target.load().catch(() => undefined);
    const read = readNow(target, content, null);
    adoptRead(read);
    setCode(content);
    setPng(null);
    setSvg(null);
    if (!read.model) {
      syncRef.current = readSync(content, null);
      setMode("code");
      return false;
    }
    // The buffer stays exactly as written: the model describes it, so nothing
    // regenerates over it until the canvas itself is edited.
    syncRef.current = readSync(content, read.model);
    setModel(read.model);
    // Keep "" (transparent) if the source stored it; a snippet that says
    // nothing about the page leaves the current background alone.
    const loadedBackground = nextBackground ?? read.model.background;
    if (loadedBackground !== undefined) setBackground(loadedBackground);
    setMode("draw");
    return true;
  }, [adoptRead]);

  const handleCodeChange = useCallback((next: string) => {
    // Typing takes the buffer back, so a pending regeneration must not land on
    // top of the keystrokes that follow it.
    if (codeTimerRef.current) {
      clearTimeout(codeTimerRef.current);
      codeTimerRef.current = null;
    }
    syncRef.current = typedSync(syncRef.current);
    setCode(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const resetPreview = useCallback(() => {
    setPng(null);
    setSvg(null);
    setLog("");
    setDiagnostics([]);
    setFailure(null);
    setHasCompiled(false);
    setPreviewOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetPreview();
  }, [open, resetPreview]);

  const currentDrawing = useCallback((): DiagramModel | null => {
    if (!shouldReadCode(syncRef.current, code)) return model;
    if (!lang.ready()) return null;
    return readNow(lang, code, model).model;
  }, [code, model, lang]);

  const switchLanguage = useCallback(async (next: DiagramLanguageId) => {
    const from = languageRef.current;
    if (next === from) return;
    await lang.load().catch(() => undefined);
    const drawing = currentDrawing();
    const handWritten = syncRef.current.codeDirty && !syncRef.current.canvasAhead;
    const loses = handWritten && (!drawing || notes.some((item) => item.kind !== "approximated"));
    if (loses && !window.confirm(t("confirm.switchLanguage", { from: lang.name, to: diagramLanguage(next).name }))) return;
    if (codeTimerRef.current) {
      clearTimeout(codeTimerRef.current);
      codeTimerRef.current = null;
    }
    const converted = await convertModel(drawing ?? emptyModel(), from, next);
    extrasRef.current = null;
    languageRef.current = next;
    setNotes([]);
    syncRef.current = emptySync();
    setLanguage(next);
    setModel(converted);
    setCode(diagramLanguage(next).write(converted, { typstVersion: typstVersion() }));
    resetPreview();
  }, [lang, currentDrawing, notes, t, typstVersion, resetPreview]);

  const lastRequest = useRef(languageRequest);
  useEffect(() => {
    if (!open || lastRequest.current === languageRequest) return;
    lastRequest.current = languageRequest;
    void switchLanguage(requestedLanguage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, languageRequest, requestedLanguage]);

  const compileTypst = useCallback(async (raw: string, nextBackground: string) => {
    if (!host.renderTypst) throw new Error(t("toast.previewUnavailable"));
    const context = host.typstContext?.();
    const result = await host.renderTypst({
      source: typstPreviewDocument(raw, nextBackground),
      format: "png",
      ppi: Math.round(72 * scale),
      projectId: context?.projectId ?? null,
      document: true,
    });
    const mapped = result.diagnostics.map((diagnostic) => {
      const line = diagnostic.line === null ? null : diagnostic.line - TYPST_PREVIEW_PREFIX_LINES;
      return { ...diagnostic, line: line !== null && line > 0 ? line : null };
    });
    setDiagnostics(mapped);
    setLog(mapped.map((d) => (d.line === null ? d.message : `line ${d.line}, column ${d.column ?? 1}: ${d.message}`)).join("\n"));
    if (result.status === "rendered") {
      setPng(result.image.format === "png" ? `data:image/png;base64,${result.image.pngBase64}` : null);
      return;
    }
    setPng(null);
    const missingPackage =
      raw.includes("@preview/") && mapped.some((d) => /download|package not found|failed to load package/i.test(d.message));
    setFailure(missingPackage ? { kind: "package" } : { kind: "failed" });
  }, [host, scale, t]);

  const compileMermaid = useCallback(async (raw: string, nextBackground: string) => {
    if (!host.renderMermaid) throw new Error(t("toast.previewUnavailable"));
    try {
      const rendered = await host.renderMermaid(raw, { scale, background: nextBackground });
      setPng(`data:image/png;base64,${rendered.pngBase64}`);
      setSvg(rendered.svg);
    } catch (e) {
      const message = errorDetail(e);
      const line = /line (\d+)/i.exec(message);
      const diagnostic = { severity: "error" as const, message, line: line ? Number(line[1]) : null, column: null };
      setDiagnostics([diagnostic]);
      setLog(message);
      setPng(null);
      setSvg(null);
      setFailure({ kind: "failed" });
    }
  }, [host, scale, t]);

  const compileTikz = useCallback(async (raw: string, nextBackground: string) => {
    if (!projectId) return;
    const source = buildStandaloneDoc({
      code: raw,
      libraries: DIAGRAM_LIBS,
      background: nextBackground,
    });
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
      setFailure({ kind: "failed" });
    }
  }, [projectId, host, scale]);

  const compile = useCallback(async (overrideCode?: string, overrideBackground?: string) => {
    if (!projectId || busy) return;
    // In draw mode the code is debounced; compile the freshest generated TikZ.
    const raw = overrideCode ?? sourceToCompile(syncRef.current, mode, model, code, (m) => writeCode(m));
    const nextBackground = overrideBackground ?? background;
    setBusy(true);
    setLog("");
    setDiagnostics([]);
    setFailure(null);
    setPreviewOpen(true);
    try {
      if (language === "typst") await compileTypst(raw, nextBackground);
      else if (language === "mermaid") await compileMermaid(raw, nextBackground);
      else await compileTikz(raw, nextBackground);
    } catch (e) {
      setFailure({ kind: "error", detail: errorDetail(e) });
    } finally {
      setBusy(false);
      setHasCompiled(true);
    }
  }, [projectId, busy, code, model, mode, background, language, writeCode, compileTypst, compileMermaid, compileTikz]);

  // When a caller (the product tour) forces the preview pane open, compile the
  // starter drawing once so the pane demonstrates a real preview instead of
  // the empty "Compile to see a preview" placeholder. Compiles are isolated
  // and never touch the user's document, so this is safe to do unprompted.
  useEffect(() => {
    if (!forcePreviewOpen || hasCompiled || busy) return;
    void compile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcePreviewOpen]);

  const confirmOverwrite = useCallback(
    async (targetProject: string, paths: string[]): Promise<boolean> => {
      try {
        const files = await host.listFiles(targetProject);
        const existing = new Set(files.map((f) => f.path));
        const clash = paths.filter((p) => existing.has(p));
        if (clash.length === 0) return true;
        return window.confirm(t("confirm.overwrite", { files: clash.join(", ") }));
      } catch {
        return true;
      }
    },
    [host, t],
  );

  const canvasOwnsCode = shouldWriteCode(syncRef.current, hasDrawing);
  const withBackground = useCallback((m: DiagramModel): DiagramModel => ({ ...m, background }), [background]);

  const sourceIn = useCallback(async (target: DiagramLanguageId, kind: "file" | "snippet"): Promise<string | null> => {
    const targetLanguage = diagramLanguage(target);
    if (target === language) {
      if (!canvasOwnsCode) return code;
      const options = { extras: extrasRef.current, typstVersion: typstVersion() };
      if (kind === "snippet" && target !== "tikz") return lang.write(model, options);
      return lang.fileSource(withBackground(model), options);
    }
    const drawing = currentDrawing();
    if (!drawing || drawing.nodes.length === 0) return null;
    const converted = await convertModel(drawing, language, target);
    const options = { typstVersion: typstVersion() };
    return kind === "file" ? targetLanguage.fileSource(converted, options) : targetLanguage.write(converted, options);
  }, [language, lang, canvasOwnsCode, code, model, currentDrawing, withBackground, typstVersion]);

  const [savePickerOpen, setSavePickerOpen] = useState(false);
  const [saveToProjectHover, setSaveToProjectHover] = useState(false);
  const [projectPicks, setProjectPicks] = useState<{ id: string; name: string; typst?: boolean; language?: DiagramLanguageId }[]>([]);

  const openSavePicker = useCallback(async () => {
    if (!png && !canInsert) { toast.error(t("toast.compileBeforeSave")); return; }
    const picks = await host.listProjectNames().catch(() => [] as { id: string; name: string }[]);
    setProjectPicks(picks);
    setSavePickerOpen(true);
  }, [png, canInsert, host, toast, t]);

  const renderMermaidPng = useCallback(async (source: string) => {
    if (!host.renderMermaid) return null;
    const rendered = await host.renderMermaid(source, { scale: 2, background: background || "#ffffff" });
    return { png: pngWithDpi(rendered.pngBase64, 192), svg: rendered.svg };
  }, [host, background]);

  const writeMermaidFigure = useCallback(async (targetProject: string, source: string) => {
    const rendered = await renderMermaidPng(source).catch(() => null);
    if (!rendered) return;
    await host.writeProjectBytes(targetProject, mermaidFigurePath(source), rendered.png);
  }, [host, renderMermaidPng]);

  const insertIntoDocument = useCallback(async () => {
    setSavePickerOpen(false);
    const target = host.insertTarget?.();
    if (!target) return;
    const source = (await sourceIn(target.language, "snippet"))?.trim() ?? "";
    if (!source) {
      toast.info(t("toast.notDrawable"));
      return;
    }
    const targetLanguage = diagramLanguage(target.language);
    if (target.language === "mermaid") {
      await writeMermaidFigure(target.projectId, source).catch(() => undefined);
      await host.refreshTree().catch(() => undefined);
      host.insertAtCursor(`${mermaidFence(source)}\n`);
    } else {
      host.insertAtCursor(targetLanguage.insertText(source));
    }
    toast.successUnique(SAVE_TOAST_KEY, t(INSERT_KEYS[target.language].done));
  }, [host, sourceIn, writeMermaidFigure, toast, t]);

  const savingRef = useRef(false);
  const runSave = useCallback(async (save: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await save();
    } finally {
      savingRef.current = false;
    }
  }, []);

  const saveToExistingProject = useCallback((pick: { id: string; typst?: boolean; language?: DiagramLanguageId }) => runSave(async () => {
    if (!stem) { toast.error(t("toast.nameRequired")); return; }
    if (!png) { toast.error(t("toast.compileBeforeSave")); return; }
    const preferred = pick.language ?? (pick.typst ? "typst" : "tikz");
    const converted = await sourceIn(preferred, "file");
    const target = converted === null ? language : preferred;
    const content = converted ?? code;
    const sourcePath = `figures/${stem}.${diagramLanguage(target).extension}`;
    const svgPath = target === "mermaid" && language === "mermaid" && svg ? `figures/${stem}.svg` : null;
    const paths = [`figures/${stem}.png`, sourcePath, ...(svgPath ? [svgPath] : [])];
    if (!(await confirmOverwrite(pick.id, paths))) return;
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      await host.writeProjectBytes(pick.id, `figures/${stem}.png`, b64);
      await host.writeFileContent(pick.id, sourcePath, content);
      if (svgPath && svg) await host.writeFileContent(pick.id, svgPath, svg);
      await host.refreshTree().catch(() => undefined);
      let message = t("toast.savedToProject", { path: `figures/${stem}.png` });
      if (target === "typst") message = t("toast.savedTypstToProject", { path: sourcePath });
      if (target === "mermaid") message = t("toast.savedMermaidToProject", { path: sourcePath });
      toast.successUnique(SAVE_TOAST_KEY, message);
    } catch (e) {
      toast.errorUnique(SAVE_TOAST_KEY, t("toast.saveFailed", { detail: errorDetail(e) }));
    } finally {
      setSavePickerOpen(false);
    }
  }), [stem, png, svg, code, language, sourceIn, confirmOverwrite, runSave, host, toast, t]);

  const newProjectSource = useCallback((): { source: string; block: string | null } => {
    if (language === "tikz") {
      const source = buildStandaloneDoc({
        code: canvasOwnsCode ? lang.fileSource(withBackground(model)) : code,
        libraries: DIAGRAM_LIBS,
        background,
      });
      return { source, block: null };
    }
    const options = { extras: extrasRef.current, typstVersion: typstVersion() };
    if (language === "typst") {
      const source = canvasOwnsCode
        ? lang.standaloneSource(withBackground(model), options)
        : `${typstPageLine(background)}\n${code.trim()}\n`;
      return { source, block: null };
    }
    const block = canvasOwnsCode ? lang.fileSource(withBackground(model), options) : code;
    return { source: `${mermaidFence(block)}\n`, block };
  }, [language, lang, canvasOwnsCode, model, code, background, withBackground, typstVersion]);

  const saveAsNewProject = useCallback(() => runSave(async () => {
    const { source: src, block } = newProjectSource();
    const targetName = name.trim() || t("composer.untitledName");
    try {
      const created = await host.createDiagramProject(targetName, src, language);
      if (block !== null) await writeMermaidFigure(created, block).catch(() => undefined);
      await host.refreshProjects().catch(() => undefined);
      toast.successUnique(SAVE_TOAST_KEY, t("toast.savedAsProject"));
    } catch (e) {
      toast.errorUnique(SAVE_TOAST_KEY, t("toast.saveAsProjectFailed", { detail: errorDetail(e) }));
    } finally {
      setSavePickerOpen(false);
    }
  }), [name, language, newProjectSource, writeMermaidFigure, runSave, host, toast, t]);

  const saveFigureGlobally = useCallback(() => runSave(async () => {
    if (!stem) { toast.error(t("toast.nameRequired")); return; }
    if (!png) { toast.error(t("toast.compileBeforeSave")); return; }
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      const tikz = (await sourceIn("tikz", "file")) ?? code;
      const result = await host.saveFigureToCache(stem, b64, tikz);
      toast.successUnique(
        SAVE_TOAST_KEY,
        result.alreadyCached ? t("toast.figureCached") : t("toast.figureSaved"),
      );
    } catch (e) {
      toast.errorUnique(SAVE_TOAST_KEY, t("toast.saveFigureFailed", { detail: errorDetail(e) }));
    } finally {
      setSavePickerOpen(false);
    }
  }), [stem, png, code, sourceIn, runSave, host, toast, t]);

  const [downloadPickerOpen, setDownloadPickerOpen] = useState(false);

  const saveDownload = useCallback(async (extension: string, base64: string) => {
    try {
      const saved = await host.saveBytesToDisk(stem || "diagram", extension, base64);
      if (saved) toast.successUnique(SAVE_TOAST_KEY, t("toast.downloaded"));
    } catch (e) {
      toast.errorUnique(SAVE_TOAST_KEY, t("toast.saveFigureFailed", { detail: errorDetail(e) }));
    }
  }, [stem, host, toast, t]);

  const downloadPng = useCallback(async () => {
    if (!png) { toast.error(t("toast.compileBeforeDownload")); return; }
    setDownloadPickerOpen(false);
    await saveDownload("png", png.slice(png.indexOf(",") + 1));
  }, [png, saveDownload, toast, t]);

  const vectorSvg = useCallback(async (): Promise<string | null> => {
    const raw = sourceToCompile(syncRef.current, mode, model, code, (m) => writeCode(m));
    if (language === "mermaid") {
      if (svg && png) return svg;
      return host.renderMermaid ? (await host.renderMermaid(raw, { scale, background })).svg : null;
    }
    if (language !== "typst" || !host.renderTypst) return null;
    const result = await host.renderTypst({
      source: typstPreviewDocument(raw, background),
      format: "svg",
      projectId: host.typstContext?.()?.projectId ?? null,
      document: true,
    });
    return result.status === "rendered" && result.image.format === "svg" ? result.image.svg : null;
  }, [mode, model, code, language, svg, png, scale, background, host, writeCode]);

  const downloadSvg = useCallback(async () => {
    setDownloadPickerOpen(false);
    try {
      const vector = await vectorSvg();
      if (!vector) {
        toast.error(t("toast.compileBeforeDownload"));
        return;
      }
      await saveDownload("svg", utf8Base64(vector));
    } catch (e) {
      toast.errorUnique(SAVE_TOAST_KEY, t("toast.saveFigureFailed", { detail: errorDetail(e) }));
    }
  }, [vectorSvg, saveDownload, toast, t]);

  const downloadSource = useCallback(async (target: DiagramLanguageId) => {
    setDownloadPickerOpen(false);
    const source = await sourceIn(target, "file");
    if (!source?.trim()) {
      toast.info(t("toast.notDrawable"));
      return;
    }
    await saveDownload(diagramLanguage(target).extension, utf8Base64(source));
  }, [sourceIn, saveDownload, toast, t]);

  const [importing, setImporting] = useState(false);
  const importDiagramFile = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const picked = await host.pickTikzFile(IMPORT_ACCEPT);
      if (!picked) return;
      const target = languageForPath(picked.name) ?? languageRef.current;
      const targetLanguage = diagramLanguage(target);
      const fileCode = targetLanguage.fromFile(picked.name, picked.content);
      const standalone = targetLanguage.fromStandalone(fileCode);
      if (target !== languageRef.current) {
        extrasRef.current = null;
        languageRef.current = target;
        setLanguage(target);
        resetPreview();
      }
      const drawable = await applyLoadedContent(standalone.code, target, standalone.background);
      const importedName = safeName(picked.name.replace(/\.(tikz|tex|typ|mmd|md|markdown)$/i, ""));
      if (importedName) {
        setName(importedName);
        setNameDraft(importedName);
      }
      toast.success(
        drawable
          ? t("toast.imported", { name: picked.name })
          : t("toast.importedCodeOnly", { name: picked.name }),
      );
    } catch (e) {
      toast.error(t("toast.importFailed", { detail: errorDetail(e) }));
    } finally {
      setImporting(false);
    }
  }, [importing, host, toast, t, applyLoadedContent, resetPreview]);

  // Ask the configured AI to fix a failed compile from the log. One-shot: it
  // returns corrected TikZ, which we drop into Code and recompile (undoable in
  // the editor).
  const [fixing, setFixing] = useState(false);
  const fixWithAi = useCallback(async () => {
    if (fixing || !host.fixWithAi) return;
    setFixing(true);
    try {
      const cur = sourceToCompile(syncRef.current, mode, model, code, (m) => writeCode(m));
      const tail = log.slice(-3000);
      const fixed = await host.fixWithAi(cur, tail, lang.fixPrompt(cur, tail));
      if (!fixed) {
        toast.error(t("toast.noAiFix"));
        return;
      }
      syncRef.current = readSync(fixed, null);
      setCode(fixed);
      setMode("code");
      await compile(fixed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.fixFailed", { detail: errorDetail(e) }));
    } finally {
      setFixing(false);
    }
  }, [fixing, mode, model, code, log, lang, compile, writeCode, host, toast, t]);

  const compileFailed = failure?.kind === "failed";

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

  useLayoutEffect(() => {
    if (!savePickerOpen && !downloadPickerOpen && !notesOpen) return;
    const onDown = (e: MouseEvent) => {
      if (savePickerOpen && savePickerRef.current && !savePickerRef.current.contains(e.target as Node)) {
        setSavePickerOpen(false);
      }
      if (downloadPickerOpen && downloadPickerRef.current && !downloadPickerRef.current.contains(e.target as Node)) {
        setDownloadPickerOpen(false);
      }
      if (notesOpen && notesRef.current && !notesRef.current.contains(e.target as Node)) {
        setNotesOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [savePickerOpen, downloadPickerOpen, notesOpen]);

  useEffect(() => {
    if (mode !== "code" || !pendingLine || !cmRef.current) return;
    cmRef.current.revealLine(pendingLine.line, pendingLine.column);
    setPendingLine(null);
  }, [mode, pendingLine]);

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

  const diagramExt = lang.extension;
  const displayFile = `${stem || "diagram"}.${diagramExt}`;

  if (!open) return null;

  const enterCode = () => {
    // Entering Code: flush debounced generation so Code mirrors the canvas,
    // but never over hand-written code the model does describe.
    if (shouldWriteCode(syncRef.current, hasDrawing)) {
      if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
      setCode(writeCode(model));
    }
    setMode("code");
  };

  const enterDraw = () => {
    // Entering Draw with hand-written code: read the TikZ into a model so the
    // canvas shows what the code says. Re-reading the same buffer is skipped so
    // canvas edits made since the last adoption survive the round trip.
    if (!shouldReadCode(syncRef.current, code)) {
      setMode("draw");
      return;
    }
    if (codeTimerRef.current) {
      clearTimeout(codeTimerRef.current);
      codeTimerRef.current = null;
    }
    const read = readNow(lang, code, model);
    adoptRead(read);
    syncRef.current = readSync(code, read.model);
    setModel(read.model ?? emptyModel());
    if (read.model) {
      if (read.model.background !== undefined) setBackground(read.model.background);
    } else {
      toast.info(t("toast.notDrawable"));
    }
    setMode("draw");
  };

  const switchMode = (m: Mode) => {
    if (m === "code") {
      enterCode();
      return;
    }
    if (lang.ready()) {
      enterDraw();
      return;
    }
    void lang.load().then(enterDraw, () => toast.error(t("toast.readerUnavailable")));
  };

  const revealLine = (line: number, column: number | null) => {
    setPendingLine({ line, column });
    if (mode !== "code") switchMode("code");
  };

  const hasPreviewResult = !!(png || log || failure || diagnostics.length > 0);
  const showPreview = previewOpen || forcePreviewOpen;
  const languageExtensionsFor = languageExtensions?.[language] ?? (language === "tikz" ? codeExtensions : undefined);

  const renderPreviewOpts = () => (
    <>
      <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
        {t("preview.pngScale")}
        <Select value={String(scale)} onValueChange={(v) => setScale(Number(v))}>
          <SelectTrigger className="h-7 w-16 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {[1, 2, 3].map((factor) => (
              <SelectItem key={factor} value={String(factor)} className="text-xs">
                {t("preview.scaleFactor", { factor })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
        {t("preview.background")}
        <ColorPicker
          value={background}
          allowTransparent
          ariaLabel={t("preview.backgroundLabel")}
          onChange={(value) => {
            setBackground(value);
            if (!value) void compile(undefined, "");
          }}
        />
      </div>
    </>
  );

  const menuItem = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent";

  const renderSaveMenu = () => (
    <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-background p-1 shadow-lg">
      {canInsert && insertTarget && (
        <>
          <button
            type="button"
            data-testid={`diagram-insert-${insertTarget.language === "tikz" ? "latex" : insertTarget.language}`}
            onClick={() => void insertIntoDocument()}
            className={menuItem}
          >
            <TextCursorInput className="size-3.5" /> {t(INSERT_KEYS[insertTarget.language].label)}
          </button>
          <div className="my-1 border-t" />
        </>
      )}
      <div
        className="relative"
        onMouseEnter={() => setSaveToProjectHover(true)}
        onMouseLeave={() => setSaveToProjectHover(false)}
      >
        <button type="button" data-testid="diagram-save-to-project" className={menuItem}>
          <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex flex-1 items-center justify-end gap-2">
            {t("composer.saveToProject")} <FolderOpen className="size-3.5" />
          </span>
        </button>
        {saveToProjectHover && (
          <div className="absolute right-full top-0 z-30 mr-1 w-64 rounded-md border bg-background p-2 shadow-lg">
            <button type="button" onClick={() => void saveAsNewProject()} className={menuItem}>
              <Save className="size-3.5" /> {t("composer.newProject")}
            </button>
            <div className="my-1 border-t" />
            <div className="max-h-40 overflow-auto">
              {projectPicks.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("composer.noOtherProjects")}</div>
              ) : (
                projectPicks.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void saveToExistingProject(p)}
                    className={cn(menuItem, "truncate")}
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
      <button type="button" onClick={() => void saveFigureGlobally()} className={menuItem}>
        <Save className="size-3.5" /> {t("composer.saveFigure")}
      </button>
    </div>
  );

  const renderDownloadMenu = () => (
    <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border bg-background p-1 shadow-lg">
      <button type="button" onClick={() => void downloadPng()} className={menuItem}>
        {t("composer.formatPng")}
      </button>
      {lang.vector ? (
        <button type="button" data-testid="diagram-download-svg" onClick={() => void downloadSvg()} className={menuItem}>
          {t("composer.formatSvg")}
        </button>
      ) : (
        <Tooltip label={t("composer.svgTooltip")}>
          <button
            type="button"
            disabled
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground/50"
          >
            {t("composer.formatSvgSoon")}
          </button>
        </Tooltip>
      )}
      <div className="my-1 border-t" />
      {(["tikz", "typst", "mermaid"] as const).map((target) => (
        <button
          key={target}
          type="button"
          data-testid={`diagram-download-${target}`}
          onClick={() => void downloadSource(target)}
          className={menuItem}
        >
          {t(FORMAT_KEYS[target])}
        </button>
      ))}
    </div>
  );

  const renderComposerActions = () => (
    <div className="ml-auto flex items-center gap-2">
      {compileFailed && host.fixWithAi && (
        <Tooltip label={t("composer.fixWithAiTooltip")}>
          <Button variant="secondary" size="sm" onClick={() => void fixWithAi()} disabled={fixing}>
            {fixing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {t("composer.fixWithAi")}
          </Button>
        </Tooltip>
      )}
      <Button data-tour="diagram-compile" data-testid="diagram-compile" size="sm" onClick={() => void compile()} disabled={busy}>
        <CompileIcon busy={busy} hasCompiled={hasCompiled} />
        <span className={busy ? "ai-shimmer" : undefined}>
          {compileLabel(t, busy, hasCompiled)}
        </span>
      </Button>
      <div className="relative" ref={savePickerRef}>
        <Tooltip label={t("composer.saveTooltip")}>
          <Button
            data-tour="diagram-save-project"
            variant="ghost"
            size="sm"
            aria-label={t("composer.save")}
            onClick={() => void openSavePicker()}
          >
            <Save className="size-3.5" />
            <ChevronRight className="size-3 rotate-90" />
          </Button>
        </Tooltip>
        {savePickerOpen && renderSaveMenu()}
      </div>
      <div className="relative" ref={downloadPickerRef}>
        <Tooltip label={t("composer.downloadTooltip")}>
          <Button
            variant="ghost"
            size="sm"
            data-tour="diagram-download"
            aria-label={t("composer.download")}
            onClick={() => setDownloadPickerOpen((v) => !v)}
          >
            <Download className="size-3.5" />
            <ChevronRight className="size-3 rotate-90" />
          </Button>
        </Tooltip>
        {downloadPickerOpen && renderDownloadMenu()}
      </div>
    </div>
  );

  const renderComposerPreviewPane = () => (
    showPreview && (
      <div data-tour="diagram-preview-panel" className="flex min-h-0 min-w-0 flex-col">
        <div className="flex min-h-[34px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-sidebar px-3 py-1">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">{t("preview.label")}</span>
          {renderPreviewOpts()}
          <div className="ml-auto flex items-center gap-1">
            {busy && (
              <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t("composer.compiling")}
              </span>
            )}
            <Tooltip label={t("preview.minimize")}>
              <button
                type="button"
                aria-label={t("preview.minimize")}
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
          <PreviewBody
            busy={busy}
            png={png}
            log={log}
            failure={failure}
            diagnostics={diagnostics}
            background={background}
            onReveal={revealLine}
            t={t}
          />
        </div>
      </div>
    )
  );

  const renderComposerEditorPane = () => (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showPreview && "border-r")}>
      {mode === "draw" ? (
        <DiagramCanvas
          model={model}
          onChange={onModelChange}
          showPreviewAction={hasPreviewResult && !showPreview}
          onShowPreview={() => setPreviewOpen(true)}
          seeds={lang.seeds}
          labelKey={LABEL_KEYS[language]}
        />
      ) : (
        <>
          <div className="flex h-[34px] shrink-0 items-center gap-0.5 border-b bg-sidebar px-2">
            <span className="mr-1 text-[0.6875rem] text-muted-foreground">{t("composer.snippets")}</span>
            {SNIPPETS.map((s) => {
              const key = s.id === "scope" && language !== "tikz" ? "snippets.group" : s.key;
              return (
                <Tooltip key={s.id} label={t(key)} side="bottom">
                  <button
                    type="button"
                    aria-label={t(key)}
                    onClick={() => cmRef.current?.insert(lang.snippets[s.id])}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {s.icon}
                  </button>
                </Tooltip>
              );
            })}
            {hasPreviewResult && !showPreview && (
              <div className="ml-auto">
                <Tooltip label={t("preview.showTooltip")}>
                  <button
                    type="button"
                    aria-label={t("preview.showLabel")}
                    onClick={() => setPreviewOpen(true)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <PanelRightOpen className="size-3.5" />
                    {t("preview.label")}
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 bg-background">
            <CmCodeEditor key={language} ref={cmRef} value={code} onChange={handleCodeChange} extensions={languageExtensionsFor} />
          </div>
        </>
      )}
    </div>
  );

  const renderNotes = () => (
    notes.length > 0 && (
      <div className="relative" ref={notesRef}>
        <Tooltip label={t("notes.tooltip")}>
          <button
            type="button"
            data-testid="diagram-notes"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((value) => !value)}
            className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[0.6875rem] text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            <TriangleAlert className="size-3" />
            {t("notes.count", { count: notes.length })}
          </button>
        </Tooltip>
        {notesOpen && (
          <div
            data-testid="diagram-notes-list"
            className="absolute left-0 top-full z-30 mt-1 w-80 rounded-md border bg-background p-2 text-xs shadow-lg"
          >
            {(["kept", "approximated", "dropped"] as const).map((kind) => {
              const items = notes.filter((item) => item.kind === kind);
              if (items.length === 0) return null;
              return (
                <div key={kind} className="mb-2 last:mb-0">
                  <p className="mb-1 font-medium text-foreground">{t(NOTE_HEADINGS[kind])}</p>
                  <ul className="flex flex-col gap-0.5 text-muted-foreground">
                    {items.map((item) => (
                      <li key={`${item.code}:${item.detail ?? ""}`}>
                        {t(`notes.${item.code}` as DiagramMessageKey, { detail: item.detail ?? "" })}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )
  );

  const renderComposerTitle = () => (
    <div className="flex min-w-0 items-center gap-1">
      {editingName ? (
        <span ref={nameEditRef} className="flex items-center gap-1">
          <Input
            id="diagram-name"
            aria-label={t("composer.nameLabel")}
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
            className="h-6 w-[160px] rounded border bg-muted px-1.5 text-sm focus:border-ring"
          />
          <span className="text-sm text-muted-foreground">{`.${diagramExt}`}</span>
          <Tooltip label={t("composer.saveNameTooltip")}>
            <button
              type="button"
              onClick={commitName}
              aria-label={t("composer.saveName")}
              className="flex size-6 items-center justify-center rounded text-emerald-600 hover:bg-accent dark:text-emerald-400"
            >
              <Check className="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip label={t("composer.cancelRenameTooltip")}>
            <button
              type="button"
              onClick={cancelEditName}
              aria-label={t("composer.cancelRename")}
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
            title={t("composer.renameTooltip")}
            className="flex min-w-0 items-center rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="max-w-[220px] truncate font-normal">{displayFile}</span>
          </button>
        </Tooltip>
      )}
      <span
        data-testid="diagram-language"
        title={t("composer.languageLabel", { language: lang.name })}
        className="shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground"
      >
        {lang.name}
      </span>
      <Tooltip label={t("composer.importTooltip")}>
        <button
          type="button"
          data-tour="diagram-import"
          aria-label={t("composer.importLabel")}
          onClick={() => void importDiagramFile()}
          disabled={importing}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {importing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileDown className="size-4" />
          )}
        </button>
      </Tooltip>
      {renderNotes()}
    </div>
  );

  return (
    <div
      role="dialog"
      aria-label={t("composer.title")}
      aria-modal="true"
      aria-labelledby={brand ? undefined : "diagram-composer-title"}
      data-tour="diagram-composer"
      data-language={language}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div
        data-tauri-drag-region
        className={cn(
          "relative flex h-12 shrink-0 items-center gap-2 border-b bg-background pr-4",
          isMac && !fullscreen && "pl-[78px]",
          isMac && fullscreen && "pl-4",
          !isMac && "pl-4",
        )}
      >
        <div data-tour="diagram-intro-anchor" className="flex shrink-0 items-center gap-2">
          {brand ?? (
            <>
              <Tooltip label={t("composer.backToProject")}>
                <button
                  type="button"
                  aria-label={t("composer.backToProject")}
                  onClick={onClose}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                </button>
              </Tooltip>
              <h2
                id="diagram-composer-title"
                className="max-w-[15ch] shrink-0 truncate text-sm font-semibold"
                title={projectName || t("composer.title")}
              >
                {projectName || t("composer.title")}
              </h2>
            </>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
        {renderComposerTitle()}

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
              {m === "draw" ? t("composer.modeDraw") : t("composer.modeCode")}
            </button>
          ))}
        </div>

        {renderComposerActions()}
        {windowControls}
      </div>

      <div
        data-tour="diagram-preview-affordance"
        className={cn("min-h-0 flex-1", showPreview ? "grid grid-cols-2" : "flex")}
      >
        {renderComposerEditorPane()}

        {renderComposerPreviewPane()}
      </div>

    </div>
  );
}
