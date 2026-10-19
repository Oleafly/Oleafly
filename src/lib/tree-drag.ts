// A path dragged from the project's file tree. The tree sets it as data of
// this type; the AI composer (mention) and the terminal (path) read it.

export const TREE_DRAG_TYPE = "application/x-oleafly-tree-path";

export function carriesTreePath(transfer: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return Array.from(transfer?.types ?? []).includes(TREE_DRAG_TYPE);
}

/** The dragged project path with forward slashes, or null when there is none. */
export function treeDragPath(
  transfer: Pick<DataTransfer, "types" | "getData"> | null | undefined,
): string | null {
  if (!transfer || !carriesTreePath(transfer)) return null;
  const path = transfer.getData(TREE_DRAG_TYPE).replace(/\\/g, "/").replace(/\/+$/, "");
  return path ? path : null;
}
