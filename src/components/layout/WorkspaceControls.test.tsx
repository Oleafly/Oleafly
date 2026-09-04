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
import { useShortcutStore } from "@/store/shortcuts";
import { ThemeProvider } from "@/lib/theme";
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
    expect(toggleBrowser).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("rail-assistant-toggle"));
    expect(useSettingsStore.getState().assistantOpen).toBe(true);
    expect(screen.getByTestId("theme-menu")).toHaveAttribute("aria-label", "Appearance: System");
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });

  it("opens the toolbar theme menu from a click that sends no pointer events", () => {
    render(
      <ThemeProvider>
        <WorkspaceDockControls />
      </ThemeProvider>,
    );
    const trigger = screen.getByTestId("theme-menu");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("offers system, light, and dark from the toolbar theme menu", () => {
    render(
      <ThemeProvider>
        <WorkspaceDockControls />
      </ThemeProvider>,
    );
    const trigger = screen.getByTestId("theme-menu");
    const settings = screen.getByLabelText("Settings");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.className).toContain("h-9");
    expect(trigger.className).toContain("w-9");
    expect(trigger.className).toContain("text-muted-foreground");
    expect(trigger.parentElement?.parentElement).toBe(settings.parentElement?.parentElement);

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(screen.getByTestId("theme-option-system")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByTestId("theme-option-light"));
    expect(localStorage.getItem("oleafly.theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(screen.getByTestId("theme-menu")).toHaveAttribute("aria-label", "Appearance: Light");
    expect(screen.getByTestId("theme-menu")).toHaveAttribute("aria-expanded", "false");

    openThemeMenu(screen.getByTestId("theme-menu"));
    expect(screen.getByTestId("theme-option-light")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByTestId("theme-option-dark"));
    expect(localStorage.getItem("oleafly.theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("theme-menu")).toHaveAttribute("aria-label", "Appearance: Dark");
  });

  it("renders the dock toggles as individual toolbar buttons", () => {
    render(
      <ThemeProvider>
        <WorkspaceDockControls />
      </ThemeProvider>,
    );
    const terminal = screen.getByTestId("rail-terminal-toggle");
    const browser = screen.getByTestId("rail-browser-toggle");
    const assistant = screen.getByTestId("rail-assistant-toggle");

    for (const button of [terminal, browser, assistant]) {
      expect(button.className).toContain("h-9");
      expect(button.className).toContain("w-9");
      expect(button.className).not.toContain("size-7");
      expect(button).toHaveAttribute("aria-pressed", "false");
    }

    const dock = terminal.parentElement?.parentElement;
    expect(dock?.className).toContain("gap-1.5");

    const separators = Array.from(dock?.querySelectorAll("span.w-px") ?? []);
    expect(separators).toHaveLength(3);
    expect(separators[0]?.previousElementSibling).toBe(terminal.parentElement);
    expect(separators[1]?.previousElementSibling).toBe(browser.parentElement);
    expect(separators[2]?.previousElementSibling).toBe(assistant.parentElement);
  });

  it("keeps the shortcut in the terminal and browser labels", () => {
    render(
      <ThemeProvider>
        <WorkspaceDockControls />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("rail-terminal-toggle")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/^Show terminal \(.+\)$/u),
    );
    expect(screen.getByTestId("rail-browser-toggle")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/^Open browser \(.+\)$/u),
    );
    expect(screen.getByTestId("rail-assistant-toggle")).toHaveAttribute(
      "aria-label",
      "Show AI assistant",
    );
  });
});
