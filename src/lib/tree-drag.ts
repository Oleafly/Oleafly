export const TREE_DRAG_TYPE = "application/x-oleafly-tree-path";

export function isTreeDrag(transfer: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return Array.from(transfer?.types ?? []).includes(TREE_DRAG_TYPE);
}

export function treeDragPath(transfer: Pick<DataTransfer, "types" | "getData"> | null | undefined): string | null {
  return transfer && isTreeDrag(transfer) ? transfer.getData(TREE_DRAG_TYPE) || null : null;
}
