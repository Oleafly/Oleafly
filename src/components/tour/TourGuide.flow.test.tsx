// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { ACTIONS, EVENTS, STATUS, type Props as JoyrideProps } from "react-joyride";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joyrideMocks = vi.hoisted(() => ({
  render: false,
  mounts: 0,
  props: null as Record<string, unknown> | null,
}));

const reducedMotion = vi.hoisted(() => ({ matches: false }));

vi.mock("react-joyride", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-joyride")>();
  const { createElement: h, useEffect } = await import("react");
  return {
    ...actual,
    Joyride: (props: JoyrideProps) => {
      joyrideMocks.props = props;
      useEffect(() => {
        joyrideMocks.mounts += 1;
      }, []);
      return joyrideMocks.render ? h(actual.Joyride, props) : null;
    },
  };
});

vi.mock("@/lib/confetti", () => ({ celebrate: vi.fn() }));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "system",
    theme: "dark",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

import { TourGuide } from "./TourGuide";
import { celebrate } from "@/lib/confetti";
import { START_TOUR_EVENT } from "@/lib/tour";
import { tourRegistry, type TourId } from "@/lib/tours/registry";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";

function stepIndex(tourId: TourId, stepId: string) {
  return tourRegistry[tourId].steps.findIndex((step) => step.id === stepId);
}

function activate(tourId: TourId, stepId: string) {
  useTourStore.setState({ activeTourId: tourId, activeStepIndex: stepIndex(tourId, stepId) });
}

function current() {
  const { activeTourId, activeStepIndex } = useTourStore.getState();
  return { activeTourId, activeStepIndex };
}

function mount(tag: string, attributes: Record<string, string>, parent: HTMLElement = document.body) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  parent.appendChild(element);
  return element;
}

function frame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

function completeTours(...ids: TourId[]) {
  useTourStore.setState((state) => ({
    tours: Object.fromEntries(
      Object.entries(state.tours).map(([id, entry]) => [
        id,
        ids.includes(id as TourId) ? { ...entry, status: "completed" } : entry,
      ]),
    ) as typeof state.tours,
  }));
}

function emit(event: Record<string, unknown>) {
  const onEvent = joyrideMocks.props?.onEvent as (data: unknown) => void;
  act(() => onEvent(event));
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion.matches = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reducedMotion.matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  useTourStore.getState().resetAll();
  useSettingsStore.setState({
    newProjectOpen: false,
    settingsOpen: false,
    assistantOpen: false,
    chatFloating: false,
    viewMode: "editor",
    showTree: true,
    settingsScrollTarget: null,
    accentColor: "#2563eb",
  });
  useHomeViewStore.setState({ page: "library" });
  useFilesStore.setState({ projectId: null, loading: false });
  joyrideMocks.render = false;
  joyrideMocks.mounts = 0;
  joyrideMocks.props = null;
  vi.mocked(celebrate).mockClear();
});

