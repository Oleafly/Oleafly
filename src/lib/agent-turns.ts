import { invoke } from "@tauri-apps/api/core";
import type { ProjectStateChanged } from "@/lib/tauri";

/** Why a turn has no Undo. */
export type TurnUnavailable = "too_large" | "too_many_files" | "timeout" | "error";
export type TurnSkipReason = "too_large" | "symlink" | "unreadable" | "cloud_placeholder" | "store_full";
export interface TurnSkipped { path: string; reason: TurnSkipReason }
export type TurnChangeKind = "added" | "modified" | "deleted";
export interface TurnChange {
  index: number;
  path: string;
  change: TurnChangeKind;
  beforeSize: number | null;
  afterSize: number | null;
  /** Lines added, when both sides are text. */
  added: number | null;
  /** Lines removed, when both sides are text. */
  removed: number | null;
  /** Oleafly's own write path also saved this file during the turn. */
  alsoEditedHere: boolean;
  /** TeX build output; never part of Undo all. */
  build: boolean;
}
export interface TurnChanges {
  snapshotId: string | null;
  files: TurnChange[];
  moreFiles: number;
  skipped: TurnSkipped[];
  /** Another turn in the same project was open during this one. */
  overlapped: boolean;
  unavailable: TurnUnavailable | null;
}
export interface TurnBegin { snapshotId: string | null; unavailable: TurnUnavailable | null }
export type TurnFileState = "applied" | "undone" | "edited";
export interface TurnStatus { expired: boolean; files: { index: number; state: TurnFileState }[] }
export interface TurnFilePreview {
  index: number;
  path: string;
  change: TurnChangeKind;
  before: string | null;
  after: string | null;
  binary: boolean;
  tooLarge: boolean;
  state: TurnFileState;
}
export type TurnRevertSkipReason = "edited" | "expired" | "write_failed";
export interface TurnRevertResult {
  reverted: number[];
  skipped: { index: number; reason: TurnRevertSkipReason }[];
  projectState: ProjectStateChanged;
}

/** Takes the before-turn copy of a project. Never throws for size or time limits; see `unavailable`. */
export const agentTurnBegin = (projectId: string, label: string) => invoke<TurnBegin>("agent_turn_begin", { projectId, label });
/** Compares the project with the before-turn copy. `toolPaths` are files the assistant's own tools wrote. */
export const agentTurnFinish = (projectId: string, snapshotId: string, toolPaths: string[] | null = null) =>
  invoke<TurnChanges>("agent_turn_finish", { projectId, snapshotId, toolPaths });
export const agentTurnStatus = (projectId: string, snapshotId: string) => invoke<TurnStatus>("agent_turn_status", { projectId, snapshotId });
export const agentTurnPreview = (projectId: string, snapshotId: string, index: number) =>
  invoke<TurnFilePreview>("agent_turn_preview", { projectId, snapshotId, index });
/** Undoes files of a turn (`null` = every file Undo all covers). Run through `runExternalProjectMutation`. */
export const agentTurnRevert = (projectId: string, snapshotId: string, indices: number[] | null, expectedGeneration: number) =>
  invoke<TurnRevertResult>("agent_turn_revert", { projectId, snapshotId, indices, expectedGeneration });
/** Re-applies files that were undone. Run through `runExternalProjectMutation`. */
export const agentTurnRedo = (projectId: string, snapshotId: string, indices: number[] | null, expectedGeneration: number) =>
  invoke<TurnRevertResult>("agent_turn_redo", { projectId, snapshotId, indices, expectedGeneration });

const UNAVAILABLE: readonly TurnUnavailable[] = ["too_large", "too_many_files", "timeout", "error"];
const SKIP_REASONS: readonly TurnSkipReason[] = ["too_large", "symlink", "unreadable", "cloud_placeholder", "store_full"];
const CHANGE_KINDS: readonly TurnChangeKind[] = ["added", "modified", "deleted"];

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;

function turnChangeFrom(value: unknown): TurnChange | null {
  const row = record(value);
  const index = count(row?.index);
  const change = oneOf(row?.change, CHANGE_KINDS);
  if (!row || index === null || !Number.isInteger(index) || typeof row.path !== "string" || !row.path || !change) {
    return null;
  }
  return {
    index,
    path: row.path,
    change,
    beforeSize: count(row.beforeSize),
    afterSize: count(row.afterSize),
    added: count(row.added),
    removed: count(row.removed),
    alsoEditedHere: row.alsoEditedHere === true,
    build: row.build === true,
  };
}

/** Reads a `turn_changes` event payload (or a stored copy); null when it is not one. */
export function turnChangesFrom(value: unknown): TurnChanges | null {
  const data = record(value);
  if (!data) return null;
  const files = Array.isArray(data.files)
    ? data.files.map(turnChangeFrom).filter((file): file is TurnChange => file !== null)
    : [];
  const skipped = Array.isArray(data.skipped)
    ? data.skipped.flatMap((entry): TurnSkipped[] => {
        const item = record(entry);
        const reason = oneOf(item?.reason, SKIP_REASONS);
        return item && typeof item.path === "string" && reason ? [{ path: item.path, reason }] : [];
      })
    : [];
  const unavailable =
    data.unavailable === null || data.unavailable === undefined
      ? null
      : oneOf(data.unavailable, UNAVAILABLE) ?? "error";
  return {
    snapshotId: typeof data.snapshotId === "string" && data.snapshotId ? data.snapshotId : null,
    files,
    moreFiles: count(data.moreFiles) ?? 0,
    skipped,
    overlapped: data.overlapped === true,
    unavailable,
  };
}
