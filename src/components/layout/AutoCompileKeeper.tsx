import { useEffect, useRef } from "react";
import { fromCoauthor } from "@/lib/live-file-mirror";
import { stopOutdatedAutomaticCompile, typstLivePreviewWanted, useCompileStore } from "@/store/compile";
import { useActiveContent, useFilesStore } from "@/store/files";

export const AUTO_COMPILE_DEBOUNCE_MS = 2500;

export function AutoCompileKeeper() {
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const activeContent = useActiveContent();
  const autoCompile = useCompileStore((state) => state.autoCompile);
  const recompile = useCompileStore((state) => state.recompile);
  const pathRef = useRef<string | null>(null);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cancel = () => {
      if (pendingRef.current !== null) clearTimeout(pendingRef.current);
      pendingRef.current = null;
    };
    if (!autoCompile || !projectId || typstLivePreviewWanted()) {
      pathRef.current = activePath;
      cancel();
      return;
    }
    if (pathRef.current !== activePath) {
      pathRef.current = activePath;
      cancel();
      return;
    }
    if (activePath && fromCoauthor(projectId, activePath, activeContent)) return;
    cancel();
    const editedAt = Date.now();
    const attempt = () => {
      pendingRef.current = null;
      if (typstLivePreviewWanted()) return;
      if (useCompileStore.getState().status === "compiling") {
        stopOutdatedAutomaticCompile(editedAt);
        pendingRef.current = setTimeout(attempt, 500);
        return;
      }
      void recompile({ origin: "automatic" });
    };
    pendingRef.current = setTimeout(attempt, AUTO_COMPILE_DEBOUNCE_MS);
  }, [activeContent, activePath, autoCompile, projectId, recompile]);

  useEffect(
    () => () => {
      if (pendingRef.current !== null) clearTimeout(pendingRef.current);
      pendingRef.current = null;
    },
    [],
  );

  return null;
}