afterEach(() => {
  act(() => useTourStore.getState().stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Welcome dialog", () => {
  function showWelcome() {
    mount("div", { "data-tour": "home", "data-projects-loaded": "true" });
    useTourStore.setState({ activeTourId: null });
    render(<TourGuide />);
    frame();
    return screen.getByTestId("tour-welcome");
  }

  it("starts the home tour from the primary button", () => {
    const dialog = showWelcome();

    fireEvent.click(within(dialog).getByRole("button", { name: /Show me around/ }));

    expect(current().activeTourId).toBe("home");
    expect(screen.queryByTestId("tour-welcome")).toBeNull();
  });

  it("starts the home tour with the modifier-Enter chord and swallows Escape", () => {
    showWelcome();

    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(false);
    expect(screen.getByTestId("tour-welcome")).toBeInTheDocument();

    expect(fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(current().activeTourId).toBe("home");
  });

  it("applies the chosen accent color", () => {
    const dialog = showWelcome();

    const green = within(dialog).getByRole("button", { name: "Use the Green accent color" });
    expect(green).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(green);

    expect(useSettingsStore.getState().accentColor).toBe("#0b8842");
    expect(green).toHaveAttribute("aria-pressed", "true");
  });

  it("focuses the first control on open and keeps Tab focus inside the dialog", () => {
    const outside = mount("button", { type: "button" });
    const dialog = showWelcome();
    const buttons = within(dialog).getAllByRole("button");
    const first = buttons[0];
    const last = buttons.at(-1) as HTMLElement;

    expect(document.activeElement).toBe(first);

    last.focus();
    expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);

    expect(fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);

    buttons[1].focus();
    expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "a" })).toBe(true);

    outside.focus();
    expect(document.activeElement).toBe(first);
  });

  it("sends Tab from outside the dialog to its first or last control", () => {
    const dialog = showWelcome();
    const buttons = within(dialog).getAllByRole("button");
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const focusSpy = vi.spyOn(buttons.at(-1) as HTMLElement, "focus");
    const removeFocus = () => {
      (document.activeElement as HTMLElement | null)?.blur();
    };
    removeFocus();

    expect(fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true })).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
    removeFocus();
    expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe("auto-start", () => {
  it("starts the workspace tour once a project is open and its first target exists", () => {
    mount("div", { "data-tour": "project-toolbar" });
    useTourStore.setState({ activeTourId: null });
    useFilesStore.setState({ projectId: "p1" });

    render(<TourGuide />);

    expect(current()).toEqual({ activeTourId: "workspace", activeStepIndex: 0 });
  });

  it("waits for a missing first target and starts when it mounts", async () => {
    useTourStore.setState({ activeTourId: null });
    useFilesStore.setState({ projectId: "p1" });
    render(<TourGuide />);
    frame();
    expect(current().activeTourId).toBeNull();

    await act(async () => {
      mount("div", { "data-tour": "project-toolbar" });
    });
    frame();

    expect(current().activeTourId).toBe("workspace");
  });

  it("gives up waiting after the deadline", async () => {
    useTourStore.setState({ activeTourId: null });
    useFilesStore.setState({ projectId: "p1" });
    render(<TourGuide />);

    act(() => {
      vi.advanceTimersByTime(10_100);
    });
    await act(async () => {
      mount("div", { "data-tour": "project-toolbar" });
    });
    frame();

    expect(current().activeTourId).toBeNull();
  });

  it("does not start the workspace tour while the assistant or a project dialog is open", () => {
    mount("div", { "data-tour": "project-toolbar" });
    useTourStore.setState({ activeTourId: null });
    useFilesStore.setState({ projectId: "p1" });
    useSettingsStore.setState({ assistantOpen: true });

    const { unmount } = render(<TourGuide />);
    frame();
    expect(current().activeTourId).toBeNull();
    unmount();

    useSettingsStore.setState({ assistantOpen: false, newProjectOpen: true });
    render(<TourGuide />);
    frame();
    expect(current().activeTourId).toBeNull();
  });

  it("does not auto-start behind an open diagram or settings page", () => {
    mount("div", { "data-tour": "project-toolbar" });
    useTourStore.setState({ activeTourId: null });
    useFilesStore.setState({ projectId: "p1" });
    useHomeViewStore.setState({ page: "diagram-composer" });

    const { unmount } = render(<TourGuide />);
    frame();
    expect(current().activeTourId).toBeNull();
    unmount();

    useHomeViewStore.setState({ page: "library" });
    useSettingsStore.setState({ settingsOpen: true });
    render(<TourGuide />);
    frame();
    expect(current().activeTourId).toBeNull();
  });

  it("waits for the home library before offering the welcome", async () => {
    const home = mount("div", { "data-tour": "home" });
    useTourStore.setState({ activeTourId: null });

    render(<TourGuide />);
    expect(screen.queryByTestId("tour-welcome")).toBeNull();

    await act(async () => {
      home.setAttribute("data-projects-loaded", "false");
    });
    expect(screen.queryByTestId("tour-welcome")).toBeNull();

    await act(async () => {
      home.setAttribute("data-projects-loaded", "true");
    });
    expect(screen.getByTestId("tour-welcome")).toBeInTheDocument();
  });

  it("celebrates when a tour is completed", () => {
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);
    expect(celebrate).not.toHaveBeenCalled();

    act(() => useTourStore.getState().complete("workspace"));

    expect(celebrate).toHaveBeenCalledTimes(1);
  });
});

describe("manual start", () => {
  function requestTour(detail?: string) {
    act(() => {
      window.dispatchEvent(
        detail === undefined
          ? new Event(START_TOUR_EVENT)
          : new CustomEvent(START_TOUR_EVENT, { detail }),
      );
    });
    frame();
  }

  it("restarts the tour that matches the current context", () => {
    completeTours("home", "workspace");
    useTourStore.setState({ activeTourId: null });
    render(<TourGuide />);
    requestTour();
    expect(current().activeTourId).toBe("home");

    act(() => useTourStore.getState().stop());
    act(() => useFilesStore.setState({ projectId: "p1" }));
    requestTour();
    expect(current().activeTourId).toBe("workspace");
  });

  it("ignores a contextual request where the matching tour is unavailable", () => {
    completeTours("home", "workspace");
    useTourStore.setState({ activeTourId: null });
    useFilesStore.setState({ projectId: "p1" });
    useSettingsStore.setState({ assistantOpen: true });
    const { unmount } = render(<TourGuide />);
    requestTour();
    expect(current().activeTourId).toBeNull();
    unmount();

    useSettingsStore.setState({ assistantOpen: false, settingsOpen: true });
    const second = render(<TourGuide />);
    requestTour();
    expect(current().activeTourId).toBeNull();
    second.unmount();

    useSettingsStore.setState({ settingsOpen: true });
    useHomeViewStore.setState({ page: "diagram-composer" });
    render(<TourGuide />);
    requestTour();
    expect(current().activeTourId).toBeNull();
  });

  it("starts the named tour even with a diagram open behind settings", () => {
    completeTours("home", "workspace");
    useTourStore.setState({ activeTourId: null });
    useSettingsStore.setState({ settingsOpen: true });
    useHomeViewStore.setState({ page: "diagram-composer" });
    render(<TourGuide />);

    requestTour("workspace");

    expect(current().activeTourId).toBe("workspace");
  });

  it("lets the latest of two quick requests win", () => {
    completeTours("home", "workspace");
    useTourStore.setState({ activeTourId: null });
    render(<TourGuide />);

    act(() => {
      window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: "home" }));
      window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: "workspace" }));
    });
    frame();

    expect(current().activeTourId).toBe("workspace");
  });

  it("drops a pending request when the guide unmounts", () => {
    completeTours("home", "workspace");
    useTourStore.setState({ activeTourId: null });
    const { unmount } = render(<TourGuide />);

    act(() => {
      window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: "workspace" }));
    });
    unmount();
    frame();

    expect(current().activeTourId).toBeNull();
  });
});

