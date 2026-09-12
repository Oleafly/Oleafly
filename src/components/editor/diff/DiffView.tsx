import { isEditorMutationLocked, registerEditorMutationOwner } from "@/lib/editor-mutation-lease";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  getChunks,
  MergeView,
  unifiedMergeView,
} from "@codemirror/merge";
import { scrollEditorPositionLocally } from "@oleafly/editor";
import { ChevronDown, ChevronUp, Columns2, GitCompare, Rows3 } from "lucide-react";
import { editorTheme } from "../cm/theme";
import { languageForPath } from "../cm/languages";
import { gitShow, readFileContent } from "@/lib/tauri";
import { useDiffStore, activeDiff } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { diffSides } from "./sides";
import { attachSplitResizer } from "./split-resizer";

const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svgz", "pdf", "zip", "gz",
  "tar", "tgz", "7z", "rar", "woff", "woff2", "ttf", "otf", "eot", "mp4", "mov",
  "avi", "mkv", "mp3", "wav", "flac", "exe", "dll", "so", "dylib", "o", "a",
  "class", "jar", "bin", "dat", "wasm",
]);

function isBinaryPath(p: string): boolean {
  return BINARY_EXTS.has(p.split(".").pop()?.toLowerCase() ?? "");
}

// A NUL byte reliably signals binary content that slipped past the extension list.
function hasNullByte(s: string): boolean {
  return s.includes("\u0000");
}

type ChunkInfo = NonNullable<ReturnType<typeof getChunks>>;

function chunkIndexFor(
  chunks: ChunkInfo["chunks"],
  side: NonNullable<ChunkInfo["side"]>,
  head: number,
  dir: "next" | "prev",
): number | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const [from, to] = side === "b" ? [chunk.fromB, chunk.toB] : [chunk.fromA, chunk.toA];
    if (to < head) return i + 1;
    if (from <= head) {
      if (chunks.length === 1) return null;
      return i + (dir === "prev" ? 0 : 1);
    }
  }
  return 0;
}

