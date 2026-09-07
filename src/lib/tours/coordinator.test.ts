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

  it("does not chain the AI settings walkthrough after the Settings overview", () => {
    const state = defaultPersistedTourState();
    state.tours.settings.status = "completed";
    // The overview leaves the reader on Help, so the walkthrough's own page is
    // not on screen and it waits rather than starting on top of them.
    const elsewhereInSettings = {
      blockingOverlay: false,
      targetExists: (target: string) => target !== '[data-tour="ai-settings-tabs"]',
    };
    expect(evaluateTour(state, "settings", elsewhereInSettings).reason).toBe("missing-target");
    expect(state.tours["ai-settings"].status).toBe("pending");
  });

  it("starts the AI settings walkthrough once its own page is open", () => {
    const state = defaultPersistedTourState();
    state.tours.settings.status = "completed";
    expect(evaluateTour(state, "settings", ready)).toEqual({
      tourId: "ai-settings",
      reason: "ready",
    });
  });

  it("ignores disabled state", () => {
    const state = defaultPersistedTourState();
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
