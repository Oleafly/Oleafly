import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HIDDEN_FILE_PATTERNS,
  fileTreePathIsHidden,
  useSettingsStore,
} from "./settings";

const lsValues = new Map<string, string>();

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

  it("setDockPlacement updates state and persists to localStorage", () => {
    useSettingsStore.getState().setDockPlacement("bottom");
    expect(useSettingsStore.getState().dockPlacement).toBe("bottom");
    expect(localStorage.getItem("oleafly.dockPlacement")).toBe("bottom");
    useSettingsStore.getState().setDockPlacement("left");
  });
});

describe("useSettingsStore layout presets", () => {
  it("ai-only hides the editor area and shows the AI rail", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    const s = useSettingsStore.getState();
    expect(s.hideEditorArea).toBe(true);
    expect(s.showTree).toBe(true);
    expect(s.railTab).toBe("ai");
  });

  it("switching away from ai-only clears hideEditorArea", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    expect(useSettingsStore.getState().hideEditorArea).toBe(true);
    useSettingsStore.getState().setLayoutPreset("editor-preview");
    expect(useSettingsStore.getState().hideEditorArea).toBe(false);
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
