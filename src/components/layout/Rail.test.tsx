// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Rail } from "@/components/layout/Rail";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useShortcutStore } from "@/store/shortcuts";
import { ThemeProvider } from "@/lib/theme";
import { registerRailTabs } from "@/contributions/tabs";

registerRailTabs();

describe("Rail dock toggles", () => {
  beforeEach(() => {
    useSettingsStore.setState({ terminalOpen: false, browserOpen: false });
    useFilesStore.setState({ projectId: "proj-1" });
    useShortcutStore.getState().resetAll();
  });
  afterEach(() => {
    useFilesStore.setState({ projectId: null });
  });

  it("shows terminal and browser toggles below Source Control", () => {
    render(
      <ThemeProvider>
        <Rail />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Show terminal (Ctrl+`)")).toBeInTheDocument();
    expect(screen.getByLabelText("Show browser (Ctrl+Shift+B)")).toBeInTheDocument();
    expect(
      screen
        .getByLabelText("Show browser (Ctrl+Shift+B)")
        .querySelector(".lucide-globe"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByLabelText("Show browser (Ctrl+Shift+B)")
        .querySelector(".lucide-earth"),
    ).not.toBeInTheDocument();
    const labels = Array.from(
      screen.getByRole("navigation", { name: "Sidebar" }).querySelectorAll("button"),
    ).map((button) => button.getAttribute("aria-label"));
    const sourceIndex = labels.indexOf("Source Control");
    const preflightIndex = labels.indexOf("Preflight Checks");
    expect(labels.slice(sourceIndex, preflightIndex + 1)).toEqual([
      "Source Control",
      "Show terminal (Ctrl+`)",
      "Show browser (Ctrl+Shift+B)",
      "Preflight Checks",
    ]);
  });

  it("shows the current dock shortcuts in the tooltips", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Rail />
      </ThemeProvider>,
    );

    await user.hover(screen.getByLabelText("Show terminal (Ctrl+`)"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Show terminal (Ctrl+`)",
    );
    await user.unhover(screen.getByLabelText("Show terminal (Ctrl+`)"));
    await user.hover(screen.getByLabelText("Show browser (Ctrl+Shift+B)"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Show browser (Ctrl+Shift+B)",
    );
  });

  it("updates dock toggle labels after a shortcut is rebound", () => {
    render(
      <ThemeProvider>
        <Rail />
      </ThemeProvider>,
    );

    act(() => {
      useShortcutStore.getState().setBinding("toggleTerminal", {
        key: "t",
        ctrl: true,
        shift: true,
      });
      useShortcutStore.getState().setBinding("toggleBrowser", {
        key: "g",
        ctrl: true,
      });
    });

    expect(screen.getByLabelText("Show terminal (Ctrl+Shift+T)")).toBeInTheDocument();
    expect(screen.getByLabelText("Show browser (Ctrl+G)")).toBeInTheDocument();
  });

  it("hides the toggles when no project is open", () => {
    useFilesStore.setState({ projectId: null });
    render(
      <ThemeProvider>
        <Rail />
      </ThemeProvider>,
    );
    expect(screen.queryByLabelText(/Show terminal/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Show browser/u)).not.toBeInTheDocument();
  });

  it("flips the dock flags on click", () => {
    render(
      <ThemeProvider>
        <Rail />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Show terminal (Ctrl+`)"));
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    fireEvent.click(screen.getByLabelText("Hide terminal (Ctrl+`)"));
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
    fireEvent.click(screen.getByLabelText("Show browser (Ctrl+Shift+B)"));
    expect(useSettingsStore.getState().browserOpen).toBe(true);
  });
});
