// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toggleBrowser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-window", () => ({ toggleBrowser, launchBrowser: vi.fn() }));
import {
  SidebarCollapseToggle,
  SidebarViews,
  WorkspaceDockControls,
} from "@/components/layout/WorkspaceControls";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { i18n } from "@/i18n";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { ThemeProvider } from "@/lib/theme";
import { TOOLBAR_OVERFLOW } from "@/lib/use-toolbar-layout";
import { registerRailTabs } from "@/contributions/tabs";

registerRailTabs();

function openThemeMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

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
    localStorage.removeItem("oleafly.theme");
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
    expect(
      screen.getByLabelText(enShell.rail.files).querySelector("svg.lucide-folder"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(enShell.rail.search)).toBeInTheDocument();
    expect(screen.getByLabelText(enShell.rail.sourceControl)).toBeInTheDocument();
  });

  it("toggles the sidebar from the collapse control", () => {
    render(
      <ThemeProvider>
        <SidebarCollapseToggle />
      </ThemeProvider>,
    );
    const hideSidebar = i18n.t(($) => $.shell.dock.sidebar.hide, {
      shortcut: shortcutLabel(useShortcutStore.getState().bindings.toggleSidebar),
    });
    fireEvent.click(screen.getByLabelText(hideSidebar));
    expect(useSettingsStore.getState().showTree).toBe(false);
  });

  it("switches the active sidebar view and keeps the sidebar open", () => {
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText(enShell.rail.search));
    expect(useSettingsStore.getState().railTab).toBe("search");
    expect(useSettingsStore.getState().showTree).toBe(true);
  });

  it("keeps the sidebar open when the active view is clicked again", () => {
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText(enShell.rail.files));
    expect(useSettingsStore.getState().railTab).toBe("files");
    expect(useSettingsStore.getState().showTree).toBe(true);
  });

  it("keeps terminal and assistant buttons visible and groups secondary actions", () => {
    const fork = vi.fn();
    render(<ThemeProvider><WorkspaceDockControls onFork={fork} /></ThemeProvider>);
    fireEvent.click(screen.getByTestId("rail-terminal-toggle"));
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    fireEvent.click(screen.getByTestId("rail-assistant-toggle"));
    expect(useSettingsStore.getState().assistantOpen).toBe(true);
    expect(screen.queryByTestId("open-settings")).not.toBeInTheDocument();
    openThemeMenu(screen.getByTestId("workspace-menu"));
    fireEvent.click(screen.getByTestId("rail-browser-toggle"));
    expect(toggleBrowser).toHaveBeenCalled();
    openThemeMenu(screen.getByTestId("workspace-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: enShell.toolbar.forkProject }));
    expect(fork).toHaveBeenCalledOnce();
    openThemeMenu(screen.getByTestId("workspace-menu"));
    fireEvent.click(screen.getByTestId("open-settings"));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });

  it("keeps terminal and AI visible at maximum overflow", () => {
    useSettingsStore.setState({ settingsOpen: false });
    render(<ThemeProvider><WorkspaceDockControls overflow={TOOLBAR_OVERFLOW.export} /></ThemeProvider>);
    expect(screen.getByTestId("rail-assistant-toggle")).toBeVisible();
    expect(screen.getByRole("button", { name: /Show terminal/ })).toBeVisible();
    expect(screen.getByTestId("rail-terminal-toggle").closest("[inert]")).toBeNull();
    fireEvent.click(screen.getByTestId("rail-terminal-toggle"));
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    openThemeMenu(screen.getByTestId("workspace-menu"));
    expect(screen.queryByRole("menuitem", { name: /terminal/ })).not.toBeInTheDocument();
  });

  it("opens More actions from a click without pointer events", () => {
    render(<ThemeProvider><WorkspaceDockControls /></ThemeProvider>);
    fireEvent.click(screen.getByTestId("workspace-menu"));
    expect(screen.getByTestId("workspace-menu")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("open-settings")).toBeVisible();
  });

  it("moves browser, theme, and settings between direct controls and the overflow menu", () => {
    useSettingsStore.setState({ settingsOpen: false });
    const { rerender } = render(<ThemeProvider><WorkspaceDockControls overflow={0} /></ThemeProvider>);
    expect(screen.getByRole("button", { name: enShell.dock.settings })).toBeVisible();
    expect(screen.queryByRole("button", { name: enShell.toolbar.moreActions })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rail-browser-toggle"));
    expect(toggleBrowser).toHaveBeenCalled();
    openThemeMenu(screen.getByRole("button", { name: "Appearance: System" }));
    fireEvent.click(screen.getByTestId("theme-option-dark"));
    expect(localStorage.getItem("oleafly.theme")).toBe("dark");

    rerender(<ThemeProvider><WorkspaceDockControls overflow={TOOLBAR_OVERFLOW.layout} /></ThemeProvider>);
    expect(screen.queryByRole("button", { name: enShell.dock.settings })).not.toBeInTheDocument();
    openThemeMenu(screen.getByTestId("workspace-menu"));
    expect(screen.getByRole("menuitem", { name: /Open browser/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Appearance: Dark" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: enShell.dock.settings }));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });

  it("changes and retains the theme through the grouped menu", async () => {
    render(<ThemeProvider><WorkspaceDockControls /></ThemeProvider>);
    openThemeMenu(screen.getByTestId("workspace-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Appearance: System" }));
    expect(await screen.findAllByRole("menuitemradio")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("theme-option-dark"));
    expect(localStorage.getItem("oleafly.theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    openThemeMenu(screen.getByTestId("workspace-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Appearance: Dark" }));
    expect(await screen.findByTestId("theme-option-dark")).toHaveAttribute("aria-checked", "true");
  });

  it("keeps shortcut labels in the grouped actions", () => {
    render(<ThemeProvider><WorkspaceDockControls /></ThemeProvider>);
    const bindings = useShortcutStore.getState().bindings;
    expect(screen.getByTestId("rail-terminal-toggle")).toHaveAttribute("aria-label",
      i18n.t(($) => $.shell.dock.terminal.show, { shortcut: shortcutLabel(bindings.toggleTerminal) }));
    openThemeMenu(screen.getByTestId("workspace-menu"));
    expect(screen.getByTestId("rail-browser-toggle")).toHaveTextContent(
      i18n.t(($) => $.shell.dock.browser.open, { shortcut: shortcutLabel(bindings.toggleBrowser) }));
  });

});
