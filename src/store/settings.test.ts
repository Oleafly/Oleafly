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

    // The browser only opens when its experimental flag is on.
    useSettingsStore.getState().setWebBrowser(true);
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
  it("ai-only hides the whole workspace and shows only the assistant", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    const s = useSettingsStore.getState();
    expect(s.assistantOpen).toBe(true);
    expect(s.workspaceHidden).toBe(true);
  });

  it("every non-ai-only preset keeps the workspace visible", () => {
    for (const preset of [
      "editor-preview-ai",
      "editor-preview",
      "editor-ai",
      "preview-ai",
      "editor-only",
      "preview-only",
    ] as const) {
      useSettingsStore.getState().setLayoutPreset(preset);
      expect(useSettingsStore.getState().workspaceHidden).toBe(false);
    }
  });

  it("maps each preset to the right editor/preview/AI panes", () => {
    const expected: Record<string, { viewMode: string; ai: boolean }> = {
      "editor-preview-ai": { viewMode: "split", ai: true },
      "editor-preview": { viewMode: "split", ai: false },
      "editor-ai": { viewMode: "editor", ai: true },
      "preview-ai": { viewMode: "pdf", ai: true },
      "editor-only": { viewMode: "editor", ai: false },
      "preview-only": { viewMode: "pdf", ai: false },
    };
    for (const [preset, want] of Object.entries(expected)) {
      useSettingsStore.getState().setLayoutPreset(preset as never);
      const s = useSettingsStore.getState();
      expect(s.viewMode).toBe(want.viewMode);
      expect(s.assistantOpen).toBe(want.ai);
    }
  });

  it("does not touch the file tree: the tree is an independent surface", () => {
    useSettingsStore.setState({ showTree: true });
    useSettingsStore.getState().setLayoutPreset("editor-only");
    expect(useSettingsStore.getState().showTree).toBe(true);
    useSettingsStore.setState({ showTree: false });
    useSettingsStore.getState().setLayoutPreset("editor-preview-ai");
    expect(useSettingsStore.getState().showTree).toBe(false);
  });

  it("choosing a view mode reveals a hidden workspace", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    expect(useSettingsStore.getState().workspaceHidden).toBe(true);
    useSettingsStore.getState().setViewMode("split");
    expect(useSettingsStore.getState().workspaceHidden).toBe(false);
  });

  it("closing the assistant from ai-only restores the workspace", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    useSettingsStore.getState().setAssistantOpen(false);
    const s = useSettingsStore.getState();
    expect(s.assistantOpen).toBe(false);
    expect(s.workspaceHidden).toBe(false);
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

describe("useSettingsStore previewTyping", () => {
  it("defaults to off so clicks in the PDF stay a plain inverse search", () => {
    expect(useSettingsStore.getState().previewTyping).toBe(false);
  });

  it("setPreviewTyping updates state and persists the toggle", () => {
    useSettingsStore.getState().setPreviewTyping(true);
    expect(useSettingsStore.getState().previewTyping).toBe(true);
    expect(localStorage.getItem("oleafly.previewTyping")).toBe("1");

    useSettingsStore.getState().setPreviewTyping(false);
    expect(useSettingsStore.getState().previewTyping).toBe(false);
    expect(localStorage.getItem("oleafly.previewTyping")).toBe("0");
  });
});

describe("revealEditor", () => {
  it("reveals the workspace from the AI-only layout, keeping the view mode", () => {
    useSettingsStore.setState({ workspaceHidden: true, viewMode: "editor" });
    useSettingsStore.getState().revealEditor();
    expect(useSettingsStore.getState()).toMatchObject({
      workspaceHidden: false,
      viewMode: "editor",
    });
  });

  it("switches a preview-only view to a split so the editor is on screen", () => {
    useSettingsStore.setState({ workspaceHidden: false, viewMode: "pdf" });
    useSettingsStore.getState().revealEditor();
    expect(useSettingsStore.getState()).toMatchObject({
      workspaceHidden: false,
      viewMode: "split",
    });
  });

  it("is a no-op when the editor already shows", () => {
    useSettingsStore.setState({ workspaceHidden: false, viewMode: "split" });
    useSettingsStore.getState().revealEditor();
    expect(useSettingsStore.getState()).toMatchObject({
      workspaceHidden: false,
      viewMode: "split",
    });
  });
});
