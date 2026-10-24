// A path dragged from the project's file tree. The tree sets it as data of
// this type; the AI composer (mention), the terminal (path) and the editors
// (a link to the file) read it.

import { trimTrailingCharacter } from "./trim-character";

export const TREE_DRAG_TYPE = "application/x-oleafly-tree-path";

export function carriesTreePath(transfer: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return Array.from(transfer?.types ?? []).includes(TREE_DRAG_TYPE);
}

/** The dragged project path with forward slashes, or null when there is none. */
export function treeDragPath(
  transfer: Pick<DataTransfer, "types" | "getData"> | null | undefined,
): string | null {
  if (!transfer || !carriesTreePath(transfer)) return null;
  const path = trimTrailingCharacter(transfer.getData(TREE_DRAG_TYPE).replaceAll("\\", "/"), "/");
  return path || null;
}