describe("keyboard during a tour", () => {
  function startWorkspaceAt(stepId: string) {
    useFilesStore.setState({ projectId: "p1" });
    for (const step of tourRegistry.workspace.steps) {
      mount("div", { "data-tour": step.target.slice(12, -2) });
    }
    activate("workspace", stepId);
    render(<TourGuide />);
  }

  it("asks before quitting on Escape and dismisses the tour on confirm", () => {
    startWorkspaceAt("workspace-editor");

    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(false);
    const dialog = screen.getByRole("alertdialog", { name: "Quit the tour?" });
    expect(fireEvent.keyDown(document.body, { key: "a" })).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Quit tour/ }));

    expect(current().activeTourId).toBeNull();
    expect(useTourStore.getState().tours.workspace.status).toBe("dismissed");
  });

  it("keeps the tour running when the quit is cancelled", () => {
    startWorkspaceAt("workspace-editor");

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Quit the tour?" })).getByRole("button", {
        name: /^Cancel/,
      }),
    );

    expect(screen.queryByRole("alertdialog", { name: "Quit the tour?" })).toBeNull();
    expect(current()).toEqual({
      activeTourId: "workspace",
      activeStepIndex: stepIndex("workspace", "workspace-editor"),
    });
  });

  it("moves forward and back with the modifier chords", () => {
    startWorkspaceAt("workspace-editor");
    const start = stepIndex("workspace", "workspace-editor");

    expect(fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(current().activeStepIndex).toBe(start + 1);

    expect(fireEvent.keyDown(document.body, { key: "ArrowLeft", ctrlKey: true })).toBe(false);
    expect(current().activeStepIndex).toBe(start);
  });

  it("completes the tour with the forward chord on the last step", () => {
    startWorkspaceAt("workspace-source-navigation");

    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });

    expect(current().activeTourId).toBeNull();
    expect(useTourStore.getState().tours.workspace.status).toBe("completed");
  });

  it("does not go back from the first step but still swallows the chord", () => {
    startWorkspaceAt("workspace-toolbar");

    expect(fireEvent.keyDown(document.body, { key: "ArrowLeft", ctrlKey: true })).toBe(false);

    expect(current().activeStepIndex).toBe(0);
  });

  it("swallows ordinary keys on an informational step but lets Tab through", () => {
    startWorkspaceAt("workspace-toolbar");
    const target = document.querySelector('[data-tour="project-toolbar"]') as HTMLElement;

    expect(fireEvent.keyDown(target, { key: "a" })).toBe(false);
    expect(fireEvent.keyDown(target, { key: "Tab" })).toBe(true);
  });

  it("lets typing reach a required input but blocks the forward chord there", () => {
    const input = mount("input", { "data-tour": "project-name" });
    activate("home", "home-name");
    render(<TourGuide />);

    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(current().activeStepIndex).toBe(stepIndex("home", "home-name"));
  });

  it("lets Enter activate a required-click target and the tooltip portal", () => {
    const button = mount("button", { "data-tour": "new-project" });
    const portal = mount("div", { id: "react-joyride-portal" });
    const inPortal = mount("button", {}, portal);
    activate("home", "home-create");
    render(<TourGuide />);

    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(inPortal, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "Enter" })).toBe(false);
  });

  it("lets keys through inside a step's interaction area", () => {
    const area = mount("div", { "data-tour": "project-cover-color" });
    const swatch = mount("button", {}, area);
    activate("home", "home-color");
    render(<TourGuide />);

    expect(fireEvent.keyDown(swatch, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "ArrowRight" })).toBe(false);
  });
});

