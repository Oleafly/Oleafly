import { describe, expect, it } from "vitest";
import { tourRegistry, type TourStepDefinition } from "@/lib/tours/registry";
import {
  isAiStepApplicable,
  isTourTargetReady,
  missingTargetAction,
  shouldCompleteTourAfterStep,
  shouldCloseProjectDialogOnBack,
  shouldSuppressTourKey,
  autoSkipAction,
  toJoyrideStep,
  tourArrowSide,
} from "./TourGuide";
import { createTourState } from "@/store/tours";

const decision = (
  key: string,
  overrides: Partial<Parameters<typeof shouldSuppressTourKey>[0]> = {},
) =>
  shouldSuppressTourKey({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    inRequiredInput: false,
    inRequiredClick: false,
    inPortal: false,
    ...overrides,
  });

describe("tour keyboard capture", () => {
  it("always consumes escape, function keys, and application shortcut chords", () => {
    expect(decision("Escape", { inRequiredInput: true })).toBe(true);
    expect(decision("F5", { inRequiredInput: true })).toBe(true);
    expect(decision("s", { metaKey: true, inRequiredInput: true })).toBe(true);
    expect(decision("b", { ctrlKey: true, inRequiredInput: true })).toBe(true);
    expect(decision("ArrowLeft", { altKey: true, inRequiredInput: true })).toBe(true);
  });

  it("preserves tab and ordinary required-input editing", () => {
    expect(decision("Tab")).toBe(false);
    expect(decision("a", { inRequiredInput: true })).toBe(false);
    expect(decision("Backspace", { inRequiredInput: true })).toBe(false);
    expect(decision("Enter", { inRequiredInput: true })).toBe(false);
    for (const key of ["a", "c", "v", "x", "z"]) {
      expect(decision(key, { metaKey: true, inRequiredInput: true })).toBe(false);
      expect(decision(key, { ctrlKey: true, inRequiredInput: true })).toBe(false);
    }
    expect(decision("v", { metaKey: true })).toBe(true);
    expect(
      decision("@", {
        ctrlKey: true,
        altKey: true,
        inRequiredInput: true,
      }),
    ).toBe(false);
    expect(
      decision("é", {
        altKey: true,
        inRequiredInput: true,
      }),
    ).toBe(false);
    expect(decision("ArrowLeft", { altKey: true, inRequiredInput: true })).toBe(true);
  });

  it("allows activation only in the tooltip or required-click target", () => {
    expect(decision("Enter", { inPortal: true })).toBe(false);
    expect(decision(" ", { inRequiredClick: true })).toBe(false);
    expect(decision("Enter")).toBe(true);
    expect(decision(" ")).toBe(true);
  });
});

describe("tour auto-skip direction", () => {
  it("continues backward through unavailable steps", () => {
    expect(autoSkipAction("prev")).toBe("back");
    expect(autoSkipAction("prev", true)).toBe("back");
    expect(autoSkipAction("next")).toBe("advance");
    expect(autoSkipAction("next", true)).toBe("complete");
  });

  it("continues backward when a waited-for target is missing", () => {
    expect(missingTargetAction("prev", "informational", false)).toBe("back");
    expect(missingTargetAction("prev", "transition", false)).toBe("back");
    expect(missingTargetAction("next", "informational", false)).toBe("advance");
    expect(missingTargetAction("next", "informational", true)).toBe("complete");
    expect(missingTargetAction("next", "transition", false)).toBe("advance");
  });

  it("closes project creation when backing out of the template gallery", () => {
    expect(shouldCloseProjectDialogOnBack("home", "home-gallery")).toBe(true);
    expect(shouldCloseProjectDialogOnBack("home", "home-name")).toBe(false);
    expect(shouldCloseProjectDialogOnBack("settings", "home-gallery")).toBe(false);
  });
});

describe("tour step conversion", () => {
  it("always gives Joyride a concrete placement", () => {
    const step: TourStepDefinition = {
      id: "settings-navigation",
      target: '[data-tour="settings-navigation"]',
      kind: "informational",
      title: "Settings",
      content: "Navigate settings.",
    };

    expect(toJoyrideStep(step).placement).toBe("bottom");
    expect(toJoyrideStep({ ...step, placement: "left" }).placement).toBe("left");
    expect(
      toJoyrideStep({
        ...step,
        spotlightTarget: '[data-tour="settings-navigation-panel"]',
      }).spotlightTarget,
    ).toBe('[data-tour="settings-navigation-panel"]');
  });
});

describe("tour arrow placement", () => {
  it("uses a safe side when Joyride omits placement", () => {
    expect(tourArrowSide()).toBe("top");
    expect(tourArrowSide("bottom-end")).toBe("bottom");
  });
});

describe("tour target hydration", () => {
  it("does not make AI eligible until configuration reaches an explicit ready state", () => {
    const element = { dataset: { tourReady: "false" } } as unknown as HTMLElement;
    expect(isTourTargetReady('[data-tour="ai-assistant"]', element)).toBe(false);
    element.dataset.tourReady = "true";
    expect(isTourTargetReady('[data-tour="ai-assistant"]', element)).toBe(true);
    expect(isTourTargetReady('[data-tour="home"]', element)).toBe(true);
    expect(isTourTargetReady('[data-tour="ai-assistant"]', null)).toBe(false);
  });

  it("skips history when the keyless assistant does not render its history control", () => {
    const root = {
      dataset: {
        tourConfigured: "false",
        tourHasUsage: "false",
        tourHasRestore: "false",
      },
    } as unknown as HTMLElement;
    expect(isAiStepApplicable("ai-connect-provider", root)).toBe(true);
    expect(isAiStepApplicable("ai-history", root)).toBe(false);
    root.dataset.tourConfigured = "true";
    expect(isAiStepApplicable("ai-connect-provider", root)).toBe(false);
    expect(isAiStepApplicable("ai-history", root)).toBe(true);
  });
});

describe("terminal tour lifecycle", () => {
  it("completes every tour when Done advances from its final step", () => {
    for (const definition of Object.values(tourRegistry)) {
      const finalIndex = definition.steps.length - 1;
      expect(
        shouldCompleteTourAfterStep("next", finalIndex, definition.steps.length),
      ).toBe(true);
      expect(
        shouldCompleteTourAfterStep("next", Math.max(0, finalIndex - 1), definition.steps.length),
      ).toBe(false);
    }
    expect(shouldCompleteTourAfterStep("complete", 0, 10)).toBe(true);
  });

  it("clears the active Settings tour immediately after completion", () => {
    const values = new Map<string, string>();
    const store = createTourState({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
    });
    store.getState().start("settings");
    store.getState().complete("settings");
    expect(store.getState().activeTourId).toBeNull();
    expect(store.getState().activeStepIndex).toBe(0);
    expect(store.getState().tours.settings.status).toBe("completed");
  });
});
