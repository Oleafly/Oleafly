export const COMPILE_SUCCEEDED_EVENT = "compile:succeeded";
export const COMPILE_CHECKPOINT_VERSION = 1 as const;

export type CompileOutputKind = "standard" | "tagged";

/**
 * Identifies one successful main-document output across every app window.
 *
 * `outputRevision` is allocated by the Rust backend while it still owns the
 * process-wide compile lock. `outputId` fingerprints the PDF written by that
 * revision, so a receiver can reject a delayed event if a newer compile has
 * already replaced the file before IPC reads it.
 */
export interface CompileSuccessCheckpoint {
  version: typeof COMPILE_CHECKPOINT_VERSION;
  projectId: string;
  mainDocument: string;
  /**
   * The complete project dependency-graph revision that produced this PDF.
   * This is deliberately distinct from `outputRevision`, which only orders
   * backend output files.
   */
  projectRevision: number;
  /**
   * Identifies the compile request within the producing app runtime. Together
   * with the project fields above it is the acceptance identity used by the
   * preview and detached preview window.
   */
  requestGeneration: number;
  outputKind: CompileOutputKind;
  producerId: string;
  outputRevision: number;
  outputId: string;
  completedAt: number;
}

interface CreateCompileSuccessCheckpointInput {
  projectId: string;
  mainDocument: string;
  projectRevision?: number;
  requestGeneration?: number;
  outputKind: CompileOutputKind;
  producerId: string;
  outputRevision: number;
  outputId: string;
  previousCompletedAt: number | null;
  now?: number;
}

export function nextSuccessfulCompileTimestamp(
  previous: number | null,
  candidate = Date.now(),
): number {
  const finiteCandidate = Number.isFinite(candidate)
    ? Math.max(0, Math.trunc(candidate))
    : 0;
  return Math.max(finiteCandidate, (previous ?? 0) + 1);
}

export function createCompileSuccessCheckpoint({
  projectId,
  mainDocument,
  projectRevision = 0,
  requestGeneration = 0,
  outputKind,
  producerId,
  outputRevision,
  outputId,
  previousCompletedAt,
  now,
}: CreateCompileSuccessCheckpointInput): CompileSuccessCheckpoint {
  return {
    version: COMPILE_CHECKPOINT_VERSION,
    projectId,
    mainDocument,
    projectRevision,
    requestGeneration,
    outputKind,
    producerId,
    outputRevision,
    outputId,
    completedAt: nextSuccessfulCompileTimestamp(previousCompletedAt, now),
  };
}

/**
 * A compact, deterministic identity for non-adversarial output race detection.
 * Two independently mixed 32-bit lanes cover every byte and include the length.
 * The backend uses the same algorithm before releasing the compile lock.
 */
export function fingerprintCompileOutput(bytes: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
    second = ((second << 13) | (second >>> 19)) >>> 0;
  }
  return `pdf-v1:${bytes.byteLength}:${first.toString(16).padStart(8, "0")}${second
    .toString(16)
    .padStart(8, "0")}`;
}

export function isCompileSuccessCheckpoint(
  value: unknown,
): value is CompileSuccessCheckpoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompileSuccessCheckpoint>;
  return (
    candidate.version === COMPILE_CHECKPOINT_VERSION &&
    typeof candidate.projectId === "string" &&
    candidate.projectId.length > 0 &&
    typeof candidate.mainDocument === "string" &&
    candidate.mainDocument.length > 0 &&
    typeof candidate.projectRevision === "number" &&
    Number.isSafeInteger(candidate.projectRevision) &&
    candidate.projectRevision >= 0 &&
    typeof candidate.requestGeneration === "number" &&
    Number.isSafeInteger(candidate.requestGeneration) &&
    candidate.requestGeneration >= 0 &&
    (candidate.outputKind === "standard" || candidate.outputKind === "tagged") &&
    typeof candidate.producerId === "string" &&
    candidate.producerId.length > 0 &&
    typeof candidate.outputRevision === "number" &&
    Number.isSafeInteger(candidate.outputRevision) &&
    candidate.outputRevision > 0 &&
    typeof candidate.outputId === "string" &&
    /^pdf-v1:\d+:[0-9a-f]{16}$/u.test(candidate.outputId) &&
    typeof candidate.completedAt === "number" &&
    Number.isSafeInteger(candidate.completedAt) &&
    candidate.completedAt > 0
  );
}

export function isNewerCompileCheckpoint(
  candidate: CompileSuccessCheckpoint,
  current: CompileSuccessCheckpoint | null,
): boolean {
  return current === null || candidate.outputRevision > current.outputRevision;
}

/**
 * True when another successful compile became current after a local attempt
 * started. Failed and best-effort results have no revision of their own, so
 * they must not replace the status/PDF belonging to that newer success.
 */
export function hasCompileCheckpointAdvanced(
  checkpointAtStart: CompileSuccessCheckpoint | null,
  current: CompileSuccessCheckpoint | null,
): boolean {
  return current !== null && isNewerCompileCheckpoint(current, checkpointAtStart);
}

/**
 * Apply successful local output only when its backend revision is newer than
 * the latest accepted output. A failed/best-effort result is eligible only
 * while no success checkpoint has advanced since the attempt began.
 */
export function canApplyLocalCompileOutcome(
  candidate: CompileSuccessCheckpoint | null,
  current: CompileSuccessCheckpoint | null,
  checkpointAtStart: CompileSuccessCheckpoint | null,
): boolean {
  return candidate
    ? isNewerCompileCheckpoint(candidate, current)
    : !hasCompileCheckpointAdvanced(checkpointAtStart, current);
}
