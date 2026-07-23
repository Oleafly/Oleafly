import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS,
  EVENTS,
  Joyride,
  STATUS,
  type ArrowRenderProps,
  type EventData,
  type Step,
  type TooltipRenderProps,
} from "react-joyride";
import { modalCoordinator } from "@oleafly/templates/modal-coordinator";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Button } from "@/components/ui/button";
import { START_TOUR_EVENT } from "@/lib/tour";
import { evaluateTour, missingTargetFallback } from "@/lib/tours/coordinator";
import {
  tourRegistry,
  type TourContext,
  type TourStepDefinition,
} from "@/lib/tours/registry";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";

function TourTooltip(props: TooltipRenderProps) {
  const {
    backProps,
    continuous,
    index,
    isLastStep,
    primaryProps,
    size,
    skipProps,
    step,
    tooltipProps,
  } = props;
  const definition = step.data as TourStepDefinition;
  const requiredClick = definition.kind === "required-click";
  const inputReady =
    definition.kind !== "required-input" ||
    Boolean(document.querySelector<HTMLInputElement>(`${definition.target}`)?.value.trim());

  return (
    <div
      {...tooltipProps}
      data-tour-tooltip={definition.id}
      className="w-[min(21rem,calc(100vw-2rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      {definition.id === "home-overview" ? (
        <svg
          aria-hidden
          className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 h-[clamp(7rem,30vh,22rem)] w-24 -translate-x-1/2 overflow-visible text-primary"
          viewBox="0 0 96 320"
          preserveAspectRatio="none"
        >
          <title>Hand-drawn arrow pointing to Home</title>
          <path
            d="M52 316 C80 258, 19 222, 55 166 C81 124, 28 88, 49 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M31 45 L49 24 L63 51 M34 48 L49 27"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {definition.id === "home-gallery" ? (
        <svg
          aria-hidden
          className="pointer-events-none absolute left-[62%] top-[calc(100%+8px)] h-32 w-44 overflow-visible text-primary"
          viewBox="0 0 176 128"
          preserveAspectRatio="none"
        >
          <title>Hand-drawn arrow pointing to the template gallery</title>
          <path
            d="M8 4 C48 18, 27 64, 78 77 C111 86, 128 103, 157 113"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M137 96 L159 114 L132 120 M139 99 L157 113"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {definition.id === "diagram-composer" || definition.id === "diagram-canvas" ? (
        <svg
          aria-hidden
          className="pointer-events-none absolute right-[calc(100%-8px)] top-1/2 h-40 w-48 overflow-visible text-primary"
          viewBox="0 0 192 160"
          preserveAspectRatio="none"
        >
          <title>Hand-drawn arrow pointing to the diagram canvas</title>
          <path
            d="M188 10 C151 18, 169 65, 119 76 C78 86, 73 124, 25 139"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M46 106 L23 140 L61 151"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {step.title ? <h2 className="text-sm font-semibold">{step.title}</h2> : null}
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.content}</div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {index + 1} / {size}
        </span>
        <Button {...skipProps} variant="ghost" size="sm" className="ml-1">
          Skip
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {index > 0 ? (
            <Button {...backProps} variant="ghost" size="sm">
              Back
            </Button>
          ) : null}
          {continuous && !requiredClick ? (
            <Button {...primaryProps} disabled={!inputReady} size="sm">
              {isLastStep ? "Done" : "Next"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function tourArrowSide(placement?: string) {
  return (placement ?? "top").split("-")[0];
}

export function isTourTargetReady(target: string, element: HTMLElement | null) {
  if (!element) return false;
  if (target === '[data-tour="ai-assistant"]') {
    return element.dataset.tourReady === "true";
  }
  return true;
}

export function isAiStepApplicable(stepId: string, root: HTMLElement) {
  const configured = root.dataset.tourConfigured === "true";
  if (stepId === "ai-connect-provider") return !configured;
  if (stepId === "ai-history") return configured;
  if (stepId === "ai-usage") {
    return configured && root.dataset.tourHasUsage === "true";
  }
  if (stepId === "ai-restore") {
    return configured && root.dataset.tourHasRestore === "true";
  }
  if (
    stepId === "ai-provider-model" ||
    stepId === "ai-input" ||
    stepId === "ai-attachments"
  ) {
    return configured;
  }
  return true;
}

function SeamlessArrow({ base, placement, size }: ArrowRenderProps) {
  const side = tourArrowSide(placement);
  const points =
    side === "top"
      ? `0,0 ${base / 2},${size} ${base},0`
      : side === "bottom"
        ? `${base},${size} ${base / 2},0 0,${size}`
        : side === "left"
          ? `0,0 ${size},${base / 2} 0,${base}`
          : `${size},${base} ${size},0 0,${base / 2}`;
  const width = side === "top" || side === "bottom" ? base : size;
  const height = side === "top" || side === "bottom" ? size : base;
  const exposedEdge =
    side === "top"
      ? `0,0 ${base / 2},${size} ${base},0`
      : side === "bottom"
        ? `${base},${size} ${base / 2},0 0,${size}`
        : side === "left"
          ? `0,0 ${size},${base / 2} 0,${base}`
          : `${size},${base} 0,${base / 2} ${size},0`;
  const overlap =
    side === "top"
      ? "translateY(-1px)"
      : side === "bottom"
        ? "translateY(1px)"
        : side === "left"
          ? "translateX(-1px)"
          : "translateX(1px)";
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible", transform: overlap }}
    >
      <title>Tour tooltip pointer</title>
      <polygon points={points} fill="var(--popover)" />
      <polyline
        points={exposedEdge}
        fill="none"
        stroke="var(--border)"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function toJoyrideStep(step: TourStepDefinition): Step {
  return {
    id: step.id,
    target: step.target,
    title: step.title,
    content: step.content,
    placement: step.placement ?? "bottom",
    spotlightTarget: step.spotlightTarget,
    data: step,
    blockTargetInteraction:
      !step.interactionArea && step.kind !== "required-click" && step.kind !== "required-input",
  };
}

export function shouldSuppressTourKey({
  key,
  metaKey,
  ctrlKey,
  altKey,
  inRequiredInput,
  inRequiredClick,
  inPortal,
}: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  inRequiredInput: boolean;
  inRequiredClick: boolean;
  inPortal: boolean;
}) {
  if (key === "Tab") return false;
  const isEditableChord =
    inRequiredInput &&
    (((metaKey || ctrlKey) &&
      !altKey &&
      ["a", "c", "v", "x", "z"].includes(key.toLowerCase())) ||
      (ctrlKey && altKey && !metaKey) ||
      (altKey && !ctrlKey && !metaKey && key.length === 1));
  if (isEditableChord) return false;
  if (key === "Escape" || metaKey || ctrlKey || altKey || /^F\d{1,2}$/.test(key)) return true;
  if ((key === "Enter" || key === " ") && (inPortal || inRequiredClick)) return false;
  if (inRequiredInput) return false;
  return true;
}

export function shouldCompleteTourAfterStep(
  action: string,
  stepIndex: number,
  stepCount: number,
) {
  return (
    action === ACTIONS.COMPLETE ||
    (action === ACTIONS.NEXT && stepIndex >= Math.max(0, stepCount - 1))
  );
}

export function terminalTourAction(action: string, status: string) {
  if (status === STATUS.FINISHED) return "complete" as const;
  if (action === ACTIONS.SKIP || action === ACTIONS.CLOSE) return "dismiss" as const;
  return "interrupt" as const;
}

export function missingTargetAction(
  direction: "next" | "prev",
  kind: TourStepDefinition["kind"],
  isLastStep: boolean,
) {
  if (direction === "prev") return "back" as const;
  if (missingTargetFallback(kind) !== "advance") return "dismiss" as const;
  return isLastStep ? ("complete" as const) : ("advance" as const);
}

export function shouldCloseProjectDialogOnBack(
  tourId: string | null,
  stepId: string | undefined,
) {
  return tourId === "home" && stepId === "home-gallery";
}

export function autoSkipAction(
  direction: "next" | "prev",
  isFinalStep = false,
): "advance" | "back" | "complete" {
  if (direction === "prev") return "back";
  return isFinalStep ? "complete" : "advance";
}

function Welcome({ onStart }: { onStart: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = modalCoordinator.add(opener);
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector("button")?.focus());
    const blockEscape = (event: KeyboardEvent) => {
      if (!modalCoordinator.isTop(id)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.key !== "Tab") return;
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (!first || !last) return;
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!modalCoordinator.isTop(id) || dialogRef.current?.contains(event.target as Node)) return;
      dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("keydown", blockEscape, true);
    document.addEventListener("focusin", containFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", blockEscape, true);
      document.removeEventListener("focusin", containFocus);
      modalCoordinator.remove(id)?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-welcome-title"
        data-testid="tour-welcome"
        className="w-full max-w-md rounded-xl border bg-popover p-7 text-center text-popover-foreground shadow-2xl"
      >
        <LeafLogo className="mx-auto size-12" />
        <h1 id="tour-welcome-title" className="mt-4 text-xl font-semibold">
          Welcome to Oleafly
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Create, compile, and manage beautiful documents locally. Your projects stay on your
          disk, and Oleafly guides you from a template to a finished PDF.
        </p>
        <Button className="mt-6" onClick={onStart}>
          Show me around
        </Button>
      </div>
    </div>
  );
}

function TourBackdropBlur({ target }: { target: string }) {
  const [rect, setRect] = useState<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    let element: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const update = () => {
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const padding = 6;
      setRect({
        top: Math.max(0, bounds.top - padding),
        right: Math.min(window.innerWidth, bounds.right + padding),
        bottom: Math.min(window.innerHeight, bounds.bottom + padding),
        left: Math.max(0, bounds.left - padding),
      });
    };
    let mutationObserver: MutationObserver | null = null;
    const connect = () => {
      const next = document.querySelector<HTMLElement>(target);
      if (!next || next === element) return Boolean(next);
      resizeObserver?.disconnect();
      element = next;
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(element);
      update();
      mutationObserver?.disconnect();
      return true;
    };
    setRect(null);
    connect();
    if (!element) {
      mutationObserver = new MutationObserver(connect);
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target]);

  if (!rect) return null;

  const blurStyle = {
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    backgroundColor: "rgba(0, 0, 0, 0.01)",
    pointerEvents: "none" as const,
    position: "fixed" as const,
    zIndex: 109,
  };

  return (
    <>
      <div style={{ ...blurStyle, inset: `0 0 auto 0`, height: rect.top }} />
      <div
        style={{
          ...blurStyle,
          inset: `${rect.bottom}px 0 0 0`,
        }}
      />
      <div
        style={{
          ...blurStyle,
          left: 0,
          top: rect.top,
          width: rect.left,
          height: Math.max(0, rect.bottom - rect.top),
        }}
      />
      <div
        style={{
          ...blurStyle,
          left: rect.right,
          right: 0,
          top: rect.top,
          height: Math.max(0, rect.bottom - rect.top),
        }}
      />
    </>
  );
}

function currentContext(
  projectId: string | null,
  settingsOpen: boolean,
  diagramOpen: boolean,
  railTab: string,
  chatFloating: boolean,
): TourContext {
  if (diagramOpen) return "diagram";
  if (settingsOpen) return "settings";
  if (projectId && (chatFloating || railTab === "ai" || railTab === "chat")) return "ai";
  return projectId ? "project" : "home";
}

export function TourGuide() {
  const projectId = useFilesStore((state) => state.projectId);
  const newProjectOpen = useSettingsStore((state) => state.newProjectOpen);
  const settingsOpen = useSettingsStore((state) => state.settingsOpen);
  const diagramOpen = useHomeViewStore((state) => state.page === "diagram-composer");
  const railTab = useSettingsStore((state) => state.railTab);
  const chatFloating = useSettingsStore((state) => state.chatFloating);
  const enabled = useTourStore((state) => state.enabled);
  const tours = useTourStore((state) => state.tours);
  const activeTourId = useTourStore((state) => state.activeTourId);
  const activeStepIndex = useTourStore((state) => state.activeStepIndex);
  const [welcomeAccepted, setWelcomeAccepted] = useState(false);
  const [inputRevision, setInputRevision] = useState(0);
  const [libraryReady, setLibraryReady] = useState(false);
  const [joyrideInstance, setJoyrideInstance] = useState(0);
  const [aiReadinessRevision, setAiReadinessRevision] = useState(0);
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const previousViewMode = useRef<ReturnType<typeof useSettingsStore.getState>["viewMode"] | null>(
    null,
  );
  const previousSettings = useRef<{ section: string; advanced: boolean } | null>(null);
  const navigationDirection = useRef<"next" | "prev">("next");
  const definition = activeTourId ? tourRegistry[activeTourId] : null;
  const activeStep = definition?.steps[activeStepIndex];
  const steps = useMemo<Step[]>(
    () => {
      void inputRevision;
      return definition?.steps.map(toJoyrideStep) ?? [];
    },
    [definition, inputRevision],
  );

  const showWelcome =
    enabled &&
    !projectId &&
    !activeTourId &&
    tours.home.status === "pending" &&
    !welcomeAccepted &&
    !newProjectOpen &&
    !settingsOpen &&
    libraryReady;

  useEffect(() => {
    void activeTourId;
    navigationDirection.current = "next";
  }, [activeTourId]);

  useEffect(() => {
    const ready =
      document.querySelector('[data-tour="home"][data-projects-loaded="true"]') !== null;
    setLibraryReady(ready);
    if (ready) return;
    const update = () => {
      const next =
        document.querySelector('[data-tour="home"][data-projects-loaded="true"]') !== null;
      setLibraryReady(next);
      if (next) observer.disconnect();
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void aiReadinessRevision;
    if (showWelcome || activeTourId) return;
    if (!projectId && tours.home.status === "pending" && !libraryReady) return;
    const context = currentContext(projectId, settingsOpen, diagramOpen, railTab, chatFloating);
    const evaluateCurrentContext = () => {
      const state = useTourStore.getState();
      return evaluateTour(
        { enabled: state.enabled, tours: state.tours, activeTourId: state.activeTourId },
        context,
        {
          blockingOverlay:
            newProjectOpen ||
            (diagramOpen && settingsOpen) ||
            (diagramOpen && context !== "diagram") ||
            (settingsOpen && context !== "settings"),
          targetExists: (target) =>
            isTourTargetReady(target, document.querySelector<HTMLElement>(target)),
        },
      );
    };
    const result = evaluateCurrentContext();
    if (result.tourId) {
      useTourStore.getState().start(result.tourId);
      return;
    }
    if (result.reason !== "missing-target") return;
    let frame = 0;
    let disposed = false;
    const deadline = performance.now() + 10_000;
    const stopWaiting = () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    const retry = () => {
      if (disposed) return;
      const next = evaluateCurrentContext();
      if (next.tourId) {
        stopWaiting();
        useTourStore.getState().start(next.tourId);
        return;
      }
      if (next.reason !== "missing-target" || performance.now() >= deadline) {
        stopWaiting();
        return;
      }
      frame = requestAnimationFrame(retry);
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(retry);
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-tour", "data-tour-ready", "hidden", "style"],
      childList: true,
      subtree: true,
    });
    frame = requestAnimationFrame(retry);
    return stopWaiting;
  }, [
    activeTourId,
    aiReadinessRevision,
    chatFloating,
    diagramOpen,
    libraryReady,
    newProjectOpen,
    projectId,
    railTab,
    settingsOpen,
    showWelcome,
    tours,
  ]);

  useEffect(() => {
    if (activeTourId !== "settings" || !activeStep) return;
    const sectionByStep: Partial<Record<string, string>> = {
      "settings-general": "general",
      "settings-appearance": "appearance",
      "settings-dictionary": "dictionary",
      "settings-data": "data",
      "settings-ai": "ai",
      "settings-compiler": "engine",
      "settings-downloads": "downloads",
      "settings-github": "github",
      "settings-shortcuts": "shortcuts",
      "settings-mcp": "mcp",
      "settings-help": "help",
    };
    const section = sectionByStep[activeStep.id];
    if (!section) return;
    if (
      section === "dictionary" ||
      section === "data" ||
      section === "engine" ||
      section === "downloads"
    ) {
      const advanced = document.querySelector<HTMLElement>(
        '[data-testid="settings-toggle-advanced"][aria-checked="false"]',
      );
      advanced?.click();
    }
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-testid="settings-section-${section}"]`)?.click(),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeStep, activeTourId]);

  useEffect(() => {
    if (activeTourId === "settings" && previousSettings.current === null) {
      const selected = document.querySelector<HTMLElement>(
        '[data-testid^="settings-section-"][aria-current="page"]',
      );
      previousSettings.current = {
        section: selected?.dataset.testid?.replace("settings-section-", "") ?? "general",
        advanced:
          document
            .querySelector<HTMLElement>('[data-testid="settings-toggle-advanced"]')
            ?.getAttribute("aria-checked") === "true",
      };
    }
    if (activeTourId !== "settings" && previousSettings.current !== null) {
      const previous = previousSettings.current;
      const advanced = document.querySelector<HTMLElement>(
        '[data-testid="settings-toggle-advanced"]',
      );
      if (
        advanced &&
        (advanced.getAttribute("aria-checked") === "true") !== previous.advanced
      ) {
        advanced.click();
      }
      const frame = requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[data-testid="settings-section-${previous.section}"]`)
          ?.click(),
      );
      previousSettings.current = null;
      return () => cancelAnimationFrame(frame);
    }
  }, [activeTourId]);

  useEffect(() => {
    if (!activeTourId || !activeStep) return;
    const suppress = (event: KeyboardEvent) => {
      const tourStep = activeStep as TourStepDefinition;
      const interactionTarget =
        tourStep.interactionArea ?? tourStep.interactionTarget ?? tourStep.target;
      const target =
        event.target instanceof Element ? event.target.closest(interactionTarget) : null;
      const inInteractionArea =
        Boolean(tourStep.interactionArea) &&
        event.target instanceof Element &&
        Boolean(event.target.closest(tourStep.interactionArea as string));
      const inPortal =
        event.target instanceof Element &&
        Boolean(event.target.closest("#react-joyride-portal"));
      const blocked = shouldSuppressTourKey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        inRequiredInput:
          (activeStep.kind === "required-input" && Boolean(target)) || inInteractionArea,
        inRequiredClick: activeStep.kind === "required-click" && Boolean(target),
        inPortal,
      });
      if (!blocked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", suppress, true);
    return () => window.removeEventListener("keydown", suppress, true);
  }, [activeStep, activeTourId]);

  useEffect(() => {
    let pendingFrame: number | null = null;
    const manualStart = (event: Event) => {
      if (diagramOpen && settingsOpen) return;
      const requestedId =
        event instanceof CustomEvent ? (event.detail as keyof typeof tourRegistry | undefined) : undefined;
      const id =
        requestedId ??
        (diagramOpen
          ? "diagram"
          : settingsOpen
            ? "settings"
            : projectId && (chatFloating || railTab === "ai" || railTab === "chat")
              ? "ai"
              : projectId
                ? "workspace"
                : "home");
      setWelcomeAccepted(true);
      useTourStore.getState().stop();
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        useTourStore.getState().restart(id);
      });
    };
    window.addEventListener(START_TOUR_EVENT, manualStart);
    return () => {
      window.removeEventListener(START_TOUR_EVENT, manualStart);
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    };
  }, [chatFloating, diagramOpen, projectId, railTab, settingsOpen]);

  useEffect(() => {
    if (!activeTourId) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restorationTarget = newProjectOpen
      ? document.querySelector<HTMLElement>('[data-tour="project-template-gallery"]') ?? focused
      : focused;
    let id: symbol | null = null;
    const register = () => {
      const portal = document.getElementById("react-joyride-portal");
      if (!portal || id) return;
      id = modalCoordinator.add(restorationTarget, portal);
    };
    register();
    const observer = new MutationObserver(register);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (id) modalCoordinator.remove(id)?.focus();
      else focused?.focus();
    };
  }, [activeTourId, newProjectOpen]);

  useEffect(() => {
    if (activeTourId) return;
    document.getElementById("react-joyride-portal")?.remove();
  }, [activeTourId]);

  useEffect(() => {
    if (activeTourId === "workspace" && previousViewMode.current === null) {
      previousViewMode.current = useSettingsStore.getState().viewMode;
      useSettingsStore.getState().setViewMode("split");
    }
    if (activeTourId !== "workspace" && previousViewMode.current !== null) {
      useSettingsStore.getState().setViewMode(previousViewMode.current);
      previousViewMode.current = null;
    }
  }, [activeTourId]);

  useEffect(
    () => () => {
      if (previousViewMode.current !== null) {
        useSettingsStore.getState().setViewMode(previousViewMode.current);
        previousViewMode.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeTourId || !activeStep?.waitForTarget) return;
    const tourId = activeTourId;
    const stepIndex = activeStepIndex;
    const target = activeStep.target;
    if (document.querySelector(target)) return;
    const isCurrentStep = () => {
      const state = useTourStore.getState();
      return state.activeTourId === tourId && state.activeStepIndex === stepIndex;
    };
    const observer = new MutationObserver(() => {
      if (!isCurrentStep() || !document.querySelector(target)) return;
      observer.disconnect();
      window.clearTimeout(fallback);
      setJoyrideInstance((value) => value + 1);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const fallback = window.setTimeout(() => {
      observer.disconnect();
      if (!isCurrentStep()) return;
      const action = missingTargetAction(
        navigationDirection.current,
        activeStep.kind,
        activeStepIndex >= (definition?.steps.length ?? 1) - 1,
      );
      useTourStore.getState()[action](action === "dismiss" || action === "complete" ? tourId : undefined);
    }, 750);
    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, [activeStep, activeStepIndex, activeTourId, definition]);

  useEffect(() => {
    let lastReadiness =
      document
        .querySelector<HTMLElement>('[data-tour="ai-assistant"]')
        ?.getAttribute("data-tour-ready") ?? null;
    const observer = new MutationObserver(() => {
      const readiness =
        document
          .querySelector<HTMLElement>('[data-tour="ai-assistant"]')
          ?.getAttribute("data-tour-ready") ?? null;
      if (readiness === lastReadiness) return;
      lastReadiness = readiness;
      setAiReadinessRevision((value) => value + 1);
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-tour-ready"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void aiReadinessRevision;
    if (!activeStep || activeTourId !== "ai") return;
    const root = document.querySelector<HTMLElement>('[data-tour="ai-assistant"]');
    if (root?.dataset.tourReady !== "true") return;
    if (isAiStepApplicable(activeStep.id, root)) return;
    const timeout = window.setTimeout(() => {
      const action = autoSkipAction(
        navigationDirection.current,
        activeStepIndex >= (definition?.steps.length ?? 1) - 1,
      );
      useTourStore.getState()[action]();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [activeStep, activeStepIndex, activeTourId, aiReadinessRevision, definition]);

  useEffect(() => {
    const modes = document.querySelector<HTMLElement>('[data-tour="diagram-modes"]');
    if (!modes) return;
    if (activeTourId === "diagram" && activeStep?.id === "diagram-modes") {
      modes.dataset.tourActive = "true";
    } else {
      delete modes.dataset.tourActive;
    }
    return () => {
      delete modes.dataset.tourActive;
    };
  }, [activeStep, activeTourId]);

  useEffect(() => {
    if (
      !activeStep ||
      activeTourId !== "diagram" ||
      (activeStep.id !== "diagram-inspector" && activeStep.id !== "diagram-handles")
    ) {
      return;
    }
    const canvas = document.querySelector<HTMLElement>('[data-tour="diagram-canvas"]');
    if (!canvas || canvas.dataset.tourSelection === "true") return;
    const timeout = window.setTimeout(() => {
      useTourStore.getState()[autoSkipAction(navigationDirection.current)]();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [activeStep, activeTourId]);

  useEffect(() => {
    if (
      activeTourId === "home" &&
      activeStep?.id === "home-create" &&
      newProjectOpen &&
      document.querySelector('[data-tour="project-template-gallery"]')
    ) {
      useTourStore.getState()[autoSkipAction(navigationDirection.current)]();
    }
  }, [activeStep, activeTourId, newProjectOpen]);

  useEffect(() => {
    if (!activeStep || !activeTourId) return;
    let target: Element | null = null;
    const onClick = (event: Event) => {
      if (activeStep.kind !== "required-click") return;
      const interactionTarget =
        "interactionTarget" in activeStep
          ? activeStep.interactionTarget
          : activeStep.target;
      const clicked =
        event.target instanceof Element ? event.target.closest(interactionTarget) : null;
      if (!clicked) return;
      navigationDirection.current = "next";
      if (activeStep.id === "home-create") return;
      if (activeTourId === "home" && activeStep.id === "home-create-project") return;
      requestAnimationFrame(() => useTourStore.getState().advance());
    };
    const onInput = () => setInputRevision((value) => value + 1);
    const attachTarget = () => {
      const nextTarget = document.querySelector(activeStep.target);
      if (nextTarget === target) return;
      target?.removeEventListener("input", onInput);
      target = nextTarget;
      target?.addEventListener("input", onInput);
      if (target) setInputRevision((value) => value + 1);
    };
    document.addEventListener("click", onClick, true);
    attachTarget();
    const observer = new MutationObserver(attachTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      target?.removeEventListener("input", onInput);
    };
  }, [activeStep, activeTourId]);

  const onEvent = (data: EventData) => {
    if (data.type === EVENTS.TARGET_NOT_FOUND && activeStep) {
      const target = document.querySelector<HTMLElement>(activeStep.target);
      if (isTourTargetReady(activeStep.target, target)) {
        setJoyrideInstance((value) => value + 1);
      }
    }
    if (data.type === EVENTS.STEP_AFTER) {
      if (data.action === ACTIONS.PREV) {
        navigationDirection.current = "prev";
        if (activeTourId === "home" && activeStep?.id === "home-name") {
          document.querySelector<HTMLElement>('[data-tour="project-dialog-back"]')?.click();
        }
        if (shouldCloseProjectDialogOnBack(activeTourId, activeStep?.id)) {
          useSettingsStore.getState().setNewProjectOpen(false);
        }
        useTourStore.getState().back();
      }
      if (
        activeTourId &&
        shouldCompleteTourAfterStep(
          data.action,
          activeStepIndex,
          definition?.steps.length ?? 1,
        )
      ) {
        useTourStore.getState().complete(activeTourId);
        return;
      }
      if (data.action === ACTIONS.NEXT) {
        navigationDirection.current = "next";
        useTourStore.getState().advance();
      }
    }
    if (data.type !== EVENTS.TOUR_END) return;
    if (!activeTourId) return;
    const terminalAction = terminalTourAction(data.action, data.status);
    if (terminalAction === "complete") useTourStore.getState().complete(activeTourId);
    if (terminalAction === "dismiss") useTourStore.getState().dismiss(activeTourId);
    if (terminalAction === "interrupt") useTourStore.getState().stop();
  };

  if (showWelcome) {
    return (
      <Welcome
        onStart={() => {
          setWelcomeAccepted(true);
          useTourStore.getState().start("home");
        }}
      />
    );
  }

  if (!activeTourId || !activeStep) return null;

  return (
    <>
      <TourBackdropBlur
        target={
          "spotlightTarget" in activeStep
            ? activeStep.spotlightTarget
            : activeStep.target
        }
      />
      <Joyride
        key={`${activeTourId}-${joyrideInstance}`}
        run
        stepIndex={activeStepIndex}
        steps={steps}
        continuous
        scrollToFirstStep={!reducedMotion}
        styles={{
          floater: { transition: reducedMotion ? "none" : undefined },
          overlay: {
            transition: reducedMotion ? "none" : "opacity 180ms ease",
          },
          spotlight: { style: { transition: reducedMotion ? "none" : undefined } },
          tooltip: { transition: reducedMotion ? "none" : "opacity 180ms ease" },
        }}
        tooltipComponent={TourTooltip}
        arrowComponent={SeamlessArrow}
        onEvent={onEvent}
        options={{
          arrowColor: "var(--popover)",
          backgroundColor: "var(--popover)",
          blockTargetInteraction: true,
          buttons: ["back", "primary", "skip"],
          dismissKeyAction: false,
          overlayClickAction: false,
          overlayColor: "rgba(0, 0, 0, 0.72)",
          primaryColor: "var(--primary)",
          showProgress: true,
          skipBeacon: true,
          spotlightPadding: 6,
          spotlightRadius: 8,
          scrollDuration: reducedMotion ? 0 : 300,
          targetWaitTimeout: 10_000,
          textColor: "var(--popover-foreground)",
          width: 336,
          zIndex: 110,
        }}
      />
    </>
  );
}
