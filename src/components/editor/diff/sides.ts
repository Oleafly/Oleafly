import type { DiffSide } from "@/store/diff";

// Old/new revision naming follows VS Code's diff semantics.
export type DiffSides = {
  oldRev: "HEAD" | "INDEX" | "DISK";
  newRev: "INDEX" | "WORKTREE";
  editable: boolean;
};

export function diffSides(side: DiffSide): DiffSides {
  if (side === "disk") return { oldRev: "DISK", newRev: "WORKTREE", editable: true };
  return side === "staged"
    ? { oldRev: "HEAD", newRev: "INDEX", editable: false }
    : { oldRev: "INDEX", newRev: "WORKTREE", editable: true };
}