describe("wheel redirection into an interaction area", () => {
  function scrollableArea(scrollable = true) {
    const area = mount("div", { "data-tour": "project-template-list" });
    Object.defineProperty(area, "scrollHeight", { value: scrollable ? 900 : 100 });
    Object.defineProperty(area, "clientHeight", { value: 100 });
    area.getBoundingClientRect = () =>
      ({ top: 100, left: 100, right: 400, bottom: 400, width: 300, height: 300 }) as DOMRect;
    area.scrollBy = vi.fn() as unknown as typeof area.scrollBy;
    const card = mount("div", {}, area);
    activate("home", "home-template");
    render(<TourGuide />);
    return { area, card };
  }

  function wheel(target: EventTarget, init: WheelEventInit) {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it("scrolls the area for wheel events that start inside it", () => {
    const { area, card } = scrollableArea();

    const event = wheel(card, { deltaY: 40, clientX: 0, clientY: 0 });

    expect(area.scrollBy).toHaveBeenCalledWith({ left: 0, top: 40 });
    expect(event.defaultPrevented).toBe(true);
  });

  it("scrolls the area when the pointer is over it even if the event started elsewhere", () => {
    const { area } = scrollableArea();

    wheel(document.body, { deltaX: 12, clientX: 200, clientY: 200 });

    expect(area.scrollBy).toHaveBeenCalledWith({ left: 12, top: 0 });
  });

  it("leaves wheel events outside the area, empty deltas and unscrollable areas alone", () => {
    const { area, card } = scrollableArea();

    expect(wheel(document.body, { deltaY: 40, clientX: 10, clientY: 10 }).defaultPrevented).toBe(
      false,
    );
    expect(wheel(card, { deltaX: 0, deltaY: 0 }).defaultPrevented).toBe(false);
    expect(area.scrollBy).not.toHaveBeenCalled();
  });

  it("ignores wheel events when the area does not overflow", () => {
    const { area, card } = scrollableArea(false);

    expect(wheel(card, { deltaY: 40 }).defaultPrevented).toBe(false);
    expect(area.scrollBy).not.toHaveBeenCalled();
  });
});

describe("tour side effects on the app", () => {
  it("switches the workspace to split view for the tour and restores it after", () => {
    mount("div", { "data-tour": "project-toolbar" });
    useSettingsStore.setState({ viewMode: "pdf" });
    activate("workspace", "workspace-toolbar");

    render(<TourGuide />);
    expect(useSettingsStore.getState().viewMode).toBe("split");

    act(() => useTourStore.getState().stop());
    expect(useSettingsStore.getState().viewMode).toBe("pdf");
  });

  it("restores the view mode when the guide unmounts mid-tour", () => {
    mount("div", { "data-tour": "project-toolbar" });
    useSettingsStore.setState({ viewMode: "editor" });
    activate("workspace", "workspace-toolbar");

    const { unmount } = render(<TourGuide />);
    expect(useSettingsStore.getState().viewMode).toBe("split");
    unmount();

    expect(useSettingsStore.getState().viewMode).toBe("editor");
  });

  it("opens the sidebar before pointing at it", () => {
    mount("div", { "data-tour": "project-sidebar" });
    useSettingsStore.setState({ showTree: false });
    activate("workspace", "workspace-sidebar");

    render(<TourGuide />);

    expect(useSettingsStore.getState().showTree).toBe(true);
  });

  it("marks the body while a tour runs and clears its portal afterwards", () => {
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);
    expect(document.body.dataset.tourActive).toBe("1");
    mount("div", { id: "react-joyride-portal" });

    act(() => useTourStore.getState().stop());

    expect(document.body.dataset.tourActive).toBeUndefined();
    expect(document.getElementById("react-joyride-portal")).toBeNull();
  });

  it("returns focus to the element that had it before the tour", async () => {
    mount("div", { "data-tour": "project-toolbar" });
    const opener = mount("button", { type: "button" });
    opener.focus();
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);
    await act(async () => {
      mount("div", { id: "react-joyride-portal" });
    });
    mount("button", { type: "button" }).focus();

    act(() => useTourStore.getState().stop());

    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the original element when no tooltip portal ever mounted", () => {
    mount("div", { "data-tour": "project-toolbar" });
    const opener = mount("button", { type: "button" });
    opener.focus();
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);
    mount("button", { type: "button" }).focus();

    act(() => useTourStore.getState().stop());

    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the template gallery when the tour ends inside project creation", async () => {
    mount("button", { "data-tour": "new-project" });
    const gallery = mount("div", { "data-tour": "project-template-gallery", tabindex: "-1" });
    useSettingsStore.setState({ newProjectOpen: true });
    activate("home", "home-create");
    render(<TourGuide />);
    await act(async () => {
      mount("div", { id: "react-joyride-portal" });
    });

    act(() => useTourStore.getState().stop());

    expect(document.activeElement).toBe(gallery);
  });
});

