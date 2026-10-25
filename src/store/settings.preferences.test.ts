import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HIDDEN_FILE_PATTERNS,
  DEFAULT_TERMINAL_FONT_FAMILY,
  TERMINAL_COLOR_THEMES,
  fileTreePathIsHidden,
  layoutPresetViewMode,
  readDictionaryLocale,
  resolveTerminalColorTheme,
  resolveTerminalTheme,
  type TerminalColorThemeId,
  useSettingsStore,
  withTerminalGlyphFallbacks,
} from "./settings";

async function reload(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  vi.resetModules();
  return (await import("./settings")).useSettingsStore.getState();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("on/off preferences", () => {
  type Settings = ReturnType<typeof useSettingsStore.getState>;
  const toggles: Array<[keyof Settings, keyof Settings, string]> = [
    ["setEditorLineWrap", "editorLineWrap", "oleafly.editor.lineWrap"],
    ["setEditorAutocomplete", "editorAutocomplete", "oleafly.editor.autocomplete"],
    ["setEditorAutoCloseBrackets", "editorAutoCloseBrackets", "oleafly.editor.closeBrackets"],
    ["setEditorGhostCompletion", "editorGhostCompletion", "oleafly.editor.ghostCompletion"],
    ["setTypstFormatOnSave", "typstFormatOnSave", "oleafly.typst.formatOnSave"],
    ["setHarper", "harper", "oleafly.harper"],
    ["setShowRegionalism", "showRegionalism", "oleafly.harper.regionalism"],
    ["setShowWordChoice", "showWordChoice", "oleafly.harper.wordchoice"],
    ["setChatFloating", "chatFloating", "oleafly.ai.floating"],
    ["setLatexTools", "latexTools", "oleafly.latexTools"],
    ["setLiveCollaboration", "liveCollaboration", "oleafly.liveCollaboration"],
    ["setEditorAutoCloseMath", "editorAutoCloseMath", "oleafly.editor.closeMath"],
    ["setEditorAutoCloseEnvironments", "editorAutoCloseEnvironments", "oleafly.editor.closeEnvironments"],
    ["setEditorStickyScroll", "editorStickyScroll", "oleafly.editor.stickyScroll"],
    ["setEditorMathPreview", "editorMathPreview", "oleafly.editor.mathPreview"],
    ["setTypstInlayHints", "typstInlayHints", "oleafly.typst.inlayHints"],
    ["setTypstLint", "typstLint", "oleafly.typst.lint"],
    ["setHoverPreview", "hoverPreview", "oleafly.hoverPreview"],
    ["setTerminalCursorBlink", "terminalCursorBlink", "oleafly.terminal.cursorBlink"],
    ["setTerminalStartWithProject", "terminalStartWithProject", "oleafly.terminal.startWithProject"],
    ["setOpenInTree", "openInTree", "oleafly.openInTree"],
    ["setPdfDarkMode", "pdfDarkMode", "oleafly.pdf.darkMode"],
    ["setEditorUsesAppFont", "editorUsesAppFont", "oleafly.editor.useAppFont"],
  ];

  it.each(toggles)("%s saves both states", (setter, field, key) => {
    const set = useSettingsStore.getState()[setter] as (value: boolean) => void;

    set(true);
    expect(useSettingsStore.getState()[field]).toBe(true);
    expect(localStorage.getItem(key)).toBe("1");

    set(false);
    expect(useSettingsStore.getState()[field]).toBe(false);
    expect(localStorage.getItem(key)).toBe("0");
  });

  it("toggles spellcheck both ways", () => {
    const initial = useSettingsStore.getState().spellcheck;

    useSettingsStore.getState().toggleSpellcheck();
    expect(localStorage.getItem("oleafly.spellcheck")).toBe(initial ? "0" : "1");

    useSettingsStore.getState().toggleSpellcheck();
    expect(localStorage.getItem("oleafly.spellcheck")).toBe(initial ? "1" : "0");
    expect(useSettingsStore.getState().spellcheck).toBe(initial);
  });

  it("has no setting that hides this person from collaborators, even with an old choice saved", async () => {
    const settings = await reload({ "oleafly.collab.presence": "hidden" });
    expect("collabPresence" in settings).toBe(false);
  });

  it("keeps live collaboration off on a new install", async () => {
    const fresh = await reload({});
    expect(fresh.liveCollaboration).toBe(false);
    const on = await reload({ "oleafly.liveCollaboration": "1" });
    expect(on.liveCollaboration).toBe(true);
  });
});

describe("value preferences", () => {
  it("accepts only the offered Typst formatter widths and indents", () => {
    const settings = useSettingsStore.getState();

    settings.setTypstFormatterLineWidth(80);
    settings.setTypstFormatterIndent(4);
    expect(useSettingsStore.getState()).toMatchObject({ typstFormatterLineWidth: 80, typstFormatterIndent: 4 });
    expect(localStorage.getItem("oleafly.typst.formatterLineWidth")).toBe("80");

    settings.setTypstFormatterLineWidth(75);
    settings.setTypstFormatterIndent(3);
    expect(useSettingsStore.getState()).toMatchObject({ typstFormatterLineWidth: 120, typstFormatterIndent: 2 });
    expect(localStorage.getItem("oleafly.typst.formatterIndent")).toBe("2");
  });

  it("saves fonts, sizes and the default layout", () => {
    const settings = useSettingsStore.getState();

    settings.setEditorFontSize(15);
    settings.setAppFontSize(18);
    settings.setAppFontFamily("Inter");
    settings.setEditorFontFamily("Fira Code");
    settings.setDefaultView("editor-preview-ai");
    settings.setDefaultLatexEngine("latexmk");

    expect(useSettingsStore.getState()).toMatchObject({
      editorFontSize: 15,
      appFontSize: 18,
      appFontFamily: "Inter",
      editorFontFamily: "Fira Code",
      defaultView: "editor-preview-ai",
      defaultLatexEngine: "latexmk",
    });
    expect(localStorage.getItem("oleafly.fontSize")).toBe("15");
    expect(localStorage.getItem("oleafly.appFontSize")).toBe("18");
    expect(localStorage.getItem("oleafly.appFont")).toBe("Inter");
    expect(localStorage.getItem("oleafly.editorFont")).toBe("Fira Code");
    expect(localStorage.getItem("oleafly.defaultView")).toBe("editor-preview-ai");
  });

  it("saves the dictionary language and appearance choices", () => {
    const settings = useSettingsStore.getState();

    settings.setDictionaryLocale("en-GB");
    settings.setEditorTheme("dark", "dracula");
    settings.setEditorTheme("light", "paper");
    settings.setAccentColor("#db2777");
    settings.setBgPattern("grid");
    settings.setHomeProjectLayout("list");

    expect(useSettingsStore.getState()).toMatchObject({
      dictionaryLocale: "en_GB",
      editorThemeDark: "dracula",
      editorThemeLight: "paper",
      accentColor: "#db2777",
      bgPattern: "grid",
      homeProjectLayout: "list",
    });
    expect(localStorage.getItem("oleafly.dictionary.locale")).toBe("en_GB");
    expect(localStorage.getItem("oleafly.editorTheme.dark")).toBe("dracula");
    expect(localStorage.getItem("oleafly.editorTheme.light")).toBe("paper");
    expect(localStorage.getItem("oleafly.accent")).toBe("#db2777");
    expect(localStorage.getItem("oleafly.bgPattern")).toBe("grid");
    expect(localStorage.getItem("oleafly.library.projectLayout")).toBe("list");
  });

  it("opens settings at a section and tab", () => {
    useSettingsStore.getState().openSettingsAt("appearance", "terminal");

    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "appearance",
      settingsInitialAppearanceTab: "terminal",
    });
    useSettingsStore.getState().setSettingsOpen(false);
  });

  it("uses the default terminal font for a blank family", () => {
    useSettingsStore.getState().setTerminalFontFamily("   ");

    expect(useSettingsStore.getState().terminalFontFamily).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });

  it("normalizes grammar dialects", () => {
    const settings = useSettingsStore.getState();

    settings.setGrammarDialect("klingon" as never);
    expect(useSettingsStore.getState().grammarDialect).toBe("american");
    settings.setGrammarDialect("british");
    expect(localStorage.getItem("oleafly.harper.dialect")).toBe("british");
  });

  it("ignores blank or repeated hidden-file patterns", () => {
    const before = useSettingsStore.getState().hiddenFilePatterns;

    useSettingsStore.getState().addHiddenFilePattern("   ");
    useSettingsStore.getState().addHiddenFilePattern(before[0]);

    expect(useSettingsStore.getState().hiddenFilePatterns).toBe(before);
  });

  it("keeps simple view toggles in memory", () => {
    const settings = useSettingsStore.getState();

    settings.setSettingsInitialAppearanceTab("editor");
    settings.setShowTree(false);

    expect(useSettingsStore.getState()).toMatchObject({ settingsInitialAppearanceTab: "editor", showTree: false });
    settings.setShowTree(true);
  });
});

