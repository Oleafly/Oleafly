import { describe, expect, it } from "vitest";
import {
  resolveTourText,
  stepNeedsReachableTarget,
  TOUR_IDS,
  TOUR_SCHEMA_VERSION,
  type TourContext,
  type TourDefinition,
  tourRegistry,
  toursForContext,
  type TourStepDefinition,
} from "./registry";

describe("tour registry", () => {
  it("models the real Home creation flow with stable targets and interaction gates", () => {
    expect(tourRegistry.home.steps.map((step) => [step.id, step.kind, step.target])).toEqual([
      ["home-overview", "informational", '[data-tour="home"]'],
      ["home-create", "required-click", '[data-tour="new-project"]'],
      ["home-kind", "informational", '[data-tour="project-kind-chooser"]'],
      ["home-kind-template", "required-click", '[data-tour="project-kind-template"]'],
      ["home-gallery", "informational", '[data-tour="project-template-list"]'],
      ["home-template", "required-click", '[data-tour="project-template-list"]'],
      ["home-name", "required-input", '[data-tour="project-name"]'],
      ["home-color", "informational", '[data-tour="project-cover-color"]'],
      ["home-create-project", "required-click", '[data-tour="create-project"]'],
    ]);
    expect(tourRegistry.home.steps[5].interactionTarget).toBe(
      '[data-tour="project-template-card"]',
    );
    expect(tourRegistry.home.steps[5].interactionArea).toBe(
      '[data-tour="project-template-list"]',
    );
    expect(tourRegistry.home.steps[7].interactionArea).toBe(
      '[data-tour="project-cover-color"]',
    );
  });

  it("never parks a tooltip on a target the user has to reach", () => {
    const centered = Object.values(tourRegistry)
      .flatMap((tour) => tour.steps as readonly TourStepDefinition[])
      .filter((step) => stepNeedsReachableTarget(step) && step.placement === "center")
      .map((step) => step.id);
    expect(centered).toEqual([]);
  });

  it("uses only stable data-tour targets", () => {
    for (const tour of Object.values(tourRegistry)) {
      for (const step of tour.steps) {
        expect(step.target).toMatch(/^\[data-tour="[^"]+"\]$/);
      }
    }
  });

  it("covers the complete workspace without requiring project mutations", () => {
    expect(tourRegistry.workspace.steps.map((step) => [step.id, step.target])).toEqual([
      ["workspace-toolbar", '[data-tour="project-toolbar"]'],
      ["workspace-sidebar", '[data-tour="project-sidebar"]'],
      ["workspace-editor", '[data-tour="project-editor"]'],
      ["workspace-wysiwyg-toggle", '[data-tour="wysiwyg-toggle"]'],
      ["workspace-compile", '[data-tour="project-compile"]'],
      ["workspace-logs", '[data-tour="project-compile-logs"]'],
      ["workspace-preview", '[data-tour="project-preview"]'],
      ["workspace-zoom", '[data-tour="project-preview-zoom"]'],
      ["workspace-source-navigation", '[data-tour="project-preview-content"]'],
    ]);
    expect(tourRegistry.workspace.steps.every((step) => step.kind === "informational")).toBe(true);
  });

  it("covers every settings area through explicit transitions", () => {
    expect(tourRegistry.settings.steps.map((step) => [step.id, step.kind])).toEqual([
      ["settings-navigation", "informational"],
      ["settings-general", "transition"],
      ["settings-appearance", "transition"],
      ["settings-dictionary", "transition"],
      ["settings-data", "transition"],
      ["settings-ai", "transition"],
      ["settings-compiler", "transition"],
      ["settings-downloads", "transition"],
      ["settings-integrations", "transition"],
      ["settings-shortcuts", "transition"],
      ["settings-mcp", "transition"],
      ["settings-help", "transition"],
    ]);
    expect(tourRegistry.settings.steps.map((step) => step.placement)).toEqual([
      "right",
      ...Array.from({ length: 9 }, () => "left"),
      "bottom",
      "left",
    ]);
  });

  it("covers conditional AI states without sending a request", () => {
    expect(tourRegistry.ai.steps.map((step) => step.id)).toEqual([
      "ai-assistant",
      "ai-runtime",
      "ai-connect-provider",
      "ai-provider-model",
      "ai-prompts",
      "ai-persona",
      "ai-input",
      "ai-attachments",
      "ai-history",
      "ai-usage",
      "ai-restore",
    ]);
    expect(tourRegistry.ai.steps.every((step) => step.kind === "informational")).toBe(true);
    expect(tourRegistry.ai.steps[0].target).toBe('[data-tour="ai-assistant-header"]');
    expect(tourRegistry.ai.steps[0].spotlightTarget).toBe('[data-tour="ai-assistant"]');
    expect(tourRegistry.ai.steps[0].placement).toBe("bottom");
  });

  it("keeps the detailed AI settings walkthrough separate from the Settings overview", () => {
    expect("autoStart" in tourRegistry.settings).toBe(false);
    expect(tourRegistry["ai-settings"].contexts).toEqual(["settings"]);
    // Order keeps the overview first and the walkthrough's own first target
    // keeps it off every other settings page. Opting out of auto-start as well
    // left it with no way to run at all.
    expect("autoStart" in tourRegistry["ai-settings"]).toBe(false);
    expect(tourRegistry["ai-settings"].priority).toBeGreaterThan(
      tourRegistry.settings.priority,
    );
    expect(tourRegistry["ai-settings"].steps[0].target).toBe(
      '[data-tour="ai-settings-tabs"]',
    );
  });

  it("covers diagram authoring without compiling or saving", () => {
    expect(tourRegistry.diagram.steps.map((step) => step.id)).toEqual([
      "diagram-composer",
      "diagram-import",
      "diagram-modes",
      "diagram-palette",
      "diagram-handles",
      "diagram-inspector",
      "diagram-preview",
      "diagram-compile",
      "diagram-save-project",
      "diagram-download",
    ]);
    expect(tourRegistry.diagram.steps.every((step) => step.kind === "informational")).toBe(true);
    const previewStep = tourRegistry.diagram.steps.find((step) => step.id === "diagram-preview");
    expect(previewStep?.target).toBe('[data-tour="diagram-preview-panel"]');
    expect(previewStep?.placement).toBe("left");
  });
});

describe("tour registry copy", () => {
  it("resolves a label and every step title and content for every tour", () => {
    const tours = Object.values(tourRegistry) as readonly TourDefinition[];
    expect(tours).toHaveLength(TOUR_IDS.length);
    for (const tour of tours) {
      expect(TOUR_IDS).toContain(tour.id);
      const label = resolveTourText(tour.label);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("onboarding.");
      expect(tour.steps.length).toBeGreaterThan(0);
      for (const step of tour.steps) {
        const title = resolveTourText(step.title);
        const content = resolveTourText(step.content);
        expect(title.length, `${tour.id}/${step.id} title`).toBeGreaterThan(0);
        expect(content.length, `${tour.id}/${step.id} content`).toBeGreaterThan(0);
        expect(title).not.toContain("onboarding.");
        expect(content).not.toContain("onboarding.");
      }
    }
  });

  it("gives every step a unique id inside its tour", () => {
    for (const tour of Object.values(tourRegistry) as readonly TourDefinition[]) {
      const ids = tour.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("resolves plain string text through the same helper", () => {
    expect(resolveTourText("plain")).toBe("plain");
    expect(resolveTourText(() => "thunk")).toBe("thunk");
  });

  it("orders the tours of each context by priority", () => {
    const contexts: TourContext[] = ["home", "project", "settings", "ai", "diagram"];
    for (const context of contexts) {
      const tours = toursForContext(context);
      expect(tours.length).toBeGreaterThan(0);
      for (const tour of tours) {
        expect(tour.contexts).toContain(context);
      }
      const priorities = tours.map((tour) => tour.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    }
  });

  it("reports the schema version the coordinator persists against", () => {
    expect(TOUR_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
