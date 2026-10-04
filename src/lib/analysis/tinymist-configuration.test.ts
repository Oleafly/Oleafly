import { afterEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  absoluteProjectPath,
  languageServiceStartupKey,
  settingsStoreLanguageServiceSettings,
  tinymistConfiguration,
} from "./tinymist-configuration";

describe("tinymistConfiguration", () => {
  it("keeps the base options and lets the editor settings win", () => {
    expect(
      tinymistConfiguration(
        { formatterMode: "disable", outputPath: "$root/out" },
        { ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS, lint: true },
      ),
    ).toEqual({
      formatterMode: "typstyle",
      outputPath: "$root/out",
      formatterPrintWidth: 120,
      formatterIndentSize: 2,
      lint: { enabled: true, when: "onSave" },
    });
  });

  it("starts from nothing when there is no base", () => {
    expect(tinymistConfiguration(null, DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS)).toEqual({
      formatterMode: "typstyle",
      formatterPrintWidth: 120,
      formatterIndentSize: 2,
      lint: { enabled: false, when: "onSave" },
    });
  });
});

describe("languageServiceStartupKey", () => {
  it("encodes lint and fonts for Tinymist only", () => {
    const lint = { ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS, lint: true };
    expect(languageServiceStartupKey("tinymist", lint)).toBe("lint:1");
    expect(languageServiceStartupKey("tinymist", { ...lint, fontPaths: ["/f"], systemFonts: false })).toBe(
      "lint:1|fonts:0:/f",
    );
    expect(languageServiceStartupKey("texlab", lint)).toBe("");
  });
});

describe("absoluteProjectPath", () => {
  it("drops every trailing separator from the root", () => {
    expect(absoluteProjectPath("/a/b///", "main.typ")).toBe("/a/b/main.typ");
    expect(absoluteProjectPath("C:\\Papers\\/\\", "src/main.typ")).toBe("C:\\Papers\\src\\main.typ");
    expect(absoluteProjectPath("\\\\server\\share\\", "/a\\b.typ")).toBe("\\\\server\\share\\a\\b.typ");
    expect(absoluteProjectPath("/", "main.typ")).toBe("/main.typ");
    expect(absoluteProjectPath("", "main.typ")).toBe("/main.typ");
  });

  it("splits the relative path on either separator", () => {
    expect(absoluteProjectPath("/a", "//src\\\\ch/one.typ")).toBe("/a/src/ch/one.typ");
  });
});

describe("settingsStoreLanguageServiceSettings", () => {
  const initialSettings = useSettingsStore.getState();

  afterEach(() => {
    useSettingsStore.setState(initialSettings, true);
    useFilesStore.setState({ engine: LATEX_ENGINE });
  });

  it("reads the Typst editor settings and reports only their changes", () => {
    const listener = vi.fn();
    const stop = settingsStoreLanguageServiceSettings.subscribe(listener);

    useSettingsStore.setState({ typstLint: !initialSettings.typstLint });
    useSettingsStore.setState({ typstFormatterLineWidth: 80 });
    useSettingsStore.setState({ typstFormatterIndent: 4 });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(settingsStoreLanguageServiceSettings.get()).toEqual({
      formatterPrintWidth: 80,
      formatterIndentSize: 4,
      lint: !initialSettings.typstLint,
    });

    useSettingsStore.setState({
      typstInlayHints: !initialSettings.typstInlayHints,
    });
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    useSettingsStore.setState({ typstLint: initialSettings.typstLint });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("adds no font settings for a Typst engine that reports no options", () => {
    useFilesStore.setState({
      engine: {
        ...LATEX_ENGINE,
        id: "typst",
        source_format: "typst",
        typst_options: undefined,
      },
    });
    const settings = settingsStoreLanguageServiceSettings.get();
    expect(settings).not.toHaveProperty("fontPaths");
    expect(settings).not.toHaveProperty("systemFonts");
  });
});