describe("loading saved preferences", () => {
  it("maps legacy view modes onto layout presets", async () => {
    expect((await reload({ "oleafly.defaultView": "split" })).defaultView).toBe("editor-preview");
    expect((await reload({ "oleafly.defaultView": "pdf" })).defaultView).toBe("preview-only");
    expect((await reload({ "oleafly.defaultView": "mystery" })).defaultView).toBe("editor-only");
    expect((await reload({ "oleafly.defaultView": "preview-ai" })).defaultView).toBe("preview-ai");
  });

  it("falls back to defaults for unusable stored values", async () => {
    const state = await reload({
      "oleafly.fontSize": "big",
      "oleafly.appFontSize": "0",
      "oleafly.editorTheme": "neon",
      "oleafly.editor.colors": "{\"nord\":{\"heading\":\"#FF0000\",\"math\":\"#12345\",\"title\":\"#123456\"},\"neon\":{\"math\":\"#123456\"}}",
      "oleafly.dockPlacement": "",
      "oleafly.bgPattern": "",
      "oleafly.defaultLatexEngine": "pdflatex",
      "oleafly.typst.formatterLineWidth": "70",
    });

    expect(state).toMatchObject({
      editorFontSize: 13,
      appFontSize: 16,
      editorThemeLight: "system",
      editorThemeDark: "system",
      editorColors: { nord: { heading: "#ff0000" } },
      dockPlacement: "left",
      bgPattern: "dots",
      defaultLatexEngine: "tectonic",
      typstFormatterLineWidth: 120,
    });
  });

  it("restores valid stored choices", async () => {
    const state = await reload({
      "oleafly.editorTheme": "nord",
      "oleafly.editorTheme.light": "one-light",
      "oleafly.editor.colors": "{\"system-dark\":{\"comment\":\"#AABBCC\"}}",
      "oleafly.library.projectLayout": "list",
      "oleafly.defaultLatexEngine": "latexmk",
      "oleafly.typst.formatterIndent": "8",
      "oleafly.terminal.colorTheme": "dark",
    });

    expect(state).toMatchObject({
      editorThemeLight: "one-light",
      editorThemeDark: "nord",
      editorColors: { "system-dark": { comment: "#aabbcc" } },
      homeProjectLayout: "list",
      defaultLatexEngine: "latexmk",
      typstFormatterIndent: 8,
      terminalColorTheme: "dark",
    });
  });

  it("restores hidden-file patterns, cleaning up blanks and repeats", async () => {
    expect(
      (await reload({ "oleafly.fileTree.hiddenPatterns": JSON.stringify([" *.log ", "*.log", "", 4, "build"]) }))
        .hiddenFilePatterns,
    ).toEqual(["*.log", "build"]);
    expect(
      (await reload({ "oleafly.fileTree.hiddenPatterns": JSON.stringify({ not: "a list" }) })).hiddenFilePatterns,
    ).toEqual([...DEFAULT_HIDDEN_FILE_PATTERNS]);
    expect((await reload({ "oleafly.fileTree.hiddenPatterns": "{broken" })).hiddenFilePatterns).toEqual([
      ...DEFAULT_HIDDEN_FILE_PATTERNS,
    ]);
  });

  it("starts from defaults when local storage cannot be read", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    const state = await reload({});

    expect(state).toMatchObject({ editorFontSize: 13, dockPlacement: "left", defaultView: "editor-only" });
  });
});