describe("settings tour navigation", () => {
  function settingsChrome(selected = "appearance") {
    const advanced = mount("button", {
      "data-testid": "settings-toggle-advanced",
      "aria-checked": "false",
    });
    advanced.addEventListener("click", () => {
      advanced.setAttribute(
        "aria-checked",
        advanced.getAttribute("aria-checked") === "true" ? "false" : "true",
      );
    });
    const sections = new Map<string, HTMLElement>();
    for (const id of ["general", "appearance", "dictionary", "ai", "engine", "help"]) {
      const button = mount("button", { "data-testid": `settings-section-${id}` });
      if (id === selected) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => {
        for (const other of sections.values()) other.removeAttribute("aria-current");
        button.setAttribute("aria-current", "page");
      });
      sections.set(id, button);
    }
    for (const step of tourRegistry.settings.steps) {
      mount("div", { "data-tour": step.target.slice(12, -2) });
    }
    return { advanced, sections };
  }

  it("opens the advanced settings and the right section for each step", () => {
    const { advanced, sections } = settingsChrome();
    activate("settings", "settings-dictionary");

    render(<TourGuide />);
    expect(advanced).toHaveAttribute("aria-checked", "true");
    frame();
    expect(sections.get("dictionary")).toHaveAttribute("aria-current", "page");

    act(() => activate("settings", "settings-compiler"));
    frame();
    expect(sections.get("engine")).toHaveAttribute("aria-current", "page");
    expect(advanced).toHaveAttribute("aria-checked", "true");
  });

  it("scrolls to the MCP block on its step", () => {
    const { sections } = settingsChrome();
    activate("settings", "settings-mcp");

    render(<TourGuide />);
    frame();

    expect(useSettingsStore.getState().settingsScrollTarget).toBe("ai-mcp");
    expect(sections.get("ai")).toHaveAttribute("aria-current", "page");
  });

  it("puts back the section and advanced toggle the user had before the tour", () => {
    const { advanced, sections } = settingsChrome("appearance");
    activate("settings", "settings-navigation");
    render(<TourGuide />);
    act(() => activate("settings", "settings-dictionary"));
    frame();
    expect(sections.get("dictionary")).toHaveAttribute("aria-current", "page");
    expect(advanced).toHaveAttribute("aria-checked", "true");

    act(() => useTourStore.getState().stop());
    expect(advanced).toHaveAttribute("aria-checked", "false");
    frame();

    expect(sections.get("appearance")).toHaveAttribute("aria-current", "page");
  });

  it("falls back to the general section when none was selected", () => {
    const { sections } = settingsChrome("none");
    activate("settings", "settings-navigation");
    render(<TourGuide />);
    act(() => activate("settings", "settings-help"));
    frame();
    expect(sections.get("help")).toHaveAttribute("aria-current", "page");

    act(() => useTourStore.getState().stop());
    frame();

    expect(sections.get("general")).toHaveAttribute("aria-current", "page");
  });

  it("does nothing on the overview step that has no destination", () => {
    const { advanced, sections } = settingsChrome("appearance");
    activate("settings", "settings-navigation");

    render(<TourGuide />);
    frame();

    expect(advanced).toHaveAttribute("aria-checked", "false");
    expect(sections.get("appearance")).toHaveAttribute("aria-current", "page");
  });
});

describe("assistant tour", () => {
  function assistantRoot(attributes: Record<string, string>) {
    for (const step of tourRegistry.ai.steps) mount("div", { "data-tour": step.target.slice(12, -2) });
    const root = document.querySelector<HTMLElement>('[data-tour="ai-assistant"]') ??
      mount("div", { "data-tour": "ai-assistant" });
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
    return root;
  }

  it("skips steps that need a configured provider when none is set up", () => {
    assistantRoot({ "data-tour-ready": "true", "data-tour-configured": "false" });
    activate("ai", "ai-provider-model");
    const start = current().activeStepIndex;

    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(current().activeStepIndex).toBe(start + 1);
  });

  it("keeps a step that applies to the current setup", () => {
    assistantRoot({ "data-tour-ready": "true", "data-tour-configured": "true" });
    activate("ai", "ai-provider-model");
    const start = current().activeStepIndex;

    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(current().activeStepIndex).toBe(start);
  });

  it("finishes the tour when the final step does not apply", () => {
    assistantRoot({ "data-tour-ready": "true", "data-tour-configured": "true" });
    activate("ai", "ai-restore");

    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(current().activeTourId).toBeNull();
    expect(useTourStore.getState().tours.ai.status).toBe("completed");
  });

  it("keeps skipping backwards after the user stepped back", () => {
    assistantRoot({ "data-tour-ready": "true", "data-tour-configured": "true" });
    activate("ai", "ai-prompts");
    render(<TourGuide />);
    const prompts = current().activeStepIndex;

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.PREV, status: STATUS.RUNNING });
    expect(current().activeStepIndex).toBe(prompts - 1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(current().activeStepIndex).toBe(prompts - 1);

    act(() => activate("ai", "ai-connect-provider"));
    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(current().activeStepIndex).toBe(stepIndex("ai", "ai-connect-provider") - 1);
  });

  it("waits until the assistant reports ready before skipping", async () => {
    const root = assistantRoot({ "data-tour-ready": "false", "data-tour-configured": "false" });
    activate("ai", "ai-input");
    const start = current().activeStepIndex;
    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(current().activeStepIndex).toBe(start);

    await act(async () => {
      root.setAttribute("data-tour-ready", "true");
    });
    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(current().activeStepIndex).toBe(start + 1);
  });
});

