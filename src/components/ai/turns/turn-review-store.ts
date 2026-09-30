import { create } from "zustand";
import {
  agentTurnPreview,
  agentTurnRedo,
  agentTurnRevert,
  agentTurnStatus,
  type TurnFilePreview,
  type TurnFileState,
  type TurnRevertResult,
  type TurnStatus,
} from "@/lib/agent-turns";
import { useFilesStore } from "@/store/files";

export type TurnAction = "undo" | "redo";

/** What the last Undo or Redo did, for the card's status line. */
export interface TurnOutcome {
  action: TurnAction;
  done: number;
  edited: boolean;
  failedWrites: boolean;
  failed: boolean;
}

/**
 * Review state of one agent turn. It lives outside the card, keyed by the
 * turn's `snapshotId`, because the message list unmounts rows that scroll
 * out of view and the card must come back the way the user left it.
 */
export interface TurnReview {
  expanded: boolean;
  buildExpanded: boolean;
  open: number | null;
  states: Record<number, TurnFileState>;
  expired: boolean;
  previews: Record<number, TurnFilePreview>;
  loadingPreview: number | null;
  previewFailed: number | null;
  pending: "all" | number | null;
  outcome: TurnOutcome | null;
}

export const EMPTY_TURN_REVIEW: TurnReview = {
  expanded: false,
  buildExpanded: false,
  open: null,
  states: {},
  expired: false,
  previews: {},
  loadingPreview: null,
  previewFailed: null,
  pending: null,
  outcome: null,
};

interface TurnReviewState {
  reviews: Record<string, TurnReview>;
  toggleExpanded: (snapshotId: string) => void;
  toggleBuild: (snapshotId: string) => void;
  loadStatus: (projectId: string, snapshotId: string, force?: boolean) => Promise<void>;
  togglePreview: (projectId: string, snapshotId: string, index: number) => Promise<void>;
  run: (
    projectId: string,
    snapshotId: string,
    action: TurnAction,
    indices: number[] | null,
    pending: "all" | number,
  ) => Promise<void>;
  reset: () => void;
}

const statusRequests = new Map<string, Promise<void>>();
const loadedStatus = new Set<string>();

function patch(
  reviews: Record<string, TurnReview>,
  snapshotId: string,
  change: (review: TurnReview) => Partial<TurnReview>,
): Record<string, TurnReview> {
  const current = reviews[snapshotId] ?? EMPTY_TURN_REVIEW;
  return { ...reviews, [snapshotId]: { ...current, ...change(current) } };
}

function outcomeOf(action: TurnAction, result: TurnRevertResult): TurnOutcome {
  return {
    action,
    done: result.reverted.length,
    edited: result.skipped.some((entry) => entry.reason === "edited"),
    failedWrites: result.skipped.some((entry) => entry.reason === "write_failed"),
    failed: false,
  };
}

function statesAfter(
  states: Record<number, TurnFileState>,
  action: TurnAction,
  result: TurnRevertResult,
): Record<number, TurnFileState> {
  const next = { ...states };
  for (const index of result.reverted) next[index] = action === "undo" ? "undone" : "applied";
  for (const entry of result.skipped) if (entry.reason === "edited") next[entry.index] = "edited";
  return next;
}

function statesOf(files: TurnStatus["files"]): Record<number, TurnFileState> {
  return Object.fromEntries(files.map((entry) => [entry.index, entry.state]));
}

export const useTurnReviewStore = create<TurnReviewState>((set, get) => ({
  reviews: {},
  toggleExpanded: (snapshotId) =>
    set((state) => ({ reviews: patch(state.reviews, snapshotId, (review) => ({ expanded: !review.expanded })) })),
  toggleBuild: (snapshotId) =>
    set((state) => ({
      reviews: patch(state.reviews, snapshotId, (review) => ({ buildExpanded: !review.buildExpanded })),
    })),
  loadStatus: (projectId, snapshotId, force = false) => {
    const inFlight = statusRequests.get(snapshotId);
    if (inFlight && !force) return inFlight;
    if (!force && loadedStatus.has(snapshotId)) return Promise.resolve();
    const request = agentTurnStatus(projectId, snapshotId)
      .then((status) => {
        loadedStatus.add(snapshotId);
        set((state) => ({
          reviews: patch(state.reviews, snapshotId, (review) => ({
            expired: status.expired,
            states: {
              ...review.states,
              ...statesOf(status.files),
            },
          })),
        }));
      })
      .catch(() => {
        // Row states stay "applied"; Undo and Redo re-check the disk anyway.
      })
      .finally(() => {
        if (statusRequests.get(snapshotId) === request) statusRequests.delete(snapshotId);
      });
    statusRequests.set(snapshotId, request);
    return request;
  },
  togglePreview: async (projectId, snapshotId, index) => {
    const current = get().reviews[snapshotId] ?? EMPTY_TURN_REVIEW;
    const closing = current.open === index;
    set((state) => ({
      reviews: patch(state.reviews, snapshotId, () => ({ open: closing ? null : index, previewFailed: null })),
    }));
    if (closing || current.previews[index] || current.loadingPreview === index) return;
    set((state) => ({ reviews: patch(state.reviews, snapshotId, () => ({ loadingPreview: index })) }));
    try {
      const preview = await agentTurnPreview(projectId, snapshotId, index);
      set((state) => ({
        reviews: patch(state.reviews, snapshotId, (review) => ({
          previews: { ...review.previews, [index]: preview },
          loadingPreview: review.loadingPreview === index ? null : review.loadingPreview,
        })),
      }));
    } catch {
      set((state) => ({
        reviews: patch(state.reviews, snapshotId, (review) => ({
          previewFailed: review.open === index ? index : review.previewFailed,
          loadingPreview: review.loadingPreview === index ? null : review.loadingPreview,
        })),
      }));
    }
  },
  run: async (projectId, snapshotId, action, indices, pending) => {
    if ((get().reviews[snapshotId] ?? EMPTY_TURN_REVIEW).pending !== null) return;
    set((state) => ({ reviews: patch(state.reviews, snapshotId, () => ({ pending, outcome: null })) }));
    const command = action === "undo" ? agentTurnRevert : agentTurnRedo;
    try {
      const result = await useFilesStore
        .getState()
        .runExternalProjectMutation(projectId, (generation) => command(projectId, snapshotId, indices, generation));
      set((state) => ({
        reviews: patch(state.reviews, snapshotId, (review) => ({
          pending: null,
          outcome: outcomeOf(action, result),
          states: statesAfter(review.states, action, result),
          expired: review.expired || result.skipped.some((entry) => entry.reason === "expired"),
        })),
      }));
    } catch {
      set((state) => ({
        reviews: patch(state.reviews, snapshotId, () => ({
          pending: null,
          outcome: { action, done: 0, edited: false, failedWrites: false, failed: true },
        })),
      }));
    }
    await get().loadStatus(projectId, snapshotId, true);
  },
  reset: () => {
    statusRequests.clear();
    loadedStatus.clear();
    set({ reviews: {} });
  },
}));

export function turnReviewFor(
  reviews: Record<string, TurnReview>,
  snapshotId: string | null,
): TurnReview {
  return (snapshotId && reviews[snapshotId]) || EMPTY_TURN_REVIEW;
}
