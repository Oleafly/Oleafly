import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { Loader2 } from "lucide-react";
import { editorTheme, languageForPath } from "@oleafly/editor";
import { readFileContent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useComposerOutputsStore } from "@/store/composer-outputs";

const MAX_PREVIEW_BYTES = 512 * 1024;

// Same set the workspace uses to skip text loads; these never decode as
// UTF-8, so asking for text content only produces a raw stream error.
const BINARY_EXTENSIONS = /\.(pdf|png|jpe?g|gif|webp|svg|eps|zip|gz|ttf|otf|woff2?)$/i;

// Read-only, syntax-highlighted view of a project file next to the session.
// The workspace editor opens only through the explicit button — nothing here
// ever launches it behind the scenes.
export function FileViewerPane({ path }: { path: string }) {
  const projectId = useFilesStore((s) => s.projectId);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // A run writing this file bumps the epoch; refetch so the pane shows the
  // bytes that are actually on disk now, not the pre-edit snapshot.
  const fileOpen = useComposerOutputsStore((s) => s.fileOpen);
  const writeEpoch =
    fileOpen && fileOpen.path === path && fileOpen.reason === "write" ? fileOpen.at : 0;

  const { data, isPending, isError } = useQuery({
    queryKey: ["harness-file-content", projectId, path, writeEpoch],
    queryFn: () => readFileContent(projectId ?? "", path),
    enabled: !!projectId && !BINARY_EXTENSIONS.test(path),
    staleTime: 5_000,
  });

  const extensions = useMemo(() => {
    const language = languageForPath(path);
    return [
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      editorTheme(),
      ...(language ? [language] : []),
    ];
  }, [path]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || isPending || data === undefined) return;
    viewRef.current?.destroy();
    viewRef.current = new EditorView({
      parent: host,
      state: EditorState.create({ doc: data, extensions }),
    });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // extensions identity is path-derived; recreate only when content or path settles
  }, [data, isPending, extensions]);

  const tooLarge = typeof data === "string" && data.length > MAX_PREVIEW_BYTES;
  const binary =
    BINARY_EXTENSIONS.test(path) || (typeof data === "string" && data.includes("\u0000"));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="harness-file-viewer">
      {binary ? (
        <p className="p-4 text-xs text-muted-foreground">
          This file type doesn't preview as text. Use Open to view it in the workspace
          editor{path.toLowerCase().endsWith(".pdf") ? ", or pick it in Files to see it as a PDF" : ""}.
        </p>
      ) : isPending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading file…
        </div>
      ) : isError ? (
        <p className="p-4 text-xs text-muted-foreground">
          The file could not be read. It may have been moved or deleted.
        </p>
      ) : tooLarge ? (
        <p className="p-4 text-xs text-muted-foreground">
          This file is too large to preview inline. Use Open to view it in the workspace editor.
        </p>
      ) : (
        <div ref={hostRef} className="min-h-0 flex-1 overflow-auto text-xs" />
      )}
    </div>
  );
}