describe("diagram tour", () => {
  function diagramTargets() {
    for (const step of tourRegistry.diagram.steps) {
      mount("div", { "data-tour": step.target.slice(12, -2) });
    }
  }

  it("flags the mode switcher only while its step is active", () => {
    diagramTargets();
    const modes = document.querySelector<HTMLElement>('[data-tour="diagram-modes"]') as HTMLElement;
    activate("diagram", "diagram-modes");

    const { unmount } = render(<TourGuide />);
    expect(modes.dataset.tourActive).toBe("true");

    act(() => activate("diagram", "diagram-palette"));
    expect(modes.dataset.tourActive).toBeUndefined();

    act(() => activate("diagram", "diagram-modes"));
    expect(modes.dataset.tourActive).toBe("true");
    unmount();
    expect(modes.dataset.tourActive).toBeUndefined();
  });

  it("skips the inspector step when nothing on the canvas is selected", () => {
    diagramTargets();
    mount("div", { "data-tour": "diagram-canvas" });
    activate("diagram", "diagram-inspector");
    const start = current().activeStepIndex;

    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(current().activeStepIndex).toBe(start + 1);
  });

  it("stays on the handles step while a node is selected", () => {
    diagramTargets();
    mount("div", { "data-tour": "diagram-canvas", "data-tour-selection": "true" });
    activate("diagram", "diagram-handles");
    const start = current().activeStepIndex;

    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(current().activeStepIndex).toBe(start);
  });
});

describe("required clicks", () => {
  it("advances after the user clicks the step's target", () => {
    const target = mount("button", { "data-tour": "project-kind-template" });
    useSettingsStore.setState({ newProjectOpen: true });
    activate("home", "home-kind-template");
    const start = current().activeStepIndex;
    render(<TourGuide />);

    fireEvent.click(document.body);
    frame();
    expect(current().activeStepIndex).toBe(start);

    fireEvent.click(target);
    frame();
    expect(current().activeStepIndex).toBe(start + 1);
  });

  it("advances on a click inside a step's interaction target", () => {
    const list = mount("div", { "data-tour": "project-template-list" });
    const card = mount("button", { "data-tour": "project-template-card" }, list);
    activate("home", "home-template");
    const start = current().activeStepIndex;
    render(<TourGuide />);

    fireEvent.click(card);
    frame();

    expect(current().activeStepIndex).toBe(start + 1);
  });

  it("leaves the create steps to the dialog that opens or closes", () => {
    const create = mount("button", { "data-tour": "new-project" });
    activate("home", "home-create");
    const { unmount } = render(<TourGuide />);
    fireEvent.click(create);
    frame();
    expect(current().activeStepIndex).toBe(stepIndex("home", "home-create"));
    unmount();

    const finish = mount("button", { "data-tour": "create-project" });
    activate("home", "home-create-project");
    render(<TourGuide />);
    fireEvent.click(finish);
    frame();
    expect(current().activeStepIndex).toBe(stepIndex("home", "home-create-project"));
  });

  it("ignores clicks on an informational step", () => {
    const toolbar = mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);

    fireEvent.click(toolbar);
    frame();

    expect(current().activeStepIndex).toBe(0);
  });

  it("moves past the create step once the project kind chooser shows up", () => {
    mount("button", { "data-tour": "new-project" });
    useSettingsStore.setState({ newProjectOpen: true });
    activate("home", "home-create");
    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(current().activeStepIndex).toBe(stepIndex("home", "home-create"));

    mount("div", { "data-tour": "project-kind-chooser" });
    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(current().activeStepIndex).toBe(stepIndex("home", "home-kind"));
  });

  it("stops polling for the chooser after a bounded number of attempts", () => {
    mount("button", { "data-tour": "new-project" });
    useSettingsStore.setState({ newProjectOpen: true });
    activate("home", "home-create");
    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    mount("div", { "data-tour": "project-kind-chooser" });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(current().activeStepIndex).toBe(stepIndex("home", "home-create"));
  });
});

