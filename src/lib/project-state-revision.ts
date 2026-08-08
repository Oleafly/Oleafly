let currentRevision = 0;

export function currentProjectStateRevision(): number {
  return currentRevision;
}

export function recordProjectStateRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Project-state revisions must be non-negative integers.");
  }
  currentRevision = Math.max(currentRevision, revision);
  return currentRevision;
}
