import { useEffect, useLayoutEffect } from "react";
import { useActiveContent, useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

// Keeps the project index fresh: a full rebuild from disk on project switch,
// and immediate active-buffer forwarding. The store owns the single analysis
// debounce so edits are coalesced once instead of waiting through two timers.
export function IndexKeeper() {
  const projectId = useFilesStore((s) => s.projectId);
  const activePath = useFilesStore((s) => s.activePath);
  // Tree loads AFTER projectId is set and changes on create/delete/rename, so
  // key the full rebuild on tree (not projectId) or unopened .bib files etc.
  // would be missed and citations would look unresolved.
  const tree = useFilesStore((s) => s.tree);
  const mainDocument = useFilesStore((s) => s.mainDoc);
  const projectLoading = useFilesStore((s) => s.loading);
  const content = useActiveContent();

  useEffect(() => {
    void projectId;
    useIndexStore.getState().reset();
  }, [projectId]);

  useLayoutEffect(() => {
    if (!projectId) return;
    // These identities intentionally define the accepted filesystem snapshot.
    void mainDocument;
    void tree;
    useIndexStore.getState().invalidateFilesystem();
  }, [mainDocument, projectId, tree]);

  useEffect(() => {
    // `tree` identity changes on every refreshTree, so debounce: a burst of
    // updates (e.g. an AI edit touching many files) coalesces into one rebuild.
    // Not clearing the index here avoids a go-to-def gap while editing.
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
