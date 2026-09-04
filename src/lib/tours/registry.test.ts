import { describe, expect, it } from "vitest";
import { stepNeedsReachableTarget, tourRegistry, type TourStepDefinition } from "./registry";

describe("tour registry", () => {
  it("models the real Home creation flow with stable targets and interaction gates", () => {
    expect(tourRegistry.home.steps.map((step) => [step.id, step.kind, step.target])).toEqual([
      ["home-overview", "informational", '[data-tour="home"]'],
      ["home-create", "required-click", '[data-tour="new-project"]'],
      ["home-gallery", "informational", '[data-tour="project-template-list"]'],
      ["home-template", "required-click", '[data-tour="project-template-list"]'],
      ["home-name", "required-input", '[data-tour="project-name"]'],
      ["home-color", "informational", '[data-tour="project-cover-color"]'],
      ["home-create-project", "required-click", '[data-tour="create-project"]'],
    ]);
    expect(tourRegistry.home.steps[3].interactionTarget).toBe(
      '[data-tour="project-template-card"]',
    );
    expect(tourRegistry.home.steps[3].interactionArea).toBe(
      '[data-tour="project-template-list"]',
    );
    expect(tourRegistry.home.steps[5].interactionArea).toBe(
      '[data-tour="project-cover-color"]',
    );
  });

  it("lists every step whose target the user has to reach behind a centered tooltip", () => {
    const centered = Object.values(tourRegistry)
      .flatMap((tour) => tour.steps as readonly TourStepDefinition[])
      .filter((step) => stepNeedsReachableTarget(step) && step.placement === "center")
      .map((step) => step.id);
    expect(centered).toEqual(["home-template"]);
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
    expect(tourRegistry["ai-settings"].autoStart).toBe(false);
    expect(tourRegistry["ai-settings"].contexts).toEqual(["settings"]);
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
