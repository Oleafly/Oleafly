import type { TourState } from "@/store/tours";
import {
  toursForContext,
  type TourContext,
  type TourId,
  type TourStepKind,
} from "./registry";

export interface TourReadiness {
  blockingOverlay: boolean;
  targetExists: (target: string) => boolean;
}

export interface TourEvaluation {
  tourId: TourId | null;
  reason: "ready" | "disabled" | "active" | "blocked" | "not-pending" | "missing-target";
}

export function evaluateTour(
  state: Pick<TourState, "enabled" | "tours"> & { activeTourId?: TourId | null },
  context: TourContext,
  readiness: TourReadiness,
): TourEvaluation {
  if (!state.enabled) return { tourId: null, reason: "disabled" };
  if (state.activeTourId) return { tourId: null, reason: "active" };
  if (readiness.blockingOverlay) return { tourId: null, reason: "blocked" };
  const candidates = toursForContext(context);
  const tour = candidates.find((candidate) => state.tours[candidate.id].status === "pending");
  if (!tour) return { tourId: null, reason: "not-pending" };
  const firstTarget = tour.steps[0]?.target;
  if (firstTarget && !readiness.targetExists(firstTarget)) {
    return { tourId: null, reason: "missing-target" };
  }
  return { tourId: tour.id, reason: "ready" };
}

export function finishHomeTourAfterProjectCreation(
  state: Pick<TourState, "activeTourId" | "tours" | "complete" | "stop">,
) {
  if (state.tours.home.status === "pending") {
    state.complete("home");
    return "completed" as const;
  }
  if (state.activeTourId === "home") state.stop();
  return "preserved" as const;
}

export function missingTargetFallback(kind: TourStepKind): "advance" | "dismiss" {
  void kind;
  return "advance";
}