export function DiffView() {
  const { t } = useTranslation(["common", "editor"]);
  const diff = useDiffStore(activeDiff);
  const mode = useDiffStore((s) => s.mode);
  const setMode = useDiffStore((s) => s.setMode);
  const projectId = useFilesStore((s) => s.projectId);
  const hostRef = useRef<HTMLDivElement>(null);
  const navViewRef = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const baselineRef = useRef<string | null>(null);

  // Both views depend on INDEX. Working edits update live, but staging,
  // unstaging, and committing also change the comparison baseline. A working
  // diff is editable, so rebuild it only when that baseline really moved: an
  // unrelated git change must not discard the caret, scroll, and undo history
  // of someone typing in it.
  useEffect(() => {
    const onChanged = () => {
      const current = activeDiff(useDiffStore.getState());
      if (!current) return;
      if (current.side === "staged") {
        setReloadKey((k) => k + 1);
        return;
      }
      const activeProject = useFilesStore.getState().projectId;
      if (!activeProject) return;
      const baseline = baselineRef.current;
      void gitShow(activeProject, diffSides(current.side).oldRev, current.path)
        .then((next) => {
          const still = activeDiff(useDiffStore.getState());
          if (still?.path !== current.path || still.side !== current.side) return;
          if (baselineRef.current !== baseline || next === baseline) return;
          setReloadKey((k) => k + 1);
        })
        .catch(() => setReloadKey((k) => k + 1));
    };
    window.addEventListener("oleafly:git-changed", onChanged);
    return () => window.removeEventListener("oleafly:git-changed", onChanged);
  }, []);

  useEffect(() => {
    reloadKey;
    if (!diff || !projectId) return;
    const { path, side } = diff;
    let cancelled = false;
    let view: { destroy: () => void } | null = null;
    let detachResizer: () => void = () => {};
    setLoading(true);
    setError(null);
    setNotice(null);
    baselineRef.current = null;
    const { oldRev, newRev, editable } = diffSides(side);

    let synchronizing = false;
    const editability = new Compartment();
    const editabilityExtensions = (locked: boolean) => [
      EditorState.readOnly.of(!editable || locked),
      EditorView.editable.of(editable && !locked),
    ];
    const onEdit = EditorView.updateListener.of((update) => {
      if (update.docChanged && !synchronizing && useFilesStore.getState().projectId === projectId) {
        useFilesStore.getState().setContent(path, update.state.doc.toString());
      }
    });
    const unregisterMutationOwner = registerEditorMutationOwner({
      projectId: () => projectId,
      setLocked: (locked) => navViewRef.current?.dispatch({
        effects: editability.reconfigure(editabilityExtensions(locked)),
      }),
      reconcile: async () => {
        if (!editable || cancelled) return;
        const files = useFilesStore.getState();
        if (!files.tree.some((entry) => entry.path === path && !entry.is_dir)) {
          useDiffStore.getState().closeDiff(`working:${path}`);
          return;
        }
        const content = files.files[path]?.content ?? await readFileContent(projectId, path).catch((error) => {
          view?.destroy();
          view = null;
          navViewRef.current = null;
          if (hostRef.current) hostRef.current.innerHTML = "";
          setError(i18n.t(($) => $.editor.diff.reloadFailed));
          throw error;
        });
        if (cancelled || useFilesStore.getState().projectId !== projectId) return;
        const current = navViewRef.current;
        if (!current || current.state.doc.toString() === content) return;
        synchronizing = true;
        try {
          current.dispatch({ filter: false, changes: { from: 0, to: current.state.doc.length, insert: content } });
        } finally {
          synchronizing = false;
        }
      },
    });

    const build = async () => {
      try {
        const oldText = await gitShow(projectId, oldRev, path);
        baselineRef.current = oldText;
        const newText =
          newRev === "WORKTREE"
            ? useFilesStore.getState().files[path]?.content ?? await readFileContent(projectId, path).catch(() => "")
            : await gitShow(projectId, "INDEX", path);
        if (cancelled) return;

        if (isBinaryPath(path) || hasNullByte(oldText) || hasNullByte(newText)) {
          setNotice(i18n.t(($) => $.editor.diff.binaryNotice));
          setLoading(false);
          return;
        }
        const MAX = 2_000_000; // ~2 MB per side
        if (oldText.length > MAX || newText.length > MAX) {
          setNotice(i18n.t(($) => $.editor.diff.tooLarge));
          setLoading(false);
          return;
        }

        const host = hostRef.current;
        if (!host) return;
        host.innerHTML = "";

        const lang = languageForPath(path);
        const readOnly: Extension[] = [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ];
        const base: Extension[] = [lineNumbers(), editorTheme(), ...(lang ? [lang] : [])];
        const oldExt: Extension[] = [...base, ...readOnly];
        const newExt: Extension[] = [
          ...base,
          editability.of(editabilityExtensions(isEditorMutationLocked(projectId))),
          EditorState.transactionFilter.of((transaction) =>
            transaction.docChanged && isEditorMutationLocked(projectId) ? [] : transaction),
          ...(editable ? [onEdit] : readOnly),
        ];

        if (mode === "split") {
          const mv = new MergeView({
            a: { doc: oldText, extensions: oldExt },
            b: { doc: newText, extensions: newExt },
            parent: host,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: { margin: 3, minSize: 4 },
          });
          view = mv;
          navViewRef.current = mv.b;
          detachResizer = attachSplitResizer(host);
        } else {
          const ev = new EditorView({
            doc: newText,
            extensions: [
              unifiedMergeView({ original: oldText, mergeControls: false }),
              ...newExt,
            ],
            parent: host,
          });
          view = ev;
          navViewRef.current = ev;
        }
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    };
    void build();

    return () => {
      cancelled = true;
      unregisterMutationOwner();
      detachResizer();
      detachResizer = () => {};
      view?.destroy();
      navViewRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [diff, mode, projectId, reloadKey]);

  const goChunk = (dir: "next" | "prev") => {
    const v = navViewRef.current;
    if (!v) return;
    const info = getChunks(v.state);
    if (!info?.chunks.length || !info.side) return;
    const chunks = info.chunks;
    const head = v.state.selection.main.head;
    const index = chunkIndexFor(chunks, info.side, head, dir);
    if (index === null) return;
    const offset =
      dir === "prev" ? chunks.length - 1 : 0;
    const next = chunks[(index + offset) % chunks.length];
    const from =
      info.side === "b" ? next.fromB : next.fromA;
    v.dispatch({
      selection: { anchor: from },
      userEvent: "select.byChunk",
    });
    scrollEditorPositionLocally(v, from);
    v.focus();
  };

  if (!diff) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <GitCompare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">
          {diff.side === "staged"
            ? t(($) => $.editor.diff.stagedHeading)
            : t(($) => $.editor.diff.workingHeading)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => goChunk("prev")}
            aria-label={t(($) => $.editor.diff.previousChange)}
            title={t(($) => $.editor.diff.previousChange)}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => goChunk("next")}
            aria-label={t(($) => $.editor.diff.nextChange)}
            title={t(($) => $.editor.diff.nextChange)}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
        <div className="flex overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => setMode("split")}
            aria-label={t(($) => $.editor.diff.splitView)}
            className={cn(
              "flex size-6 items-center justify-center",
              mode === "split" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Columns2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode("unified")}
            aria-label={t(($) => $.editor.diff.unifiedView)}
            className={cn(
              "flex size-6 items-center justify-center",
              mode === "unified" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Rows3 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        <div ref={hostRef} className="h-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {t(($) => $.editor.diff.loading)}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive">
            {error}
          </div>
        )}
        {notice && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}
