// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchBrowser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-window", () => ({ launchBrowser }));
import {
  SidebarCollapseToggle,
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
      webBrowser: true,
    });
    useFilesStore.setState({ projectId: "proj-1" });
    useShortcutStore.getState().resetAll();
  });
  afterEach(() => {
    useFilesStore.setState({ projectId: null });
  });

  it("lists the sidebar view switchers", () => {
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Source Tree")).toBeInTheDocument();
    expect(screen.getByLabelText("Search Project")).toBeInTheDocument();
    expect(screen.getByLabelText("Source Control")).toBeInTheDocument();
  });

  it("toggles the sidebar from the collapse control", () => {
    render(
      <ThemeProvider>
        <SidebarCollapseToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText(/Hide sidebar/));
    expect(useSettingsStore.getState().showTree).toBe(false);
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

  it("keeps the sidebar open when the active view is clicked again", () => {
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Source Tree"));
    expect(useSettingsStore.getState().railTab).toBe("files");
    expect(useSettingsStore.getState().showTree).toBe(true);
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
    expect(launchBrowser).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("rail-assistant-toggle"));
    expect(useSettingsStore.getState().assistantOpen).toBe(true);
    expect(screen.getByLabelText("Toggle theme")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });
});
