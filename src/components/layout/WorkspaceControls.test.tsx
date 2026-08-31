// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SidebarViews,
  WorkspaceDockControls,
} from "@/components/layout/WorkspaceControls";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useShortcutStore } from "@/store/shortcuts";
import { ThemeProvider } from "@/lib/theme";
import { registerRailTabs } from "@/contributions/tabs";

registerRailTabs();

describe("WorkspaceControls", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      terminalOpen: false,
      browserOpen: false,
      assistantOpen: false,
      showTree: true,
      railTab: "files",
    });
    useFilesStore.setState({ projectId: "proj-1" });
    useShortcutStore.getState().resetAll();
  });
  afterEach(() => {
    useFilesStore.setState({ projectId: null });
  });

  it("lists the sidebar view switchers and a collapse toggle", () => {
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Hide sidebar")).toBeInTheDocument();
    expect(screen.getByLabelText("Source Tree")).toBeInTheDocument();
    expect(screen.getByLabelText("Search Project")).toBeInTheDocument();
    expect(screen.getByLabelText("Source Control")).toBeInTheDocument();
  });

  it("switches the active sidebar view and keeps the sidebar open", () => {
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Search Project"));
    expect(useSettingsStore.getState().railTab).toBe("search");
    expect(useSettingsStore.getState().showTree).toBe(true);
  });

  it("collapses the sidebar when the active view is clicked again", () => {
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Source Tree"));
    expect(useSettingsStore.getState().showTree).toBe(false);
  });

  it("toggles the terminal, browser, and assistant docks and exposes theme and settings", () => {
    render(
      <ThemeProvider>
        <WorkspaceDockControls />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("rail-terminal-toggle"));
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    fireEvent.click(screen.getByTestId("rail-browser-toggle"));
    expect(useSettingsStore.getState().browserOpen).toBe(true);
    fireEvent.click(screen.getByTestId("rail-assistant-toggle"));
    expect(useSettingsStore.getState().assistantOpen).toBe(true);
    expect(screen.getByLabelText("Toggle theme")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });
});
