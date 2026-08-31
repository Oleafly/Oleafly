import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_SEARCH_ENGINES,
  DEFAULT_HIDDEN_FILE_PATTERNS,
  fileTreePathIsHidden,
  useSettingsStore,
} from "./settings";

const lsValues = new Map<string, string>();

describe("browser search engine catalog", () => {
  it("maps every supported engine to its search URL", () => {
    expect(BROWSER_SEARCH_ENGINES).toEqual([
      {
        id: "google",
        name: "Google",
        searchUrl: "https://www.google.com/search?q=",
      },
      {
        id: "bing",
        name: "Bing",
        searchUrl: "https://www.bing.com/search?q=",
      },
      {
        id: "duckduckgo",
        name: "DuckDuckGo",
        searchUrl: "https://duckduckgo.com/?q=",
      },
      {
        id: "brave",
        name: "Brave",
        searchUrl: "https://search.brave.com/search?q=",
      },
      {
        id: "perplexity",
        name: "Perplexity",
        searchUrl: "https://www.perplexity.ai/search?s=o&q=",
      },
      {
        id: "startpage",
        name: "Startpage",
        searchUrl: "https://www.startpage.com/sp/search?query=",
      },
      {
        id: "ecosia",
        name: "Ecosia",
        searchUrl: "https://www.ecosia.org/search?q=",
      },
    ]);
  });
});

describe("useSettingsStore dock appearance settings", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", {
      clear: () => lsValues.clear(),
      getItem: (key: string) => lsValues.get(key) ?? null,
      setItem: (key: string, value: string) => lsValues.set(key, value),
      removeItem: (key: string) => lsValues.delete(key),
    });
  });

  beforeEach(() => {
    lsValues.clear();
  });

  it("defaults dockPlacement to left", () => {
    expect(useSettingsStore.getState().dockPlacement).toBe("left");
  });

  it("rejects the removed top-level MCP settings section", () => {
    useSettingsStore.setState({ settingsInitialSection: "general" });

    useSettingsStore.getState().setSettingsInitialSection("mcp");

    expect(useSettingsStore.getState().settingsInitialSection).toBe("general");
  });

  it("setDockPlacement updates state and persists to localStorage", () => {
    useSettingsStore.getState().setDockPlacement("bottom");
    expect(useSettingsStore.getState().dockPlacement).toBe("bottom");
    expect(localStorage.getItem("oleafly.dockPlacement")).toBe("bottom");
    useSettingsStore.getState().setDockPlacement("left");
  });

  it("keeps docks closed by default and does not persist their open state", () => {
    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: false,
      browserOpen: false,
    });

    useSettingsStore.getState().setTerminalOpen(true);
    useSettingsStore.getState().setBrowserOpen(true);

    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: true,
      browserOpen: true,
    });
    expect(localStorage.getItem("oleafly.dock.terminalOpen")).toBeNull();
    expect(localStorage.getItem("oleafly.dock.browserOpen")).toBeNull();

    useSettingsStore.getState().closeDocks();
    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: false,
      browserOpen: false,
    });

    useSettingsStore.getState().resetToDefaults();

    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: false,
      browserOpen: false,
    });
    expect(localStorage.getItem("oleafly.dock.terminalOpen")).toBeNull();
    expect(localStorage.getItem("oleafly.dock.browserOpen")).toBeNull();
  });

  it("defaults terminal appearance and browser preferences", () => {
    useSettingsStore.getState().resetToDefaults();

    expect(useSettingsStore.getState()).toMatchObject({
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

  it("persists terminal appearance and browser preferences", () => {
    const settings = useSettingsStore.getState();
    expect(typeof settings.setTerminalFontSize).toBe("function");
    expect(typeof settings.setBrowserSearchEngine).toBe("function");

    settings.setTerminalFontSize(16);
    settings.setTerminalFontFamily("JetBrains Mono");
    settings.setTerminalFontWeight(600);
    settings.setTerminalFontWeightBold(800);
    settings.setTerminalCursorStyle("bar");
    settings.setTerminalCursorBlink(false);
    settings.setTerminalColorTheme("light");
    settings.setTerminalBackground("#f8f8f8");
    settings.setTerminalForeground("#202124");
    settings.setTerminalCursorColor("#111111");
    settings.setBrowserSearchEngine("duckduckgo");
    settings.setBrowserHomePage("https://example.com/");

    expect(useSettingsStore.getState()).toMatchObject({
      terminalFontSize: 16,
      terminalFontFamily: "JetBrains Mono",
      terminalFontWeight: 600,
      terminalFontWeightBold: 800,
      terminalCursorStyle: "bar",
      terminalCursorBlink: false,
      terminalColorTheme: "light",
      terminalBackground: "#f8f8f8",
      terminalForeground: "#202124",
      terminalCursorColor: "#111111",
      browserSearchEngine: "duckduckgo",
      browserHomePage: "https://example.com/",
    });
    expect(localStorage.getItem("oleafly.terminal.fontSize")).toBe("16");
    expect(localStorage.getItem("oleafly.terminal.fontFamily")).toBe(
      "JetBrains Mono",
    );
    expect(localStorage.getItem("oleafly.terminal.fontWeight")).toBe("600");
    expect(localStorage.getItem("oleafly.terminal.fontWeightBold")).toBe("800");
    expect(localStorage.getItem("oleafly.terminal.cursorStyle")).toBe("bar");
    expect(localStorage.getItem("oleafly.terminal.cursorBlink")).toBe("0");
    expect(localStorage.getItem("oleafly.terminal.colorTheme")).toBe("light");
    expect(localStorage.getItem("oleafly.terminal.background")).toBe("#f8f8f8");
    expect(localStorage.getItem("oleafly.terminal.foreground")).toBe("#202124");
    expect(localStorage.getItem("oleafly.terminal.cursorColor")).toBe("#111111");
    expect(localStorage.getItem("oleafly.browser.searchEngine")).toBe(
      "duckduckgo",
    );
    expect(localStorage.getItem("oleafly.browser.homePage")).toBe(
      "https://example.com/",
    );
  });

  it("loads safe defaults for malformed terminal and browser preferences", async () => {
    localStorage.setItem("oleafly.terminal.fontSize", "huge");
    localStorage.setItem("oleafly.terminal.fontWeight", "950");
    localStorage.setItem("oleafly.terminal.fontWeightBold", "0");
    localStorage.setItem("oleafly.terminal.cursorStyle", "beam");
    localStorage.setItem("oleafly.terminal.colorTheme", "neon");
    localStorage.setItem("oleafly.terminal.background", "black");
    localStorage.setItem("oleafly.terminal.foreground", "#12");
    localStorage.setItem("oleafly.terminal.cursorColor", "#12345g");
    localStorage.setItem("oleafly.browser.searchEngine", "unknown");
    localStorage.setItem("oleafly.browser.homePage", "file:///etc/passwd");
    vi.resetModules();

    const { useSettingsStore: loadedStore } = await import("./settings");

    expect(loadedStore.getState()).toMatchObject({
      terminalFontSize: 14,
      terminalFontWeight: 500,
      terminalFontWeightBold: 700,
      terminalCursorStyle: "block",
      terminalColorTheme: "dark",
      terminalBackground: "#1e1e1e",
      terminalForeground: "#f2f2f2",
      terminalCursorColor: "#ffffff",
      browserSearchEngine: "google",
      browserHomePage: "https://www.google.com/",
    });
  });

  it("loads the selected preset colors when custom colors are absent", async () => {
    localStorage.setItem("oleafly.terminal.colorTheme", "light");
    vi.resetModules();

    const { useSettingsStore: loadedStore } = await import("./settings");

    expect(loadedStore.getState()).toMatchObject({
      terminalColorTheme: "light",
      terminalBackground: "#ffffff",
      terminalForeground: "#1f2328",
      terminalCursorColor: "#1f2328",
    });
  });
});

describe("useSettingsStore layout presets", () => {
  it("ai-only opens the assistant panel beside a bare editor", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    const s = useSettingsStore.getState();
    expect(s.assistantOpen).toBe(true);
    expect(s.showTree).toBe(false);
    expect(s.viewMode).toBe("editor");
    expect(s.hideEditorArea).toBe(false);
  });

  it("switching away from ai-only closes the assistant panel", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    expect(useSettingsStore.getState().assistantOpen).toBe(true);
    useSettingsStore.getState().setLayoutPreset("editor-preview");
    expect(useSettingsStore.getState().assistantOpen).toBe(false);
  });
});

