import type { DiffSide } from "@/store/diff";

// Old/new revision naming follows VS Code's diff semantics.
export type DiffSides = {
  oldRev: "HEAD" | "INDEX";
  newRev: "INDEX" | "WORKTREE";
  editable: boolean;
};

export function diffSides(side: DiffSide): DiffSides {
  return side === "staged"
    ? { oldRev: "HEAD", newRev: "INDEX", editable: false }
    : { oldRev: "INDEX", newRev: "WORKTREE", editable: true };
}
