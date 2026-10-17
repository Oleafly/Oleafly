import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { startRename } from "@/lib/index/nav";
import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";

type FileRenameModule = typeof import("./rename-at-cursor");

const REFERENCE_SOURCE = /\.(?:tex|ltx|latex|sty|cls|typ|md|markdown)$/i;

let loaded: FileRenameModule | null = null;
let loading: Promise<FileRenameModule> | null = null;

export function loadFileRename(): Promise<FileRenameModule> {
  loading ??= import("./rename-at-cursor").then((module) => {
    loaded = module;
    return module;
  });
  return loading;
}

export function loadedFileRename(): FileRenameModule | null {
  return loaded;
}

export function useFileRename(): FileRenameModule | null {
  const [module, setModule] = useState(loadedFileRename);
  useEffect(() => {
    if (module) return;
    let current = true;
    loadFileRename()
      .then((next) => {
        if (current) setModule(next);
      })
      .catch((error: unknown) => logError("load file rename", error));
    return () => {
      current = false;
    };
  }, [module]);
  return module;
}

export function renameAtCursor(view: EditorView): boolean {
  const path = useFilesStore.getState().activePath;
  if (!path || !REFERENCE_SOURCE.test(path)) return startRename(view);
  if (loaded) return loaded.startFileRenameAtCursor(view) || startRename(view);
  loadFileRename()
    .then((module) => {
      if (!module.startFileRenameAtCursor(view)) startRename(view);
    })
    .catch((error: unknown) => logError("load file rename", error));
  return true;
}
