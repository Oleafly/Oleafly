import { useEffect, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { EditorContextMenu } from "./EditorContextMenu";
import { EditorToolbar } from "./EditorToolbar";
import { DiffView } from "./diff/DiffView";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { wrapSelection } from "./cm/controller";
import { useFilesStore } from "@/store/files";
import { useDiffStore, diffKey } from "@/store/diff";
import { base64ToUint8Array, readFileBase64 } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { formattingForEngine, pathUsesEngineSource } from "@/lib/document-engine";

function basename(p: string) {
  const parts = p.split("/");
  return parts[parts.length - 1];
}

// Subscribes to just this file's `dirty` boolean, not the `files` map (which
// is rebuilt on every edit), so the tab bar doesn't re-render on each keystroke.
function DirtyDot({ path }: { path: string }) {
  const dirty = useFilesStore((s) => s.files[path]?.dirty ?? false);
  if (!dirty) return null;
  return <span className="size-1.5 rounded-full bg-primary" />;
}

function PdfFileView({ projectId, path }: { projectId: string; path: string }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBytes(null);
    setErr(null);
    readFileBase64(projectId, path)
      .then((b64) => { if (!cancelled) setBytes(base64ToUint8Array(b64)); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [projectId, path]);

  if (err) return <div className="p-6 text-sm text-destructive">Failed to load PDF: {err}</div>;
  if (!bytes) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  return <PdfViewer data={bytes} scale={1} />;
}

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

function imageMime(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".bmp")) return "image/bmp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

// data: URLs, not blob:, because the CSP only allows img-src data:.
function ImageFileView({ projectId, path }: { projectId: string; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setErr(null);
    readFileBase64(projectId, path)
      .then((b64) => { if (!cancelled) setSrc(`data:${imageMime(path)};base64,${b64}`); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [projectId, path]);

  if (err) return <div className="p-6 text-sm text-destructive">Failed to load image: {err}</div>;
  if (!src) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-4">
      <img src={src} alt={basename(path)} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

export function Editor() {
  const openTabs = useFilesStore((s) => s.openTabs);
  const activePath = useFilesStore((s) => s.activePath);
  const setActive = useFilesStore((s) => s.setActive);
  const closeTab = useFilesStore((s) => s.closeTab);
  const diffs = useDiffStore((s) => s.diffs);
  const activeKey = useDiffStore((s) => s.activeKey);
  const setActiveDiff = useDiffStore((s) => s.setActiveDiff);
  const closeDiff = useDiffStore((s) => s.closeDiff);
  const diffFocused = activeKey !== null && diffs.some((d) => diffKey(d) === activeKey);
  const tabOrder = useFilesStore((s) => s.tabOrder);

  // Files and diffs interleaved into one strip; re-opening a tab keeps its
  // stamp (see the stores) so it doesn't jump position.
  const tabs = useMemo(() => {
    const fileTabs = openTabs.map((path) => ({
      kind: "file" as const,
      id: path,
      order: tabOrder[path] ?? 0,
    }));
    const diffTabs = diffs.map((d) => ({
      kind: "diff" as const,
      id: diffKey(d),
      d,
      order: d.order,
    }));
    return [...fileTabs, ...diffTabs].sort((a, b) => a.order - b.order);
  }, [openTabs, diffs, tabOrder]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // Require CodeMirror focus, else Cmd/Ctrl+B/I typed in the AI chat box
      // or any other input would silently mutate the document.
      const el = document.activeElement as HTMLElement | null;
      if (!el?.closest(".cm-editor")) return;
      const path = useFilesStore.getState().activePath;
      const engineState = useFilesStore.getState();
      if (!engineState.engineLoaded) return;
      if (!pathUsesEngineSource(engineState.engine, path)) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        const f = formattingForEngine(engineState.engine, true, "bold");
        if (f?.kind === "wrap") wrapSelection(f.before, f.after);
      } else if (k === "i") {
        e.preventDefault();
        const f = formattingForEngine(engineState.engine, true, "italic");
        if (f?.kind === "wrap") wrapSelection(f.before, f.after);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasOpenFile = activePath !== null;
  const isTypstFile = activePath?.toLowerCase().endsWith(".typ") ?? false;
  const isPdfFile = activePath != null && activePath.toLowerCase().endsWith(".pdf");
  const isImageFile =
    activePath != null && IMAGE_EXTS.some((e) => activePath.toLowerCase().endsWith(e));
  // No in-app preview for these; show a notice instead of an empty text
  // editor a save could clobber them from.
  const isOpaqueFile =
    activePath != null &&
    /\.(zip|gz|eps|ttf|otf|woff2?)$/i.test(activePath);
  const projectId = useFilesStore((s) => s.projectId);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const engine = useFilesStore((s) => s.engine);
  const formattingProfile = useFilesStore((s) => s.engine.capabilities.formatting_profile);
  const showLatexToolbar = engineLoaded && formattingProfile === "latex" && pathUsesEngineSource(engine, activePath);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
        {tabs.length === 0 && (
          <span className="px-2 text-xs text-muted-foreground">No file open</span>
        )}
        {tabs.map((tab) =>
          tab.kind === "file" ? (
            <div
              key={`f:${tab.id}`}
              className={cn(
                "group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs",
                tab.id === activePath && !diffFocused
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              <button
                type="button"
                onClick={() => setActive(tab.id)}
                className="flex items-center gap-1.5"
              >
                {basename(tab.id)}
                <DirtyDot path={tab.id} />
              </button>
              <button
                type="button"
                aria-label={`Close ${basename(tab.id)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-0.5 cursor-pointer rounded p-0.5 hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <div
              key={`d:${tab.id}`}
              className={cn(
                "group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs",
                activeKey === tab.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              <button
                type="button"
                onClick={() => setActiveDiff(tab.id)}
                className="flex items-center gap-1.5"
              >
                {basename(tab.d.path)}
                <span className="text-muted-foreground">
                  ({tab.d.side === "staged" ? "Index" : "Working Tree"})
                </span>
              </button>
              <button
                type="button"
                aria-label={`Close diff ${basename(tab.d.path)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeDiff(tab.id);
                }}
                className="ml-0.5 cursor-pointer rounded p-0.5 hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            </div>
          )
        )}
      </div>
      {diffFocused ? (
        <ErrorBoundary
          fallback={
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              The diff view crashed. Close this tab and try again.
            </div>
          }
        >
          <DiffView />
        </ErrorBoundary>
      ) : hasOpenFile ? (
        <>
          {showLatexToolbar && (
            <div className="shrink-0">
              <EditorToolbar />
            </div>
          )}
          {isTypstFile && (
            <div className="shrink-0 border-b bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
              Typst mode · LaTeX linting and spelling/grammar checks are disabled.
            </div>
          )}
          {isPdfFile && projectId ? (
            <div className="min-h-0 flex-1 overflow-auto bg-sidebar">
              <PdfFileView projectId={projectId} path={activePath!} />
            </div>
          ) : isImageFile && projectId ? (
            <div className="min-h-0 flex-1 overflow-auto bg-sidebar">
              <ImageFileView projectId={projectId} path={activePath!} />
            </div>
          ) : isOpaqueFile ? (
            <div
              data-testid="binary-file-notice"
              className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground"
            >
              <FileText className="mb-3 size-10 opacity-30" />
              <p className="text-sm">{basename(activePath!)}</p>
              <p className="text-xs">Binary file. No preview available.</p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden">
              <EditorContextMenu>
                <CodeMirrorEditor />
              </EditorContextMenu>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          <FileText className="mb-3 size-10 opacity-30" />
          <p className="text-sm">No file open.</p>
          <p className="text-xs">Pick a file from the tree to start editing.</p>
        </div>
      )}
    </div>
  );
}
