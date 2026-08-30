// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNativeWebviewOccluded } from "@/lib/native-webview-occlusion";
import {
  ACCENTS,
  DEFAULT_HIDDEN_FILE_PATTERNS,
  useSettingsStore,
} from "@/store/settings";

const toggleTheme = vi.hoisted(() => vi.fn());

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme,
  }),
}));

import { AppearanceSection } from "./AppearanceSection";
import { ShortcutsSection } from "./ShortcutsSection";

describe("Appearance settings tabs", () => {
  beforeEach(() => {
    toggleTheme.mockClear();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    useSettingsStore.setState({
      dockPlacement: "left",
      bgPattern: "dots",
      accentColor: ACCENTS[0].color,
      vim: false,
      editorAutocomplete: false,
      editorAutoCloseBrackets: false,
      editorGhostCompletion: false,
      editorNonBlinkingCursor: false,
      editorStickyScroll: false,
      hiddenFilePatterns: [...DEFAULT_HIDDEN_FILE_PATTERNS],
      openInTree: false,
      pdfDarkMode: false,
      pdfZoomShortcuts: false,
      hoverPreview: false,
      homeProjectLayout: "grid",
      terminalFontSize: 14,
      terminalFontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
      terminalFontWeight: 500,
      terminalFontWeightBold: 700,
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalColorTheme: "dark",
      terminalBackground: "#1e1e1e",
      terminalForeground: "#f2f2f2",
      terminalCursorColor: "#ffffff",
      browserSearchEngine: "google",
      browserHomePage: "https://www.google.com/",
    });
  });

  it("groups editor, PDF preview, and file management settings", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    expect(screen.getByRole("tab", { name: "App" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PDF Preview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Browser" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "PDF Preview" }));
    expect(screen.getByRole("switch", { name: "PDF dark mode" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "PDF zoom shortcuts" })).toBeInTheDocument();

    for (const label of [
      "PDF dark mode",
      "PDF zoom shortcuts",
      "Preview PDF on hover",
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({
      pdfDarkMode: true,
      pdfZoomShortcuts: true,
      hoverPreview: true,
    });
  });

  it("keeps the tab strip scrollable and reveals keyboard-selected tabs", async () => {
    render(<AppearanceSection />);

    const tabList = screen.getByRole("tablist");
    expect(tabList).toHaveClass("overflow-x-auto", "no-scrollbar");

    const appTab = screen.getByRole("tab", { name: "App" });
    const editorTab = screen.getByRole("tab", { name: "Editor" });
    const scrollIntoView = vi.fn();
    editorTab.scrollIntoView = scrollIntoView;
    appTab.focus();
    fireEvent.keyDown(appTab, { key: "ArrowRight" });

    await waitFor(() => expect(editorTab).toHaveAttribute("aria-selected", "true"));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("scrolls the tab strip horizontally with a mouse wheel", () => {
    render(<AppearanceSection />);

    const tabList = screen.getByRole("tablist");
    Object.defineProperties(tabList, {
      clientWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 640 },
    });

    fireEvent.wheel(tabList, { deltaY: 80 });

    expect(tabList.scrollLeft).toBe(80);
  });

  it("updates the app and editor appearance controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    await user.click(screen.getByTestId("settings-dock-placement-right"));
    await user.click(screen.getByTestId("settings-bg-pattern-grid"));
    await user.click(
      screen.getByRole("button", { name: `${ACCENTS[1].name} accent` }),
    );
    await user.click(screen.getByRole("switch", { name: "Dark mode" }));

    expect(useSettingsStore.getState()).toMatchObject({
      dockPlacement: "right",
      bgPattern: "grid",
      accentColor: ACCENTS[1].color,
    });
    expect(toggleTheme).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("tab", { name: "Editor" }));
    for (const label of [
      "Vim mode",
      "Auto-complete",
      "Auto-close brackets",
      "Inline suggestion",
      "Non-blinking cursor",
      "Sticky scroll",
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({
      vim: true,
      editorAutocomplete: true,
      editorAutoCloseBrackets: true,
      editorGhostCompletion: true,
      editorNonBlinkingCursor: true,
      editorStickyScroll: true,
    });
  });

  it("uses the shared file-management controls to add and remove patterns", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Project" }));

    const homeView = screen.getByLabelText("Default home view");
    expect(homeView).toHaveTextContent("Grid");
    await user.click(homeView);
    await user.click(await screen.findByRole("option", { name: "List" }));
    expect(useSettingsStore.getState().homeProjectLayout).toBe("list");

    await user.click(screen.getByRole("switch", { name: "Show file tree on open" }));
    expect(useSettingsStore.getState().openInTree).toBe(true);

    expect(screen.getByText("*.aux")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("File name or pattern to hide"), {
      target: { value: "*.generated.tex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add hidden file pattern" }));
    expect(screen.getByText("*.generated.tex")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove *.generated.tex from hidden files",
      }),
    );
    expect(screen.queryByText("*.generated.tex")).not.toBeInTheDocument();

    const patternInput = screen.getByLabelText("File name or pattern to hide");
    fireEvent.change(patternInput, { target: { value: "   " } });
    const patternForm = patternInput.closest("form");
    expect(patternForm).not.toBeNull();
    if (!patternForm) throw new Error("hidden-file form is unavailable");
    fireEvent.submit(patternForm);
    expect(useSettingsStore.getState().hiddenFilePatterns).toEqual(
      DEFAULT_HIDDEN_FILE_PATTERNS,
    );
  });

  it("updates terminal appearance controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Terminal" }));

    expect(screen.getByLabelText("Terminal font size")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal font family")).toBeInTheDocument();
    expect(screen.getByLabelText("Regular font weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Bold font weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal cursor style")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Blink cursor" })).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal color theme")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal background color")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal foreground color")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal cursor color")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Terminal font size"));
    await user.click(await screen.findByRole("option", { name: "16px" }));
    await user.click(screen.getByLabelText("Terminal cursor style"));
    await user.click(await screen.findByRole("option", { name: "Underline" }));
    await user.click(screen.getByRole("switch", { name: "Blink cursor" }));
    await user.click(screen.getByLabelText("Terminal color theme"));
    await user.click(await screen.findByRole("option", { name: "Light" }));
    fireEvent.change(screen.getByLabelText("Terminal background color"), {
      target: { value: "#f8f8f8" },
    });

    expect(useSettingsStore.getState()).toMatchObject({
      terminalFontSize: 16,
      terminalCursorStyle: "underline",
      terminalCursorBlink: false,
      terminalColorTheme: "light",
      terminalBackground: "#f8f8f8",
    });
  });

  it("updates browser search and home page controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));

    await user.click(screen.getByLabelText("Default search engine"));
    await user.click(await screen.findByRole("option", { name: "DuckDuckGo" }));
    const homePage = screen.getByLabelText("Browser home page");
    await user.clear(homePage);
    await user.type(homePage, "https://example.com/");
    fireEvent.blur(homePage);

    expect(useSettingsStore.getState()).toMatchObject({
      browserSearchEngine: "duckduckgo",
      browserHomePage: "https://example.com/",
    });
  });

  it("renders a local icon for every browser search engine", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));

    const trigger = screen.getByLabelText("Default search engine");
    expect(
      within(trigger).getByTestId("search-engine-icon-google"),
    ).toBeInTheDocument();
    await user.click(trigger);

    for (const engine of [
      { id: "google", name: "Google" },
      { id: "duckduckgo", name: "DuckDuckGo" },
      { id: "bing", name: "Bing" },
    ]) {
      const option = await screen.findByRole("option", { name: engine.name });
      expect(
        within(option).getByTestId(`search-engine-icon-${engine.id}`),
      ).toBeInTheDocument();
    }
  });

  it("occludes native webviews only while a select menu is open", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    expect(getNativeWebviewOccluded()).toBe(false);

    await user.click(
      within(screen.getByTestId("settings-row-app-font-size")).getByRole(
        "combobox",
      ),
    );
    await waitFor(() => expect(getNativeWebviewOccluded()).toBe(true));
    await user.click(await screen.findByRole("option", { name: "17px" }));
    expect(getNativeWebviewOccluded()).toBe(true);
    await waitFor(() => expect(getNativeWebviewOccluded()).toBe(false));
  });
});