describe("useSettingsStore reset", () => {
  it("restores and persists every editor-behavior default", () => {
    const settings = useSettingsStore.getState();
    settings.setEditorAutocomplete(false);
    settings.setEditorAutoCloseBrackets(false);
    settings.setEditorGhostCompletion(false);
    settings.setEditorNonBlinkingCursor(true);

    settings.resetToDefaults();

    expect(useSettingsStore.getState()).toMatchObject({
      editorAutocomplete: true,
      editorAutoCloseBrackets: true,
      editorGhostCompletion: true,
      editorNonBlinkingCursor: false,
    });
    expect(localStorage.getItem("oleafly.editor.autocomplete")).toBe("1");
    expect(localStorage.getItem("oleafly.editor.closeBrackets")).toBe("1");
    expect(localStorage.getItem("oleafly.editor.ghostCompletion")).toBe("1");
    expect(localStorage.getItem("oleafly.editor.solidCursor")).toBe("0");
  });
});

describe("file tree visibility settings", () => {
  it("matches generated files and hidden folders at any path depth", () => {
    expect(fileTreePathIsHidden("paper.aux", DEFAULT_HIDDEN_FILE_PATTERNS)).toBe(true);
    expect(fileTreePathIsHidden("build/paper.run.xml", DEFAULT_HIDDEN_FILE_PATTERNS)).toBe(true);
    expect(fileTreePathIsHidden("chapters/.git/config", DEFAULT_HIDDEN_FILE_PATTERNS)).toBe(true);
    expect(fileTreePathIsHidden("chapters/results.tex", DEFAULT_HIDDEN_FILE_PATTERNS)).toBe(false);
  });

  it("supports custom wildcard and path patterns", () => {
    expect(fileTreePathIsHidden("figures/draft-2.png", ["draft-?.png"])).toBe(true);
    expect(fileTreePathIsHidden("generated/cache/data.json", ["generated/*"])).toBe(true);
    expect(fileTreePathIsHidden("src/generated/cache.ts", ["generated/*"])).toBe(false);
  });

  it("adds, removes, and persists custom patterns", () => {
    const settings = useSettingsStore.getState();
    settings.resetToDefaults();
    settings.addHiddenFilePattern("*.generated.tex");
    settings.addHiddenFilePattern("*.generated.tex");

    expect(useSettingsStore.getState().hiddenFilePatterns).toContain("*.generated.tex");
    expect(
      useSettingsStore.getState().hiddenFilePatterns.filter(
        (pattern) => pattern === "*.generated.tex",
      ),
    ).toHaveLength(1);
    expect(localStorage.getItem("oleafly.fileTree.hiddenPatterns")).toContain(
      "*.generated.tex",
    );

    settings.removeHiddenFilePattern("*.generated.tex");
    expect(useSettingsStore.getState().hiddenFilePatterns).not.toContain(
      "*.generated.tex",
    );
  });
});
