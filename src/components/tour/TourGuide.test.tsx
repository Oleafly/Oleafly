// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const themeMocks = vi.hoisted(() => ({
  preference: "system" as "system" | "light" | "dark",
  setPreference: vi.fn(),
}));

vi.mock("react-joyride", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-joyride")>()),
  Joyride: () => null,
}));

vi.mock("@/lib/confetti", () => ({ celebrate: vi.fn() }));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: themeMocks.preference,
    theme: "dark",
    setPreference: themeMocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

import { TourGuide } from "./TourGuide";
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
