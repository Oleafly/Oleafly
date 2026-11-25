import { i18n } from "@/i18n";

export const TOUR_IDS = ["home", "workspace", "research", "settings", "diagram"] as const;

export type TourId = (typeof TOUR_IDS)[number];
export const AVAILABLE_TOUR_IDS = ["home", "workspace"] as const satisfies readonly TourId[];
export type AvailableTourId = (typeof AVAILABLE_TOUR_IDS)[number];
export type TourStatus = "pending" | "completed" | "dismissed";
export type TourContext = "home" | "project" | "settings" | "diagram";
export type TourStepKind = "informational" | "required-click" | "required-input" | "transition";

export interface TourStepDefinition {
  id: string;
  target: `[data-tour="${string}"]`;
  interactionTarget?: `[data-tour="${string}"]`;
  interactionArea?: `[data-tour="${string}"]`;
  spotlightTarget?: `[data-tour="${string}"]`;
  kind: TourStepKind;
  title: string | (() => string);
  content: string | (() => string);
  waitForTarget?: boolean;
  placement?: "center" | "auto" | "top" | "bottom" | "left" | "right" | "bottom-end";
}

export interface TourDefinition {
  id: TourId;
  label: string | (() => string);
  version: number;
  contexts: readonly TourContext[];
  priority: number;
  autoStart?: boolean;
  steps: readonly TourStepDefinition[];
}

export function resolveTourText(value: string | (() => string)): string {
  return typeof value === "function" ? value() : value;
}

export function stepNeedsReachableTarget(step: TourStepDefinition): boolean {
  return (
    step.kind === "required-click" ||
    step.kind === "required-input" ||
    Boolean(step.interactionArea)
  );
}