describe("preference helpers", () => {
  it("maps every layout preset to the view mode it shows", () => {
    expect(layoutPresetViewMode("editor-preview-ai")).toBe("split");
    expect(layoutPresetViewMode("editor-preview")).toBe("split");
    expect(layoutPresetViewMode("editor-ai")).toBe("editor");
    expect(layoutPresetViewMode("editor-only")).toBe("editor");
    expect(layoutPresetViewMode("ai-only")).toBe("editor");
    expect(layoutPresetViewMode("preview-ai")).toBe("pdf");
    expect(layoutPresetViewMode("preview-only")).toBe("pdf");
  });

  it("normalizes dictionary locale ids", () => {
    expect(readDictionaryLocale(" de-DE ")).toBe("de_DE");
    expect(readDictionaryLocale("fr")).toBe("fr");
    expect(readDictionaryLocale("not a locale")).toBe("en_US");
  });

  it("applies custom terminal colors only to a fixed palette", () => {
    const overrides = {
      terminalBackground: "#000001",
      terminalForeground: "#000002",
      terminalCursorColor: "#000003",
    };

    expect(resolveTerminalTheme({ terminalColorTheme: "system", ...overrides }, "dark")).toEqual(
      TERMINAL_COLOR_THEMES.dark.colors,
    );
    expect(resolveTerminalTheme({ terminalColorTheme: "light", ...overrides }, "dark")).toMatchObject({
      background: "#000001",
      foreground: "#000002",
      cursor: "#000003",
    });
  });

  it("falls back to the app theme palette for an unknown palette id", () => {
    expect(resolveTerminalColorTheme("retired" as TerminalColorThemeId, "light")).toBe(TERMINAL_COLOR_THEMES.light);
  });

  it("adds glyph fallbacks after a family that has no generic fallback", () => {
    expect(withTerminalGlyphFallbacks("Menlo")).toMatch(/^Menlo, .*Nerd Font.*, monospace$/u);
  });

  it("ignores blank hidden-file patterns when matching", () => {
    expect(fileTreePathIsHidden("notes/todo.txt", ["  ", "*.txt"])).toBe(true);
    expect(fileTreePathIsHidden("notes/todo.md", ["  "])).toBe(false);
  });
});

