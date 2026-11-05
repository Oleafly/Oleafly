import { useEffect, useLayoutEffect, useRef } from "react";
import { resetProjectSourcesCache } from "@/lib/project-sources";
import { projectCompileFolder } from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useActiveContent, useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

async function compileFolderOf(projectId: string, mainDocument: string): Promise<string | null> {
  try {
    return (await projectCompileFolder(projectId, mainDocument)) ?? null;
  } catch {
    return null;
  }
}

export function IndexKeeper() {
  const projectId = useFilesStore((s) => s.projectId);
  const activePath = useFilesStore((s) => s.activePath);
  const tree = useFilesStore((s) => s.tree);
  const mainDocument = useFilesStore(() => resolveEffectiveMainDoc().mainDoc);
  const projectLoading = useFilesStore((s) => s.loading);
  const content = useActiveContent();

  const lastProjectId = useRef<string | null>(null);
  useEffect(() => {
    const closed = projectId === null && lastProjectId.current !== null;
    lastProjectId.current = projectId;
    if (closed) {
      useIndexStore.getState().dispose();
      resetProjectSourcesCache();
      return;
    }
    useIndexStore.getState().reset();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !mainDocument) return;
    let current = true;
    void compileFolderOf(projectId, mainDocument).then((folder) => {
      if (current) useIndexStore.getState().setCompileFolder(folder);
    });
    return () => {
      current = false;
    };
  }, [mainDocument, projectId]);

  useLayoutEffect(() => {
    if (!projectId) return;
    void mainDocument;
    void tree;
    useIndexStore.getState().invalidateFilesystem();
  }, [mainDocument, projectId, tree]);

  useEffect(() => {
    if (!projectId || projectLoading) return;
    void mainDocument;
    void tree;
    const t = setTimeout(() => void useIndexStore.getState().rebuildFromDisk(), 200);
    return () => clearTimeout(t);
  }, [mainDocument, projectId, projectLoading, tree]);

  useLayoutEffect(() => {
    if (!activePath) return;
    useIndexStore.getState().updateFile(activePath, content);
  }, [activePath, content]);

  return null;
}
