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

function basename(p: string) {
  const parts = p.split("/");
  return parts[parts.length - 1];
}

/**
 * The unsaved-changes dot for one tab. Subscribes to just that file's `dirty`
 * boolean so it re-renders only when the flag flips, instead of making the whole
 * tab bar re-render on every keystroke (which subscribing to the `files` map
 * would, since it is rebuilt on each edit).
 */
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

const TEX_EXTS = [".tex", ".sty", ".cls", ".bib", ".ltx", ".bst"];

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

  // One tab strip, files and diffs interleaved by the order they were opened.
  // Re-opening a tab keeps its stamp (see the stores), so it never jumps.
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
      // Only act when the CodeMirror editor itself is focused. Otherwise Cmd/Ctrl
      // +B/I typed in a text input, the AI chat box, or any other field would
      // silently mutate the document.
      const el = document.activeElement as HTMLElement | null;
      if (!el?.closest(".cm-editor")) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        wrapSelection("\\textbf{", "}");
      } else if (k === "i") {
        e.preventDefault();
        wrapSelection("\\textit{", "}");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasOpenFile = activePath !== null;
  const isTexFile = activePath != null && TEX_EXTS.some((e) => activePath.endsWith(e));
  const isPdfFile = activePath != null && activePath.toLowerCase().endsWith(".pdf");
  const projectId = useFilesStore((s) => s.projectId);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Tabs */}
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
      {/* Editor body */}
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
          {isTexFile && (
            <div className="shrink-0">
              <EditorToolbar />
            </div>
          )}
          {isPdfFile && projectId ? (
            <div className="min-h-0 flex-1 overflow-auto bg-sidebar">
              <PdfFileView projectId={projectId} path={activePath!} />
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
