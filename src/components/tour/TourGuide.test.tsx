// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const themeMocks = vi.hoisted(() => ({
  preference: "system" as "system" | "light" | "dark",
  setPreference: vi.fn(),
}));

const joyrideMocks = vi.hoisted(() => ({
  render: false,
  steps: [] as Array<{ id?: string; placement?: string }>,
}));

vi.mock("react-joyride", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-joyride")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Joyride: (props: Record<string, unknown>) => {
      joyrideMocks.steps = props.steps as Array<{ id?: string; placement?: string }>;
      return joyrideMocks.render ? createElement(actual.Joyride, props) : null;
    },
  };
});

vi.mock("@/lib/confetti", () => ({ celebrate: vi.fn() }));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: themeMocks.preference,
    theme: "dark",
    setPreference: themeMocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

import { measureTourPlacement, TourGuide } from "./TourGuide";
import { tourRegistry, type TourStepDefinition } from "@/lib/tours/registry";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";

const HOME_TARGET = '[data-tour="home"]';

function tourStep() {
  const { activeTourId, activeStepIndex } = useTourStore.getState();
  return { activeTourId, activeStepIndex };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  useSettingsStore.setState({ newProjectOpen: false, settingsOpen: false });
  useFilesStore.setState({ projectId: null, loading: false });
  useTourStore.setState({ enabled: true, activeTourId: "home", activeStepIndex: 0 });
  themeMocks.preference = "system";
  themeMocks.setPreference.mockClear();
  joyrideMocks.render = false;
  joyrideMocks.steps = [];
});