describe("Shortcut settings", () => {
  it("lists both dock toggle shortcuts", () => {
    render(<ShortcutsSection />);

    expect(screen.getByText("Toggle terminal")).toBeInTheDocument();
    expect(screen.getByText("Toggle browser")).toBeInTheDocument();
  });

  it("shows fixed Ctrl in the terminal shortcut", () => {
    render(<ShortcutsSection />);

    const label = screen.getByText("Toggle terminal");
    const row = label.parentElement?.parentElement;
    expect(row).not.toBeNull();
    if (!row) throw new Error("terminal shortcut row is unavailable");
    expect(within(row).getByText("Ctrl")).toBeInTheDocument();
    expect(within(row).getByText("`")).toBeInTheDocument();
  });

  it("shows fixed Ctrl+Shift+B in the browser shortcut", () => {
    render(<ShortcutsSection />);

    const label = screen.getByText("Toggle browser");
    const row = label.parentElement?.parentElement;
    expect(row).not.toBeNull();
    if (!row) throw new Error("browser shortcut row is unavailable");
    expect(within(row).getByText("Ctrl")).toBeInTheDocument();
    expect(within(row).getByText("Shift")).toBeInTheDocument();
    expect(within(row).getByText("B")).toBeInTheDocument();
  });

  it("detects the editor's fixed Ctrl+Space binding on macOS", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const user = userEvent.setup();
      render(<ShortcutsSection />);
      await user.click(
        screen.getByRole("button", { name: /Edit Toggle browser/u }),
      );
      fireEvent.keyDown(
        screen.getByRole("button", { name: /Recording Toggle browser/u }),
        { key: " ", ctrlKey: true },
      );

      expect(
        screen.getByText("Already assigned to Trigger autocomplete."),
      ).toBeInTheDocument();
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });
});