describe("terminal behavior preferences", () => {
  it("starts with the defaults on a new install", async () => {
    const fresh = await reload({});
    expect(fresh).toMatchObject({
      terminalShell: "auto",
      terminalShellPath: "",
      terminalShiftEnter: "newline",
      terminalCopyOnSelect: false,
      terminalOptionIsMeta: false,
      terminalScrollback: 5000,
      terminalConfirmClose: true,
    });
  });

  it("reads saved values and replaces values it does not know", async () => {
    const saved = await reload({
      "oleafly.terminal.shell": "wsl",
      "oleafly.terminal.shellPath": "  C:\\Tools\\nu.exe ",
      "oleafly.terminal.shiftEnter": "enter",
      "oleafly.terminal.copyOnSelect": "1",
      "oleafly.terminal.optionIsMeta": "1",
      "oleafly.terminal.scrollback": "25000",
      "oleafly.terminal.confirmClose": "0",
    });
    expect(saved).toMatchObject({
      terminalShell: "wsl",
      terminalShellPath: "C:\\Tools\\nu.exe",
      terminalShiftEnter: "enter",
      terminalCopyOnSelect: true,
      terminalOptionIsMeta: true,
      terminalScrollback: 25000,
      terminalConfirmClose: false,
    });
    const odd = await reload({
      "oleafly.terminal.shell": "fish",
      "oleafly.terminal.shiftEnter": "tab",
      "oleafly.terminal.scrollback": "7000",
    });
    expect(odd).toMatchObject({ terminalShell: "auto", terminalShiftEnter: "newline", terminalScrollback: 5000 });
  });

  it("saves each terminal setting in the format a reset restores", () => {
    const settings = useSettingsStore.getState();
    settings.setTerminalShell("gitBash");
    settings.setTerminalShellPath(`  ${"x".repeat(2000)}`);
    settings.setTerminalShiftEnter("enter");
    settings.setTerminalScrollback(100000);
    settings.setTerminalConfirmClose(false);
    expect(localStorage.getItem("oleafly.terminal.shell")).toBe("gitBash");
    expect(useSettingsStore.getState().terminalShellPath).toHaveLength(1024);
    expect(localStorage.getItem("oleafly.terminal.shiftEnter")).toBe("enter");
    expect(localStorage.getItem("oleafly.terminal.scrollback")).toBe("100000");
    expect(localStorage.getItem("oleafly.terminal.confirmClose")).toBe("0");

    settings.setTerminalScrollback(123);
    expect(useSettingsStore.getState().terminalScrollback).toBe(5000);
    settings.setTerminalShell("bogus" as never);
    expect(useSettingsStore.getState().terminalShell).toBe("auto");
  });
});
