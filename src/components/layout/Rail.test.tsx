// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Rail } from "@/components/layout/Rail";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { ThemeProvider } from "@/lib/theme";
import { registerRailTabs } from "@/contributions/tabs";

registerRailTabs();

describe("Rail dock toggles", () => {
  beforeEach(() => {
    useSettingsStore.setState({ terminalOpen: false, browserOpen: false });
    useFilesStore.setState({ projectId: "proj-1" });
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
    expect(screen.getByLabelText("Show terminal")).toBeInTheDocument();
    expect(screen.getByLabelText("Show browser")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Show browser").querySelector(".lucide-globe"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Show browser").querySelector(".lucide-earth"),
    ).not.toBeInTheDocument();
    const labels = Array.from(
      screen.getByRole("navigation", { name: "Sidebar" }).querySelectorAll("button"),
    ).map((button) => button.getAttribute("aria-label"));
    const sourceIndex = labels.indexOf("Source Control");
    const preflightIndex = labels.indexOf("Preflight Checks");
    expect(labels.slice(sourceIndex, preflightIndex + 1)).toEqual([
      "Source Control",
      "Show terminal",
      "Show browser",
      "Preflight Checks",
    ]);
  });

  it("hides the toggles when no project is open", () => {
    useFilesStore.setState({ projectId: null });
    render(
      <ThemeProvider>
        <Rail />
      </ThemeProvider>,
    );
    expect(screen.queryByLabelText("Show terminal")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Show browser")).not.toBeInTheDocument();
  });

  it("flips the dock flags on click", () => {
    render(
      <ThemeProvider>
        <Rail />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Show terminal"));
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    fireEvent.click(screen.getByLabelText("Hide terminal"));
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
    fireEvent.click(screen.getByLabelText("Show browser"));
    expect(useSettingsStore.getState().browserOpen).toBe(true);
  });
});
