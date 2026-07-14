import { useEffect } from "react";
import { useActiveContent, useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

// Keeps the project index fresh: a full rebuild from disk on project switch,
// and a debounced in-memory re-index of the active file as it is edited.
export function IndexKeeper() {
  const projectId = useFilesStore((s) => s.projectId);
  const activePath = useFilesStore((s) => s.activePath);
  // Tree loads AFTER projectId is set and changes on create/delete/rename, so
  // key the full rebuild on tree (not projectId) or unopened .bib files etc.
  // would be missed and citations would look unresolved.
  const tree = useFilesStore((s) => s.tree);
  const content = useActiveContent();

  useEffect(() => {
    useIndexStore.getState().reset();
  }, [projectId]);

  useEffect(() => {
    // `tree` identity changes on every refreshTree, so debounce: a burst of
    // updates (e.g. an AI edit touching many files) coalesces into one rebuild.
    // Not clearing the index here avoids a go-to-def gap while editing.
    if (!projectId || tree.length === 0) return;
    const t = setTimeout(() => void useIndexStore.getState().rebuildFromDisk(), 200);
    return () => clearTimeout(t);
  }, [projectId, tree]);

  useEffect(() => {
    if (!activePath) return;
    const t = setTimeout(() => useIndexStore.getState().updateFile(activePath, content), 400);
    return () => clearTimeout(t);
  }, [activePath, content]);

  return null;
}