describe("Joyride events", () => {
  it("re-mounts Joyride when it reports a target that is actually there", () => {
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);
    const mounts = joyrideMocks.mounts;

    emit({ type: EVENTS.TARGET_NOT_FOUND, action: ACTIONS.UPDATE, status: STATUS.RUNNING });

    expect(joyrideMocks.mounts).toBe(mounts + 1);
  });

  it("does not re-mount Joyride while the assistant target is still loading", () => {
    mount("div", { "data-tour": "ai-assistant-header", "data-tour-ready": "false" });
    activate("ai", "ai-assistant");
    render(<TourGuide />);
    const mounts = joyrideMocks.mounts;

    emit({ type: EVENTS.TARGET_NOT_FOUND, action: ACTIONS.UPDATE, status: STATUS.RUNNING });

    expect(joyrideMocks.mounts).toBe(mounts);
  });

  it("advances on next and completes on the final step", () => {
    for (const step of tourRegistry.workspace.steps) {
      mount("div", { "data-tour": step.target.slice(12, -2) });
    }
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.NEXT, status: STATUS.RUNNING });
    expect(current().activeStepIndex).toBe(1);

    act(() => activate("workspace", "workspace-source-navigation"));
    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.NEXT, status: STATUS.RUNNING });
    expect(useTourStore.getState().tours.workspace.status).toBe("completed");
  });

  it("completes on an explicit complete action", () => {
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.COMPLETE, status: STATUS.RUNNING });

    expect(useTourStore.getState().tours.workspace.status).toBe("completed");
  });

  it("steps back out of the name field through the dialog's own back button", () => {
    mount("input", { "data-tour": "project-name" });
    const back = mount("button", { "data-tour": "project-dialog-back" });
    const onBack = vi.fn();
    back.addEventListener("click", onBack);
    useSettingsStore.setState({ newProjectOpen: true });
    activate("home", "home-name");
    render(<TourGuide />);

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.PREV, status: STATUS.RUNNING });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(current().activeStepIndex).toBe(stepIndex("home", "home-name") - 1);
    expect(useSettingsStore.getState().newProjectOpen).toBe(true);
  });

  it("closes project creation when stepping back from the kind chooser", () => {
    mount("div", { "data-tour": "project-kind-chooser" });
    useSettingsStore.setState({ newProjectOpen: true });
    activate("home", "home-kind");
    render(<TourGuide />);

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.PREV, status: STATUS.RUNNING });

    expect(useSettingsStore.getState().newProjectOpen).toBe(false);
    expect(current().activeStepIndex).toBe(stepIndex("home", "home-create"));
  });

  it("maps the end of a tour to complete, dismiss or stop", () => {
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    const { unmount } = render(<TourGuide />);
    emit({ type: EVENTS.TOUR_END, action: ACTIONS.NEXT, status: STATUS.FINISHED });
    expect(useTourStore.getState().tours.workspace.status).toBe("completed");
    unmount();

    useTourStore.getState().resetAll();
    activate("workspace", "workspace-toolbar");
    const second = render(<TourGuide />);
    emit({ type: EVENTS.TOUR_END, action: ACTIONS.SKIP, status: STATUS.SKIPPED });
    expect(useTourStore.getState().tours.workspace.status).toBe("dismissed");
    second.unmount();

    useTourStore.getState().resetAll();
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);
    emit({ type: EVENTS.TOUR_END, action: ACTIONS.UPDATE, status: STATUS.RUNNING });
    expect(current().activeTourId).toBeNull();
    expect(useTourStore.getState().tours.workspace.status).toBe("pending");
  });

  it("ignores unrelated events", () => {
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);

    emit({ type: EVENTS.STEP_BEFORE, action: ACTIONS.UPDATE, status: STATUS.RUNNING });
    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.UPDATE, status: STATUS.RUNNING });

    expect(current()).toEqual({ activeTourId: "workspace", activeStepIndex: 0 });
  });
});

describe("tooltip arrow", () => {
  function arrowPoints(placement: string) {
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");
    const view = render(<TourGuide />);
    const Arrow = joyrideMocks.props?.arrowComponent as ComponentType<Record<string, unknown>>;
    view.unmount();
    const { container } = render(createElement(Arrow, { base: 16, size: 8, placement }));
    const svg = container.querySelector("svg") as SVGSVGElement;
    return {
      fill: svg.querySelector("polygon")?.getAttribute("points"),
      edge: svg.querySelector("polyline")?.getAttribute("points"),
      width: svg.getAttribute("width"),
      height: svg.getAttribute("height"),
      transform: svg.style.transform,
    };
  }

  it("points down from a tooltip above the target", () => {
    expect(arrowPoints("top-start")).toEqual({
      fill: "0,0 8,8 16,0",
      edge: "0,0 8,8 16,0",
      width: "16",
      height: "8",
      transform: "translateY(-1px)",
    });
  });

  it("points up from a tooltip below the target", () => {
    expect(arrowPoints("bottom")).toEqual({
      fill: "16,8 8,0 0,8",
      edge: "16,8 8,0 0,8",
      width: "16",
      height: "8",
      transform: "translateY(1px)",
    });
  });

  it("points right from a tooltip left of the target", () => {
    expect(arrowPoints("left")).toEqual({
      fill: "0,0 8,8 0,16",
      edge: "0,0 8,8 0,16",
      width: "8",
      height: "16",
      transform: "translateX(-1px)",
    });
  });

  it("points left from a tooltip right of the target", () => {
    expect(arrowPoints("right-end")).toEqual({
      fill: "8,16 8,0 0,8",
      edge: "8,16 0,8 8,0",
      width: "8",
      height: "16",
      transform: "translateX(1px)",
    });
  });
});

