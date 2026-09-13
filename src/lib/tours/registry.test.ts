import { describe, expect, it } from "vitest";
import {
  AVAILABLE_TOUR_IDS,
  isTourAvailable,
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

  it("keeps the dormant AI settings walkthrough definition intact", () => {
    expect(tourRegistry["ai-settings"].contexts).toEqual(["settings"]);
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

  it("only makes Getting started and Your workspace available", () => {
    expect(AVAILABLE_TOUR_IDS).toEqual(["home", "workspace"]);
    expect(AVAILABLE_TOUR_IDS.map((id) => resolveTourText(tourRegistry[id].label))).toEqual([
      "Getting started",
      "Your workspace",
    ]);
    expect(TOUR_IDS.filter(isTourAvailable)).toEqual(AVAILABLE_TOUR_IDS);
    expect(toursForContext("home").map((tour) => tour.id)).toEqual(["home"]);
    expect(toursForContext("project").map((tour) => tour.id)).toEqual(["workspace"]);
    for (const context of ["settings", "ai", "diagram"] satisfies TourContext[]) {
      expect(toursForContext(context)).toEqual([]);
    }
  });

  it("reports the schema version the coordinator persists against", () => {
    expect(TOUR_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