export const tourRegistry = {
  home: {
    id: "home",
    label: () => i18n.t(($) => $.onboarding.home.label),
    version: 6,
    contexts: ["home"],
    priority: 10,
    steps: [
      {
        id: "home-overview",
        target: '[data-tour="home"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.home.overview.title),
        content: () => i18n.t(($) => $.onboarding.home.overview.content),
        waitForTarget: true,
        placement: "center",
      },
      {
        id: "home-create",
        target: '[data-tour="new-project"]',
        kind: "required-click",
        title: () => i18n.t(($) => $.onboarding.home.create.title),
        content: () => i18n.t(($) => $.onboarding.home.create.content),
        waitForTarget: true,
        placement: "bottom-end",
      },
      {
        id: "home-kind",
        target: '[data-tour="project-kind-chooser"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.home.kind.title),
        content: () => i18n.t(($) => $.onboarding.home.kind.content),
        waitForTarget: true,
        placement: "center",
      },
      {
        id: "home-kind-template",
        target: '[data-tour="project-kind-template"]',
        kind: "required-click",
        title: () => i18n.t(($) => $.onboarding.home.kindTemplate.title),
        content: () => i18n.t(($) => $.onboarding.home.kindTemplate.content),
        waitForTarget: true,
        placement: "top",
      },
      {
        id: "home-gallery",
        target: '[data-tour="project-template-list"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.home.gallery.title),
        content: () => i18n.t(($) => $.onboarding.home.gallery.content),
        waitForTarget: true,
        placement: "center",
      },
      {
        id: "home-template",
        target: '[data-tour="project-template-list"]',
        interactionTarget: '[data-tour="project-template-card"]',
        interactionArea: '[data-tour="project-template-list"]',
        kind: "required-click",
        title: () => i18n.t(($) => $.onboarding.home.template.title),
        content: () => i18n.t(($) => $.onboarding.home.template.content),
        waitForTarget: true,
      },
      {
        id: "home-name",
        target: '[data-tour="project-name"]',
        kind: "required-input",
        title: () => i18n.t(($) => $.onboarding.home.name.title),
        content: () => i18n.t(($) => $.onboarding.home.name.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "home-color",
        target: '[data-tour="project-cover-color"]',
        interactionArea: '[data-tour="project-cover-color"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.home.color.title),
        content: () => i18n.t(($) => $.onboarding.home.color.content),
        waitForTarget: true,
        placement: "top",
      },
      {
        id: "home-create-project",
        target: '[data-tour="create-project"]',
        kind: "required-click",
        title: () => i18n.t(($) => $.onboarding.home.createProject.title),
        content: () => i18n.t(($) => $.onboarding.home.createProject.content),
        waitForTarget: true,
        placement: "top",
      },
    ],
  },
  workspace: {
    id: "workspace",
    label: () => i18n.t(($) => $.onboarding.workspace.label),
    version: 4,
    contexts: ["project"],
    priority: 20,
    steps: [
      {
        id: "workspace-toolbar",
        target: '[data-tour="project-toolbar"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.toolbar.title),
        content: () => i18n.t(($) => $.onboarding.workspace.toolbar.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "workspace-sidebar",
        target: '[data-tour="project-sidebar"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.sidebar.title),
        content: () => i18n.t(($) => $.onboarding.workspace.sidebar.content),
        waitForTarget: true,
        placement: "right",
      },
      {
        id: "workspace-editor",
        target: '[data-tour="project-editor"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.editor.title),
        content: () => i18n.t(($) => $.onboarding.workspace.editor.content),
        waitForTarget: true,
        placement: "right",
      },
      {
        id: "workspace-wysiwyg-toggle",
        target: '[data-tour="wysiwyg-toggle"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.wysiwygToggle.title),
        content: () => i18n.t(($) => $.onboarding.workspace.wysiwygToggle.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "workspace-compile",
        target: '[data-tour="project-compile"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.compile.title),
        content: () => i18n.t(($) => $.onboarding.workspace.compile.content),
        waitForTarget: true,
        placement: "bottom-end",
      },
      {
        id: "workspace-logs",
        target: '[data-tour="project-compile-logs"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.logs.title),
        content: () => i18n.t(($) => $.onboarding.workspace.logs.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "workspace-preview",
        target: '[data-tour="project-preview"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.preview.title),
        content: () => i18n.t(($) => $.onboarding.workspace.preview.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "workspace-zoom",
        target: '[data-tour="project-preview-zoom"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.zoom.title),
        content: () => i18n.t(($) => $.onboarding.workspace.zoom.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "workspace-source-navigation",
        target: '[data-tour="project-preview-content"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.workspace.sourceNavigation.title),
        content: () => i18n.t(($) => $.onboarding.workspace.sourceNavigation.content),
        waitForTarget: true,
        placement: "left",
      },
    ],
  },
  research: {
    id: "research",
    label: () => i18n.t(($) => $.onboarding.research.label),
    version: 1,
    contexts: ["project"],
    priority: 25,
    steps: [
      {
        id: "research-open",
        target: '[data-tour="rail-research"]',
        kind: "required-click",
        title: () => i18n.t(($) => $.onboarding.research.open.title),
        content: () => i18n.t(($) => $.onboarding.research.open.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "research-tasks",
        target: '[data-tour="research-tasks"]',
        spotlightTarget: '[data-tour="research-workspace"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.research.tasks.title),
        content: () => i18n.t(($) => $.onboarding.research.tasks.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "research-folders",
        target: '[data-tour="research-folders"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.research.folders.title),
        content: () => i18n.t(($) => $.onboarding.research.folders.content),
        waitForTarget: true,
        placement: "bottom",
      },
    ],
  },
  settings: {
    id: "settings",
    label: () => i18n.t(($) => $.onboarding.settings.label),
    version: 3,
    contexts: ["settings"],
    priority: 30,
    steps: [
      {
        id: "settings-navigation",
        target: '[data-tour="settings-navigation"]',
        spotlightTarget: '[data-tour="settings-navigation-panel"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.settings.navigation.title),
        content: () => i18n.t(($) => $.onboarding.settings.navigation.content),
        waitForTarget: true,
        placement: "right",
      },
      {
        id: "settings-general",
        target: '[data-tour="settings-general"]',
        spotlightTarget: '[data-tour="settings-general-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.general.title),
        content: () => i18n.t(($) => $.onboarding.settings.general.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-appearance",
        target: '[data-tour="settings-appearance"]',
        spotlightTarget: '[data-tour="settings-appearance-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.appearance.title),
        content: () => i18n.t(($) => $.onboarding.settings.appearance.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-dictionary",
        target: '[data-tour="settings-dictionary"]',
        spotlightTarget: '[data-tour="settings-dictionary-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.dictionary.title),
        content: () => i18n.t(($) => $.onboarding.settings.dictionary.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-data",
        target: '[data-tour="settings-data"]',
        spotlightTarget: '[data-tour="settings-data-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.data.title),
        content: () => i18n.t(($) => $.onboarding.settings.data.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-compiler",
        target: '[data-tour="settings-compiler"]',
        spotlightTarget: '[data-tour="settings-compiler-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.compiler.title),
        content: () => i18n.t(($) => $.onboarding.settings.compiler.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-downloads",
        target: '[data-tour="settings-downloads"]',
        spotlightTarget: '[data-tour="settings-downloads-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.downloads.title),
        content: () => i18n.t(($) => $.onboarding.settings.downloads.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-integrations",
        target: '[data-tour="settings-integrations"]',
        spotlightTarget: '[data-tour="settings-integrations-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.integrations.title),
        content: () => i18n.t(($) => $.onboarding.settings.integrations.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-shortcuts",
        target: '[data-tour="settings-shortcuts"]',
        spotlightTarget: '[data-tour="settings-shortcuts-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.shortcuts.title),
        content: () => i18n.t(($) => $.onboarding.settings.shortcuts.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "settings-help",
        target: '[data-tour="settings-help"]',
        spotlightTarget: '[data-tour="settings-help-panel"]',
        kind: "transition",
        title: () => i18n.t(($) => $.onboarding.settings.help.title),
        content: () => i18n.t(($) => $.onboarding.settings.help.content),
        waitForTarget: true,
        placement: "left",
      },
    ],
  },
  diagram: {
    id: "diagram",
    label: () => i18n.t(($) => $.onboarding.diagram.label),
    version: 4,
    contexts: ["diagram"],
    priority: 50,
    steps: [
      {
        id: "diagram-composer",
        target: '[data-tour="diagram-intro-anchor"]',
        spotlightTarget: '[data-tour="diagram-canvas"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.composer.title),
        content: () => i18n.t(($) => $.onboarding.diagram.composer.content),
        waitForTarget: true,
        placement: "bottom",
      },
      {
        id: "diagram-import",
        target: '[data-tour="diagram-import"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.import.title),
        content: () => i18n.t(($) => $.onboarding.diagram.import.content),
        waitForTarget: true,
      },
      {
        id: "diagram-modes",
        target: '[data-tour="diagram-modes"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.modes.title),
        content: () => i18n.t(($) => $.onboarding.diagram.modes.content),
        waitForTarget: true,
      },
      {
        id: "diagram-palette",
        target: '[data-tour="diagram-palette"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.palette.title),
        content: () => i18n.t(($) => $.onboarding.diagram.palette.content),
        waitForTarget: true,
      },
      {
        id: "diagram-handles",
        target: '[data-tour="diagram-handles"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.handles.title),
        content: () => i18n.t(($) => $.onboarding.diagram.handles.content),
        waitForTarget: true,
      },
      {
        id: "diagram-inspector",
        target: '[data-tour="diagram-inspector"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.inspector.title),
        content: () => i18n.t(($) => $.onboarding.diagram.inspector.content),
        waitForTarget: true,
      },
      {
        id: "diagram-preview",
        target: '[data-tour="diagram-preview-panel"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.preview.title),
        content: () => i18n.t(($) => $.onboarding.diagram.preview.content),
        waitForTarget: true,
        placement: "left",
      },
      {
        id: "diagram-compile",
        target: '[data-tour="diagram-compile"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.compile.title),
        content: () => i18n.t(($) => $.onboarding.diagram.compile.content),
        waitForTarget: true,
      },
      {
        id: "diagram-save-project",
        target: '[data-tour="diagram-save-project"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.saveProject.title),
        content: () => i18n.t(($) => $.onboarding.diagram.saveProject.content),
        waitForTarget: true,
      },
      {
        id: "diagram-download",
        target: '[data-tour="diagram-download"]',
        kind: "informational",
        title: () => i18n.t(($) => $.onboarding.diagram.download.title),
        content: () => i18n.t(($) => $.onboarding.diagram.download.content),
        waitForTarget: true,
      },
    ],
  },
} as const satisfies Record<TourId, TourDefinition>;

export const TOUR_SCHEMA_VERSION = 1;

const availableTourIds = new Set<string>(AVAILABLE_TOUR_IDS);

export function isTourAvailable(id: unknown): id is AvailableTourId {
  return typeof id === "string" && availableTourIds.has(id);
}

export function toursForContext(context: TourContext): TourDefinition[] {
  return Object.values(tourRegistry)
    .filter(
      (tour) =>
        isTourAvailable(tour.id) &&
        (tour.contexts as readonly TourContext[]).includes(context),
    )
    .sort((a, b) => a.priority - b.priority);
}
