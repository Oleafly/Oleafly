import { useEffect, useMemo, useState } from "react";
import {
  EVENTS,
  Joyride,
  STATUS,
  type EventData,
  type Step,
  type TooltipRenderProps,
} from "react-joyride";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { START_TOUR_EVENT } from "@/lib/tour";

function TourTooltip({
  backProps,
  closeProps,
  continuous,
  index,
  isLastStep,
  primaryProps,
  size,
  skipProps,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      className="w-[min(20rem,calc(100vw-2rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {step.title && <h2 className="text-sm font-semibold">{step.title}</h2>}
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {step.content}
          </div>
        </div>
        <Button
          {...closeProps}
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-7 shrink-0"
        >
          <X />
        </Button>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {index + 1} / {size}
        </span>
        <Button {...skipProps} variant="ghost" size="sm" className="ml-1">
          Skip
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {index > 0 && (
            <Button {...backProps} variant="ghost" size="sm">
              Back
            </Button>
          )}
          {continuous && (
            <Button {...primaryProps} size="sm">
              {isLastStep ? "Done" : "Next"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const homeSteps: Step[] = [
  {
    target: '[data-tour="home"]',
    title: "Home",
    content: "Your projects, recent work, search, settings, and project creation all begin here.",
    placement: "center",
  },
  {
    target: '[data-tour="new-project"]',
    title: "Create a project",
    content: "Start from a blank document, template, imported archive, or supported source format.",
    placement: "bottom-end",
  },
  {
    target: '[data-tour="settings"]',
    title: "Settings",
    content: "Configure appearance, compilation, downloads, AI providers, GitHub, MCP, and local storage.",
    placement: "bottom-end",
  },
];

const projectSteps: Step[] = [
  {
    target: '[data-tour="project-toolbar"]',
    title: "Project toolbar",
    content: "Rename the project, change views, compile, export, inspect history, and publish from here.",
    placement: "bottom",
  },
  {
    target: '[data-tour="project-sidebar"]',
    title: "Workspace",
    content: "Move between files, search, source control, preflight, AI, integrations, and project tools.",
    placement: "right",
  },
  {
    target: '[data-tour="project-editor"]',
    title: "Editor",
    content: "Write and navigate your source with completion, diagnostics, formatting, and code intelligence.",
    placement: "right",
  },
  {
    target: '[data-testid="compile-button"]',
    title: "Compile",
    content: "Build the current project with its real compiler and refresh the rendered output.",
    placement: "bottom-end",
  },
  {
    target: '[data-tour="project-preview"]',
    title: "PDF preview",
    content: "Inspect the result, zoom, search, export, and click PDF content to jump back to its source.",
    placement: "left",
  },
];

export function TourGuide() {
  const projectId = useFilesStore((s) => s.projectId);
  const [run, setRun] = useState(false);
  const [instance, setInstance] = useState(0);
  const steps = useMemo(() => (projectId ? projectSteps : homeSteps), [projectId]);

  useEffect(() => {
    const start = () => {
      if (useFilesStore.getState().projectId) {
        useSettingsStore.getState().setViewMode("split");
      }
      setRun(false);
      setInstance((value) => value + 1);
      window.requestAnimationFrame(() => setRun(true));
    };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  const onEvent = (data: EventData) => {
    if (data.type !== EVENTS.TOUR_END) return;
    setRun(false);
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      localStorage.setItem(
        projectId ? "oleafly.tour.project.v1" : "oleafly.tour.home.v1",
        data.status,
      );
    }
  };

  return (
    <Joyride
      key={instance}
      run={run}
      steps={steps}
      continuous
      scrollToFirstStep
      tooltipComponent={TourTooltip}
      onEvent={onEvent}
      options={{
        arrowColor: "var(--popover)",
        backgroundColor: "var(--popover)",
        blockTargetInteraction: true,
        buttons: ["back", "close", "primary", "skip"],
        overlayClickAction: false,
        primaryColor: "var(--primary)",
        showProgress: true,
        skipBeacon: true,
        spotlightPadding: 6,
        spotlightRadius: 8,
        targetWaitTimeout: 5000,
        textColor: "var(--popover-foreground)",
        width: 320,
        zIndex: 100,
      }}
    />
  );
}
