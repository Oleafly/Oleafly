// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENTS,
  DEFAULT_HIDDEN_FILE_PATTERNS,
  TERMINAL_COLOR_THEMES,
  useSettingsStore,
} from "@/store/settings";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

const appearance = enSettings.appearance;
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, value),
    template,
  );

const themeMocks = vi.hoisted(() => ({
  preference: "dark" as "system" | "light" | "dark",
  setPreference: vi.fn(),
  applyTheme: vi.fn(),
}));
vi.mock("@/lib/theme", () => ({
  applyTheme: themeMocks.applyTheme,
  currentTheme: () => "dark",
  useTheme: () => ({
    preference: themeMocks.preference,
    theme: themeMocks.preference === "light" ? "light" : "dark",
    setPreference: themeMocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

import {
  emptyThemeCustomization,
  readThemeCustomization,
  resetThemeCustomization,
  writeThemeCustomization,
} from "@/lib/theme-customization";
import { AppearanceSection } from "./AppearanceSection";
import { ShortcutsSection } from "./ShortcutsSection";

describe("Appearance settings tabs", () => {
  beforeEach(() => {
    themeMocks.preference = "dark";
    themeMocks.setPreference.mockClear();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    useSettingsStore.setState({
      dockPlacement: "left",
      bgPattern: "dots",
      accentColor: ACCENTS[0].color,
      editorKeymap: "default",
      editorLineWrap: false,
      editorTabSize: 4,
      editorLineHeight: "normal",
      editorAutocomplete: false,
      editorAutoCloseBrackets: false,
      editorGhostCompletion: false,
      editorCursorBlinking: "blink",
      editorStickyScroll: false,
      hiddenFilePatterns: [...DEFAULT_HIDDEN_FILE_PATTERNS],
      openInTree: false,
      pdfDarkMode: false,
      hoverPreview: false,
      homeProjectLayout: "grid",
      terminalFontSize: 14,
      terminalFontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
      terminalFontWeight: 500,
      terminalFontWeightBold: 700,
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalStartWithProject: true,
      terminalColorTheme: "dark",
      terminalBackground: "#1e1e1e",
      terminalForeground: "#f2f2f2",
      terminalCursorColor: "#ffffff",
    });
  });

  it("groups editor, PDF preview, and file management settings", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    expect(screen.getByRole("tab", { name: appearance.tabs.app })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: appearance.tabs.editor })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: appearance.tabs.pdf })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: appearance.tabs.files })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: appearance.tabs.terminal })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Browser" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: appearance.tabs.pdf }));
    expect(
      screen.getByRole("switch", { name: appearance.preview.darkMode.label }),
    ).toBeInTheDocument();
    for (const label of [appearance.preview.darkMode.label, appearance.preview.hoverPreview.label]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({ pdfDarkMode: true, hoverPreview: true });
  });

  it("fits the tab strip to its tabs while keeping it scrollable", async () => {
    render(<AppearanceSection />);

    const tabList = screen.getByRole("tablist");
    expect(tabList).toHaveClass(
      "w-fit",
      "max-w-full",
      "overflow-x-auto",
      "no-scrollbar",
    );
    expect(tabList).not.toHaveClass("w-full");
    expect(tabList).not.toHaveClass("max-w-xs");

    const appTab = screen.getByRole("tab", { name: appearance.tabs.app });
    const editorTab = screen.getByRole("tab", { name: appearance.tabs.editor });
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
      screen.getByRole("button", {
        name: fill(appearance.app.accent.swatchAriaLabel, { name: ACCENTS[1].name }),
      }),
    );
    await user.click(screen.getByTestId("settings-appearance-light"));

    expect(useSettingsStore.getState()).toMatchObject({
      dockPlacement: "right",
      bgPattern: "grid",
      accentColor: ACCENTS[1].color,
    });
    expect(themeMocks.setPreference).toHaveBeenCalledWith("light");

    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    for (const label of [
      appearance.editor.lineWrap.label,
      appearance.editor.autocomplete.label,
      appearance.editor.autoCloseBrackets.label,
      appearance.editor.ghostCompletion.label,
      appearance.editor.stickyScroll.label,
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({
      editorLineWrap: true,
      editorAutocomplete: true,
      editorAutoCloseBrackets: true,
      editorGhostCompletion: true,
      editorStickyScroll: true,
    });
  }, 15_000);

  it("switches the keybinding mode, tab size, and line height from the editor tab", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));

    await user.click(screen.getByTestId("settings-editor-keymap-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.keymap.options.emacs }),
    );
    expect(useSettingsStore.getState()).toMatchObject({ editorKeymap: "emacs", vim: false });

    await user.click(screen.getByTestId("settings-editor-keymap-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.keymap.options.vim }),
    );
    expect(useSettingsStore.getState()).toMatchObject({ editorKeymap: "vim", vim: true });

    await user.click(screen.getByTestId("settings-editor-tab-size-trigger"));
    await user.click(await screen.findByRole("option", { name: "2" }));
    expect(useSettingsStore.getState().editorTabSize).toBe(2);

    await user.click(screen.getByTestId("settings-editor-line-height-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.lineHeight.options.wide }),
    );
    expect(useSettingsStore.getState().editorLineHeight).toBe("wide");
  }, 15_000);

  it("picks the app icon from previews of both icons and says where it shows", async () => {
    const user = userEvent.setup();
    act(() => useSettingsStore.getState().setAppIcon("blue"));
    render(<AppearanceSection />);

    const row = screen.getByTestId("settings-row-app-icon");
    expect(
      screen.getByTestId("theme-customization").compareDocumentPosition(row) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(row).getByText(appearance.app.appIcon.label)).toBeInTheDocument();
    expect(within(row).getByText(appearance.app.appIcon.description)).toBeInTheDocument();
    expect(row).toHaveAttribute("data-state", "closed");
    expect(row.querySelector("img")).toHaveAttribute("src", "/app-icon/blue.png");
    expect(within(row).queryByRole("button", { name: appearance.app.appIcon.blue })).toBeNull();
    expect(within(row).queryByText(appearance.app.appIcon.note)).toBeNull();

    await user.hover(within(row).getByRole("button", { name: appearance.app.appIcon.about }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(appearance.app.appIcon.note);
    expect(row).toHaveAttribute("data-state", "closed");

    await user.click(screen.getByTestId("settings-row-app-icon-toggle"));
    expect(row).toHaveAttribute("data-state", "open");
    const blue = within(row).getByRole("button", { name: appearance.app.appIcon.blue });
    const light = within(row).getByRole("button", { name: appearance.app.appIcon.light });
    expect(blue.querySelector("img")).toHaveAttribute("src", "/app-icon/blue.png");
    expect(light.querySelector("img")).toHaveAttribute("src", "/app-icon/light.png");
    expect(blue).toHaveAttribute("aria-pressed", "true");
    expect(light).toHaveAttribute("aria-pressed", "false");

    await user.click(light);
    expect(useSettingsStore.getState().appIcon).toBe("light");
    expect(localStorage.getItem("oleafly.appIcon")).toBe("light");
    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(blue).toHaveAttribute("aria-pressed", "false");

    await user.click(blue);
    expect(useSettingsStore.getState().appIcon).toBe("blue");
  });

  it("sets the app zoom from its list", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ appZoom: 100 });
    render(<AppearanceSection />);
    await user.click(screen.getByTestId("settings-app-zoom-trigger"));
    await user.click(await screen.findByRole("option", { name: appearance.app.zoom.option.replace("{{value}}", "125") }));
    expect(useSettingsStore.getState().appZoom).toBe(125);
    expect(localStorage.getItem("oleafly.appZoom")).toBe("125");
    act(() => useSettingsStore.getState().setAppZoom(100));
  });

  it("locks the editor font and size while the editor uses the app font, and says why", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorUsesAppFont: false });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    expect(screen.getByTestId("settings-editor-font-size-trigger")).toBeEnabled();
    expect(screen.getByRole("combobox", { name: appearance.editor.font.label })).toBeEnabled();

    await user.click(screen.getByRole("switch", { name: appearance.editor.useAppFont.label }));
    expect(useSettingsStore.getState().editorUsesAppFont).toBe(true);
    expect(screen.getByTestId("settings-editor-font-size-trigger")).toBeDisabled();
    const font = screen.getByRole("combobox", { name: appearance.editor.font.label });
    expect(font).toBeDisabled();
    await user.hover(font.parentElement as HTMLElement);
    expect(await screen.findAllByText(appearance.editor.useAppFont.disabledHint)).not.toHaveLength(0);

    await user.click(screen.getByRole("switch", { name: appearance.editor.useAppFont.label }));
    expect(screen.getByTestId("settings-editor-font-size-trigger")).toBeEnabled();
  });

  it("offers letter spacing presets and an exact custom value", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorLetterSpacing: "normal", editorCustomLetterSpacing: 0 });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    expect(screen.queryByTestId("settings-editor-letter-spacing-custom")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("settings-editor-letter-spacing-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.letterSpacing.option.replace("{{value}}", "1") }),
    );
    expect(useSettingsStore.getState().editorLetterSpacing).toBe("wide");

    await user.click(screen.getByTestId("settings-editor-letter-spacing-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.letterSpacing.options.custom }),
    );
    const field = screen.getByRole("spinbutton", { name: appearance.editor.letterSpacing.customLabel });
    fireEvent.change(field, { target: { value: "2.5" } });
    expect(useSettingsStore.getState().editorCustomLetterSpacing).toBe(2.5);
    fireEvent.change(field, { target: { value: "12" } });
    fireEvent.blur(field);
    expect(useSettingsStore.getState().editorCustomLetterSpacing).toBe(4);
    act(() => useSettingsStore.setState({ editorLetterSpacing: "normal", editorCustomLetterSpacing: 0 }));
  });

  it("takes an exact editor font size beyond the list", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorFontSize: 13 });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    expect(screen.queryByTestId("settings-editor-font-size-custom")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("settings-editor-font-size-trigger"));
    await user.click(await screen.findByRole("option", { name: appearance.editor.fontSize.custom }));
    const field = screen.getByRole("spinbutton", { name: appearance.editor.fontSize.customLabel });
    expect(field).toHaveValue(13);
    fireEvent.change(field, { target: { value: "32" } });
    expect(useSettingsStore.getState().editorFontSize).toBe(32);
    fireEvent.change(field, { target: { value: "400" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useSettingsStore.getState().editorFontSize).toBe(100);

    await user.click(screen.getByTestId("settings-editor-font-size-trigger"));
    await user.click(await screen.findByRole("option", { name: "14px" }));
    expect(useSettingsStore.getState().editorFontSize).toBe(14);
    expect(screen.queryByTestId("settings-editor-font-size-custom")).not.toBeInTheDocument();
  });

  it("shows an exact line height field only for the custom choice", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorCustomLineHeight: 1.7 });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    expect(screen.queryByTestId("settings-editor-line-height-custom")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("settings-editor-line-height-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.lineHeight.options.custom }),
    );
    const field = screen.getByRole("spinbutton", { name: appearance.editor.lineHeight.customLabel });
    expect(field).toHaveValue(1.7);

    fireEvent.change(field, { target: { value: "1.55" } });
    expect(useSettingsStore.getState()).toMatchObject({
      editorLineHeight: "custom",
      editorCustomLineHeight: 1.55,
    });

    fireEvent.change(field, { target: { value: "8" } });
    expect(useSettingsStore.getState().editorCustomLineHeight).toBe(1.55);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useSettingsStore.getState().editorCustomLineHeight).toBe(3);
    expect(field).toHaveValue(3);

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(useSettingsStore.getState().editorCustomLineHeight).toBe(3);
    expect(field).toHaveValue(3);

    act(() => useSettingsStore.setState({ editorCustomLineHeight: 1.7 }));
    expect(field).toHaveValue(1.7);
  });

  it("picks a cursor color for light and for dark editor themes and goes back to the theme's", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      editorCursorColorLight: "",
      editorCursorColorDark: "",
      editorThemeLight: "system",
      editorThemeDark: "dracula",
    });
    const palette = document.createElement("style");
    palette.textContent = '[data-editor-theme="dracula"] { --cm-cursor: #f8f8f2; }';
    document.head.append(palette);
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    const row = screen.getByTestId("settings-row-editor-cursor-color");
    const cursorColor = appearance.editor.cursorColor;
    expect(within(row).queryByRole("button", { name: cursorColor.useTheme })).toBeNull();
    expect(screen.getByTestId("settings-editor-cursor-color-dark")).toHaveAttribute("data-custom", "false");
    expect(within(row).getByLabelText(cursorColor.pickDark)).toHaveValue("#f8f8f2");

    fireEvent.change(within(row).getByLabelText(cursorColor.pickLight), { target: { value: "#ff8800" } });
    fireEvent.change(within(row).getByLabelText(cursorColor.pickDark), { target: { value: "#88ccff" } });
    expect(useSettingsStore.getState()).toMatchObject({
      editorCursorColorLight: "#ff8800",
      editorCursorColorDark: "#88ccff",
    });
    expect(screen.getByTestId("settings-editor-cursor-color-dark")).toHaveAttribute("data-custom", "true");

    await user.click(within(row).getByRole("button", { name: cursorColor.useTheme }));
    expect(useSettingsStore.getState()).toMatchObject({ editorCursorColorLight: "", editorCursorColorDark: "" });
    useSettingsStore.setState({ editorThemeLight: "system", editorThemeDark: "system" });
    palette.remove();
  });

  it("shows a theme for light mode and one for dark mode, and the editor colors under them", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorThemeLight: "paper", editorThemeDark: "nord" });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));

    const light = screen.getByTestId("settings-row-editor-theme-light");
    const dark = screen.getByTestId("settings-row-editor-theme-dark");
    expect(light).toHaveTextContent(appearance.editor.theme.light.label);
    expect(within(light).getByTestId("settings-editor-theme-light-trigger")).toHaveTextContent("Paper");
    expect(dark).toHaveTextContent(appearance.editor.theme.dark.label);
    expect(within(dark).getByTestId("settings-editor-theme-dark-trigger")).toHaveTextContent("Nord");
    expect(screen.getByTestId("editor-colors")).toHaveTextContent(appearance.editor.colors.title);
    useSettingsStore.setState({ editorThemeLight: "system", editorThemeDark: "system" });
  });

  it("changes the editor cursor width", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorCursorWidth: 1 });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    const row = screen.getByTestId("settings-row-editor-cursor-width");
    expect(row).toHaveTextContent(appearance.editor.cursorWidth.label);
    await user.click(screen.getByTestId("settings-editor-cursor-width-trigger"));
    await user.click(
      await screen.findByRole("option", { name: fill(appearance.fontSizeOption, { size: "3" }) }),
    );
    expect(useSettingsStore.getState().editorCursorWidth).toBe(3);
  });

  it("changes the editor cursor height", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorCursorHeight: "text" });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    const row = screen.getByTestId("settings-row-editor-cursor-height");
    expect(row).toHaveTextContent(appearance.editor.cursorHeight.label);
    expect(row).toHaveTextContent(appearance.editor.cursorHeight.options.text);
    await user.click(screen.getByTestId("settings-editor-cursor-height-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.cursorHeight.options.line }),
    );
    expect(useSettingsStore.getState().editorCursorHeight).toBe("line");
  });

  it("chooses how the editor cursor blinks", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorCursorBlinking: "blink" });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    const row = screen.getByTestId("settings-row-editor-cursor-blinking");
    expect(row).toHaveTextContent(appearance.editor.cursorBlinking.label);
    expect(row).toHaveTextContent(appearance.editor.cursorBlinking.options.blink);
    expect(screen.queryByRole("switch", { name: "Non-blinking cursor" })).toBeNull();
    for (const style of ["smooth", "phase", "expand", "off"] as const) {
      await user.click(screen.getByTestId("settings-editor-cursor-blinking-trigger"));
      await user.click(
        await screen.findByRole("option", { name: appearance.editor.cursorBlinking.options[style] }),
      );
      expect(useSettingsStore.getState().editorCursorBlinking).toBe(style);
    }
  });

  it("turns the current-line highlight off and on", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorHighlightCurrentLine: true });
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));
    const toggle = screen.getByRole("switch", { name: appearance.editor.highlightCurrentLine.label });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(useSettingsStore.getState().editorHighlightCurrentLine).toBe(false);
    await user.click(toggle);
    expect(useSettingsStore.getState().editorHighlightCurrentLine).toBe(true);
  });

  it("chooses what happens to references when a file moves", async () => {
    useSettingsStore.getState().setFileMoveReferences("ask");
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.editor }));

    const row = screen.getByTestId("settings-row-file-move-references");
    expect(row).toHaveTextContent(appearance.editor.fileMove.label);
    expect(row).toHaveTextContent(appearance.editor.fileMove.options.ask);

    await user.click(screen.getByTestId("settings-file-move-references-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.fileMove.options.always }),
    );
    expect(useSettingsStore.getState().fileMoveReferences).toBe("always");

    await user.click(screen.getByTestId("settings-file-move-references-trigger"));
    await user.click(
      await screen.findByRole("option", { name: appearance.editor.fileMove.options.never }),
    );
    expect(useSettingsStore.getState().fileMoveReferences).toBe("never");
  });

  it("offers system, light, and dark appearance with the active choice pressed", () => {
    themeMocks.preference = "system";
    render(<AppearanceSection />);

    const row = screen.getByTestId("settings-row-appearance");
    expect(row).toHaveTextContent(appearance.app.theme.label);
    expect(row).toHaveTextContent(appearance.app.theme.description);
    expect(within(row).getByRole("button", { name: "Use system theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(row).getByRole("button", { name: "Use light theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(row).getByRole("button", { name: "Use dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("switch", { name: "Dark mode" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-appearance-dark"));
    expect(themeMocks.setPreference).toHaveBeenCalledWith("dark");
  });

  it("resets only Appearance preferences after confirmation", async () => {
    const user = userEvent.setup();
    const settings = useSettingsStore.getState();
    settings.setDockPlacement("right");
    settings.setLatexTools(true);
    themeMocks.preference = "light";
    writeThemeCustomization({ ...emptyThemeCustomization(), dark: { primary: "#00c7fc" } });

    render(<AppearanceSection />);

    await user.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent(appearance.sectionName);
    expect(useSettingsStore.getState().dockPlacement).toBe("right");

    await user.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    expect(useSettingsStore.getState()).toMatchObject({
      dockPlacement: "left",
      latexTools: true,
    });
    expect(localStorage.getItem("oleafly.dockPlacement")).toBe("left");
    expect(localStorage.getItem("oleafly.latexTools")).toBe("1");
    expect(themeMocks.setPreference).toHaveBeenCalledWith("system");
    expect(readThemeCustomization()).toEqual(emptyThemeCustomization());
    expect(themeMocks.applyTheme).toHaveBeenCalledWith("dark");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("marks Reset while the app theme is customized", () => {
    themeMocks.preference = "system";
    useSettingsStore.getState().resetAppearancePreferences();
    resetThemeCustomization();
    render(<AppearanceSection />);
    const reset = screen.getByRole("button", { name: "Reset to defaults" });
    expect(reset.querySelector('[data-testid="reset-changed-dot"]')).toBeNull();

    act(() => {
      writeThemeCustomization({ ...emptyThemeCustomization(), radius: "8px" });
    });
    expect(reset.querySelector('[data-testid="reset-changed-dot"]')).not.toBeNull();

    act(() => {
      resetThemeCustomization();
    });
    expect(reset.querySelector('[data-testid="reset-changed-dot"]')).toBeNull();
  });

  it("marks Reset while the theme is not the system default", () => {
    useSettingsStore.getState().resetAppearancePreferences();
    themeMocks.preference = "system";
    const { unmount } = render(<AppearanceSection />);
    expect(
      screen.getByRole("button", { name: "Reset to defaults" }),
    ).not.toHaveAccessibleDescription();
    unmount();

    themeMocks.preference = "dark";
    render(<AppearanceSection />);
    expect(
      screen.getByRole("button", { name: "Reset to defaults" }),
    ).toHaveAccessibleDescription(enSettings.reset.changed);
  });

  it("uses the shared file-management controls to add and remove patterns", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: appearance.tabs.files }));

    const homeView = screen.getByLabelText(appearance.files.homeView.label);
    expect(homeView).toHaveTextContent(appearance.files.homeView.grid);
    await user.click(homeView);
    await user.click(
      await screen.findByRole("option", { name: appearance.files.homeView.list }),
    );
    expect(useSettingsStore.getState().homeProjectLayout).toBe("list");

    await user.click(
      screen.getByRole("switch", { name: appearance.files.showTree.label }),
    );
    expect(useSettingsStore.getState().openInTree).toBe(true);

    const hiddenFiles = screen.getByTestId("hidden-files-toggle");
    expect(hiddenFiles).toHaveAttribute("aria-expanded", "false");
    expect(hiddenFiles).toHaveTextContent(appearance.files.hidden.title);
    expect(screen.queryByText("*.aux")).not.toBeInTheDocument();
    expect(screen.getByText(appearance.zen.fullScreen.label).compareDocumentPosition(hiddenFiles)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await user.click(hiddenFiles);
    expect(hiddenFiles).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("*.aux")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(appearance.files.hidden.inputAriaLabel), {
      target: { value: "*.generated.tex" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: appearance.files.hidden.addAriaLabel }),
    );
    expect(screen.getByText("*.generated.tex")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: fill(appearance.files.hidden.removeAriaLabel, {
          pattern: "*.generated.tex",
        }),
      }),
    );
    expect(screen.queryByText("*.generated.tex")).not.toBeInTheDocument();

    const patternInput = screen.getByLabelText(
      appearance.files.hidden.inputAriaLabel,
    );
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
    await user.click(screen.getByRole("tab", { name: appearance.tabs.terminal }));

    expect(
      screen.getByLabelText(appearance.terminal.fontSize.label),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.font.ariaLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.fontWeight.label),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.fontWeightBold.label),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.cursorStyle.ariaLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: appearance.terminal.cursorBlink.label }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: appearance.terminal.startWithProject.label,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.colorTheme.ariaLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.colors.backgroundAriaLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.colors.foregroundAriaLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(appearance.terminal.colors.cursorAriaLabel),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText(appearance.terminal.fontSize.label));
    await user.click(
      await screen.findByRole("option", {
        name: fill(appearance.fontSizeOption, { size: "16" }),
      }),
    );
    await user.click(
      screen.getByLabelText(appearance.terminal.cursorStyle.ariaLabel),
    );
    await user.click(
      await screen.findByRole("option", {
        name: appearance.terminal.cursorStyle.underline,
      }),
    );
    await user.click(
      screen.getByRole("switch", { name: appearance.terminal.cursorBlink.label }),
    );
    await user.click(
      screen.getByRole("switch", {
        name: appearance.terminal.startWithProject.label,
      }),
    );
    await user.click(
      screen.getByLabelText(appearance.terminal.colorTheme.ariaLabel),
    );
    await user.click(
      await screen.findByRole("option", {
        name: fill(appearance.terminal.colorTheme.optionLight, {
          name: TERMINAL_COLOR_THEMES.light.name,
        }),
      }),
    );
    fireEvent.change(
      screen.getByLabelText(appearance.terminal.colors.backgroundAriaLabel),
      { target: { value: "#f8f8f8" } },
    );

    expect(useSettingsStore.getState()).toMatchObject({
      terminalFontSize: 16,
      terminalCursorStyle: "underline",
      terminalCursorBlink: false,
      terminalStartWithProject: false,
      terminalColorTheme: "light",
      terminalBackground: "#f8f8f8",
    });
  });

});

describe("Shortcut settings", () => {
  it("lists the terminal toggle shortcut and no browser toggle", () => {
    render(<ShortcutsSection />);

    expect(screen.getByText("Toggle terminal")).toBeInTheDocument();
    expect(screen.queryByText("Toggle browser")).toBeNull();
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

  it("detects the editor's fixed Ctrl+Space binding on macOS", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const user = userEvent.setup();
      render(<ShortcutsSection />);
      await user.click(
        screen.getByRole("button", { name: /Edit Toggle terminal/u }),
      );
      fireEvent.keyDown(
        screen.getByRole("button", { name: /Recording Toggle terminal/u }),
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