describe("reduced motion", () => {
  it("turns off Joyride scrolling and transitions", () => {
    reducedMotion.matches = true;
    mount("div", { "data-tour": "project-toolbar" });
    activate("workspace", "workspace-toolbar");

    render(<TourGuide />);

    const props = joyrideMocks.props as {
      scrollToFirstStep: boolean;
      options: { scrollDuration: number };
      styles: { tooltip: { transition: string } };
    };
    expect(props.scrollToFirstStep).toBe(false);
    expect(props.options.scrollDuration).toBe(0);
    expect(props.styles.tooltip.transition).toBe("none");
    for (const strip of document.querySelectorAll<HTMLElement>("[data-tour-backdrop]")) {
      expect(strip.style.transition).toBe("");
    }
  });
});

describe("backdrop", () => {
  it("appears once a late spotlight target mounts and follows window resizes", async () => {
    activate("workspace", "workspace-toolbar");
    render(<TourGuide />);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.querySelector("[data-tour-backdrop]")).toBeNull();

    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-tour", "project-toolbar");
    let box = { top: 20, left: 30, right: 230, bottom: 60, width: 200, height: 40 };
    toolbar.getBoundingClientRect = () => box as DOMRect;
    await act(async () => {
      document.body.appendChild(toolbar);
    });
    const top = document.querySelector<HTMLElement>('[data-tour-backdrop="top"]') as HTMLElement;
    expect(top.style.height).toBe("14px");

    box = { top: 120, left: 30, right: 230, bottom: 160, width: 200, height: 40 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(
      (document.querySelector('[data-tour-backdrop="top"]') as HTMLElement).style.height,
    ).toBe("114px");
  });
});

describe("tooltip", () => {
  function renderLive(tourId: TourId, stepId: string) {
    joyrideMocks.render = true;
    activate(tourId, stepId);
    render(<TourGuide />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    return document.querySelector<HTMLElement>("[data-tour-tooltip]");
  }

  it("asks before quitting when Skip is pressed", () => {
    mount("div", { "data-tour": "project-editor" });
    const tooltip = renderLive("workspace", "workspace-editor") as HTMLElement;

    fireEvent.click(within(tooltip).getByRole("button", { name: /Skip/ }));

    expect(screen.getByRole("alertdialog", { name: "Quit the tour?" })).toBeInTheDocument();
    expect(current().activeTourId).toBe("workspace");
  });

  it("labels the final step Done and offers a way back", () => {
    mount("div", { "data-tour": "project-preview-content" });
    const tooltip = renderLive("workspace", "workspace-source-navigation") as HTMLElement;

    expect(within(tooltip).getByRole("button", { name: "Last" })).toHaveTextContent("Done");
    expect(within(tooltip).getByTestId("tour-back")).toBeInTheDocument();
    expect(tooltip).toHaveTextContent(`Step ${tourRegistry.workspace.steps.length}`);
  });

  it("enables Next on a required input only once it has text", () => {
    const input = mount("input", { "data-tour": "project-name" }) as HTMLInputElement;
    useSettingsStore.setState({ newProjectOpen: true });
    const tooltip = renderLive("home", "home-name") as HTMLElement;
    expect(within(tooltip).getByRole("button", { name: /Next/ })).toBeDisabled();

    act(() => {
      input.value = "Thesis";
      fireEvent.input(input);
    });

    expect(
      within(document.querySelector("[data-tour-tooltip]") as HTMLElement).getByRole("button", {
        name: /Next/,
      }),
    ).toBeEnabled();
  });

  it("draws the welcome arrow on the overview step", () => {
    mount("div", { "data-tour": "home" });
    const tooltip = renderLive("home", "home-overview") as HTMLElement;

    expect(tooltip.querySelector("svg title")?.textContent).toBe(
      "Hand-drawn arrow pointing to the welcome paragraph",
    );
  });

  it("draws the canvas arrow on the diagram intro step", () => {
    mount("div", { "data-tour": "diagram-intro-anchor" });
    const tooltip = renderLive("diagram", "diagram-composer") as HTMLElement;

    expect(tooltip.querySelector("svg title")?.textContent).toBe(
      "Curved arrow pointing to the diagram canvas",
    );
  });
});
