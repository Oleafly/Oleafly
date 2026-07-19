import { describe, expect, it, vi } from "vitest";
import { defaultPersistedTourState } from "@/store/tours";
import {
  evaluateTour,
  finishHomeTourAfterProjectCreation,
  missingTargetFallback,
} from "./coordinator";

describe("tour coordinator", () => {
  const ready = { blockingOverlay: false, targetExists: () => true };

  it("selects the pending tour for the current context", () => {
    expect(evaluateTour(defaultPersistedTourState(), "home", ready)).toEqual({
      tourId: "home",
      reason: "ready",
    });
  });

  it("does not stack tours or start behind a blocking overlay", () => {
    expect(
      evaluateTour(
        { ...defaultPersistedTourState(), activeTourId: "home" },
        "settings",
        ready,
      ).reason,
    ).toBe("active");
    expect(
      evaluateTour(defaultPersistedTourState(), "settings", {
        ...ready,
        blockingOverlay: true,
      }).reason,
    ).toBe("blocked");
  });

  it("ignores completed contextual tours and disabled state", () => {
    const state = defaultPersistedTourState();
    state.tours.settings.status = "completed";
    expect(evaluateTour(state, "settings", ready).reason).toBe("not-pending");
    expect(evaluateTour({ ...state, enabled: false }, "home", ready).reason).toBe("disabled");
  });

  it("waits when a registered first target is missing", () => {
    const state = defaultPersistedTourState();
    const result = evaluateTour(state, "home", {
      blockingOverlay: false,
      targetExists: () => false,
    });
    expect(result.reason).toBe("missing-target");
  });

  it("preserves a dismissed Home tour after successful project creation", () => {
    const state = defaultPersistedTourState();
    state.tours.home.status = "dismissed";
    const complete = vi.fn();
    const stop = vi.fn();
    expect(
      finishHomeTourAfterProjectCreation({
        activeTourId: "home",
        tours: state.tours,
        complete,
        stop,
      }),
    ).toBe("preserved");
    expect(complete).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(state.tours.home.status).toBe("dismissed");
  });

  it("completes eligible Home tours and applies bounded missing-target policy", () => {
    const state = defaultPersistedTourState();
    const complete = vi.fn();
    expect(
      finishHomeTourAfterProjectCreation({
        activeTourId: "home",
        tours: state.tours,
        complete,
        stop: vi.fn(),
      }),
    ).toBe("completed");
    expect(complete).toHaveBeenCalledWith("home");
    expect(missingTargetFallback("informational")).toBe("advance");
    expect(missingTargetFallback("transition")).toBe("advance");
    expect(missingTargetFallback("required-click")).toBe("advance");
    expect(missingTargetFallback("required-input")).toBe("advance");
  });
});