describe("Welcome appearance choice", () => {
  it("offers system, light, and dark with the active preference pressed", () => {
    const home = document.createElement("div");
    home.setAttribute("data-tour", "home");
    home.setAttribute("data-projects-loaded", "true");
    document.body.appendChild(home);
    useTourStore.setState((state) => ({
      activeTourId: null,
      tours: { ...state.tours, home: { ...state.tours.home, status: "pending" } },
    }));

    render(<TourGuide />);

    const dialog = screen.getByTestId("tour-welcome");
    const choices = within(dialog).getAllByRole("button", {
      name: /^Use (system|light|dark) theme$/,
    });
    expect(choices.map((choice) => choice.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(within(dialog).getByRole("button", { name: "Use system theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Use light theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(dialog).getByRole("button", { name: "Use dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Use dark theme" }));
    expect(themeMocks.setPreference).toHaveBeenCalledWith("dark");
  });
});

afterEach(() => {
  act(() => useTourStore.getState().stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll(HOME_TARGET)) node.remove();
});

describe("TourGuide missing-target grace period", () => {
  it("skips the step once the grace period passes with the target absent", () => {
    render(<TourGuide />);
    expect(document.querySelector(HOME_TARGET)).toBeNull();
    expect(tourStep()).toEqual({ activeTourId: "home", activeStepIndex: 0 });

    act(() => {
      vi.advanceTimersByTime(749);
    });
    expect(tourStep().activeStepIndex).toBe(0);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(tourStep()).toEqual({ activeTourId: "home", activeStepIndex: 1 });
  });

  it("does not start the grace period while the project files are still loading", () => {
    useFilesStore.setState({ loading: true });
    render(<TourGuide />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(tourStep().activeStepIndex).toBe(0);

    act(() => {
      useFilesStore.setState({ loading: false });
    });
    act(() => {
      vi.advanceTimersByTime(749);
    });
    expect(tourStep().activeStepIndex).toBe(0);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(tourStep().activeStepIndex).toBe(1);
  });

  it("ignores loading updates that still report the files as loading", () => {
    useFilesStore.setState({ loading: true });
    render(<TourGuide />);

    act(() => {
      useFilesStore.setState({ projectId: "project-1" });
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(tourStep().activeStepIndex).toBe(0);
  });

  it("stops waiting as soon as the target appears", async () => {
    render(<TourGuide />);

    await act(async () => {
      const home = document.createElement("div");
      home.setAttribute("data-tour", "home");
      document.body.appendChild(home);
    });

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(tourStep()).toEqual({ activeTourId: "home", activeStepIndex: 0 });
  });

  it("never arms the grace period when the target is present from the start", () => {
    const home = document.createElement("div");
    home.setAttribute("data-tour", "home");
    document.body.appendChild(home);

    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(tourStep()).toEqual({ activeTourId: "home", activeStepIndex: 0 });
  });

  it("cancels the pending grace period when the tour stops", () => {
    render(<TourGuide />);

    act(() => useTourStore.getState().stop());
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(tourStep()).toEqual({ activeTourId: null, activeStepIndex: 0 });
  });

  it("unsubscribes from the loading store when the tour stops mid-wait", () => {
    useFilesStore.setState({ loading: true });
    render(<TourGuide />);

    act(() => useTourStore.getState().stop());
    act(() => {
      useFilesStore.setState({ loading: false });
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(tourStep()).toEqual({ activeTourId: null, activeStepIndex: 0 });
  });
});

type Box = { top: number; left: number; width: number; height: number };

const TEMPLATE_LIST_BOX: Box = { top: 160, left: 200, width: 640, height: 360 };
const VIEWPORT_CORNER: Box = { top: 0, left: 0, width: 8, height: 8 };

function mountTourTarget(name: string, box: Box) {
  const element = document.createElement("div");
  element.setAttribute("data-tour", name);
  element.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => "",
    }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

function styleBox(element: HTMLElement): Box {
  return {
    top: Number.parseFloat(element.style.top),
    left: Number.parseFloat(element.style.left),
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  };
}

function intersects(a: Box, b: Box) {
  return (
    a.width > 0 &&
    a.height > 0 &&
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

function tourLayersCovering(area: Box) {
  const covering: string[] = [];
  for (const path of document.querySelectorAll<SVGPathElement>(
    ".react-joyride__spotlight path",
  )) {
    if (path.style.pointerEvents !== "auto") continue;
    const subpaths = (path.getAttribute("d") ?? "").split("Z").filter((part) => part.trim());
    if (subpaths.length < 2) covering.push("joyride-overlay");
  }
  for (const strip of document.querySelectorAll<HTMLElement>("[data-tour-backdrop]")) {
    if (intersects(styleBox(strip), area)) covering.push(`backdrop-${strip.dataset.tourBackdrop}`);
  }
  return covering;
}

function homeStepIndex(stepId: string) {
  return tourRegistry.home.steps.findIndex((step) => step.id === stepId);
}

function joyridePlacement(stepId: string) {
  return joyrideMocks.steps.find((step) => step.id === stepId)?.placement;
}

function renderHomeStep(stepId: string) {
  joyrideMocks.render = true;
  useSettingsStore.setState({ newProjectOpen: true });
  useTourStore.setState({
    activeTourId: "home",
    activeStepIndex: homeStepIndex(stepId),
  });
  render(<TourGuide />);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe("TourGuide overlay reachability", () => {
  afterEach(() => {
    for (const node of document.querySelectorAll("[data-tour]")) node.remove();
  });

  it("leaves the template grid uncovered on the step that asks for a click", () => {
    mountTourTarget("project-template-list", TEMPLATE_LIST_BOX);

    renderHomeStep("home-template");

    expect(tourLayersCovering(TEMPLATE_LIST_BOX)).toEqual([]);
    expect(
      document.querySelectorAll(".react-joyride__spotlight path").length,
    ).toBeGreaterThan(1);
    const strips = Array.from(document.querySelectorAll<HTMLElement>("[data-tour-backdrop]"));
    expect(strips.map((strip) => strip.dataset.tourBackdrop)).toEqual([
      "top",
      "bottom",
      "left",
      "right",
    ]);
    for (const strip of strips) {
      expect(strip.style.pointerEvents).toBe("none");
    }
    expect(tourLayersCovering(VIEWPORT_CORNER)).toEqual(["backdrop-top"]);
  });

  it("anchors the tooltip in the widest dimmed band around the grid", () => {
    const element = mountTourTarget("project-template-list", TEMPLATE_LIST_BOX);
    const step = tourRegistry.home.steps.find((entry) => entry.id === "home-template");

    expect(
      measureTourPlacement(step as TourStepDefinition, element, {
        width: 384,
        height: 163,
        minHeight: 125,
      }),
    ).toEqual({ placement: "bottom", maxHeight: null });
  });

  it("never leaves a step on auto once its late target has mounted", async () => {
    joyrideMocks.render = true;
    useSettingsStore.setState({ newProjectOpen: true });
    mountTourTarget("new-project", { top: 40, left: 40, width: 120, height: 32 });
    useTourStore.setState({ activeTourId: "home", activeStepIndex: homeStepIndex("home-create") });

    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector("[data-tour-tooltip]")).not.toBeNull();

    act(() => {
      useTourStore.setState({ activeStepIndex: homeStepIndex("home-template") });
    });
    expect(joyridePlacement("home-template")).toBe("auto");

    await act(async () => {
      mountTourTarget("project-template-list", TEMPLATE_LIST_BOX);
    });
    expect(joyridePlacement("home-template")).toBe("bottom");
  });

  it("keeps dimming the whole grid on the step that only describes it", () => {
    mountTourTarget("project-template-list", TEMPLATE_LIST_BOX);

    renderHomeStep("home-gallery");

    expect(tourLayersCovering(TEMPLATE_LIST_BOX)).toEqual(["joyride-overlay"]);
    for (const strip of document.querySelectorAll<HTMLElement>("[data-tour-backdrop]")) {
      expect(strip.style.pointerEvents).toBe("none");
    }
  });
});
