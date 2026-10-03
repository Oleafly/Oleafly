import { afterEach, describe, expect, it, vi } from "vitest";
import { getLanguageServiceRuntimeProfile, LanguageServiceClient } from "@/lib/language-service";
import { createProjectAnalysisStore } from "@/store/project-analysis";
import { useFilesStore } from "@/store/files";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { LanguageServiceController, type LanguageServiceProjectSnapshot } from "./language-service-controller";
import { FakeTinymistTransport } from "./fake-tinymist-transport";
import {
  DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  languageServiceStartupKey,
  settingsStoreLanguageServiceSettings,
  tinymistConfiguration,
  typstFontSettings,
  type LanguageServiceSettingsSource,
  type TypstLanguageServiceSettings,
} from "./tinymist-configuration";

const controllers: LanguageServiceController[] = [];

afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  useFilesStore.setState({ engine: LATEX_ENGINE });
});

function fixedSettings(settings: TypstLanguageServiceSettings): LanguageServiceSettingsSource {
  return { get: () => settings, subscribe: () => () => {} };
}

function snapshot(): LanguageServiceProjectSnapshot {
  const files = { "main.typ": { content: "= Title\n" } };
  return {
    projectId: "project-typst",
    engineId: "typst",
    engineLoaded: true,
    mainDoc: "main.typ",
    tree: [{ path: "main.typ", is_dir: false }],
    files,
    indexTexts: {},
    index: null,
  };
}

function controllerWith(settings: TypstLanguageServiceSettings) {
  const transport = new FakeTinymistTransport();
  const controller = new LanguageServiceController({
    store: createProjectAnalysisStore(),
    isAvailable: () => true,
    provisioner: {
      installStatus: async (kind) => ({
        kind,
        version: getLanguageServiceRuntimeProfile(kind).version,
        state: "installed",
      }),
      install: async (kind) => ({
        kind,
        version: getLanguageServiceRuntimeProfile(kind).version,
        state: "already_installed",
      }),
    },
    createClient: (kind, projectId) => new LanguageServiceClient({ transport, kind, projectId }),
    settings: fixedSettings(settings),
  });
  controllers.push(controller);
  return { controller, transport };
}

const typstOptions = (over: Partial<{ font_dirs: string[]; system_fonts: boolean; reproducible: boolean }> = {}) => ({
  system_fonts: true,
  reproducible: false,
  variants: [],
  font_dirs: [] as string[],
  flags: [],
  output_formats: ["pdf"],
  pdf_standards: [],
  ...over,
});

describe("Tinymist fonts", () => {
  it("starts Tinymist with the project's font folders and the system font setting", async () => {
    const { controller, transport } = controllerWith({
      ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
      fontPaths: ["/p/fonts", "/p/assets/type"],
      systemFonts: false,
    });
    controller.update(snapshot());
    await controller.whenIdle();
    const [initialize] = transport.methods("initialize");
    expect((initialize.params as { initializationOptions: Record<string, unknown> }).initializationOptions).toMatchObject({
      fontPaths: ["/p/fonts", "/p/assets/type"],
      systemFonts: false,
    });
  });

  it("adds nothing when the project uses the defaults", () => {
    const config = tinymistConfiguration(null, DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS);
    expect(config).not.toHaveProperty("fontPaths");
    expect(config).not.toHaveProperty("systemFonts");
    expect(languageServiceStartupKey("tinymist", DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS)).toBe("lint:0");
  });

  it("restarts Tinymist when the font setup changes", () => {
    const withFonts = { ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS, fontPaths: ["/p/fonts"] };
    const noSystem = { ...withFonts, systemFonts: false };
    const keys = new Set([
      languageServiceStartupKey("tinymist", DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS),
      languageServiceStartupKey("tinymist", withFonts),
      languageServiceStartupKey("tinymist", noSystem),
    ]);
    expect(keys.size).toBe(3);
    expect(languageServiceStartupKey("texlab", noSystem)).toBe("");
  });

  it("reads the font setup the backend reported for the open Typst project", () => {
    expect(typstFontSettings(null)).toEqual({});
    expect(typstFontSettings(typstOptions())).toEqual({});
    expect(typstFontSettings(typstOptions({ font_dirs: ["/p/fonts"] }))).toEqual({ fontPaths: ["/p/fonts"] });
    expect(typstFontSettings(typstOptions({ reproducible: true }))).toEqual({ systemFonts: false });
    expect(typstFontSettings(typstOptions({ system_fonts: false }))).toEqual({ systemFonts: false });
  });

  it("follows the files store and tells the controller when fonts change", () => {
    const listener = vi.fn();
    const stop = settingsStoreLanguageServiceSettings.subscribe(listener);
    const typst = {
      ...LATEX_ENGINE,
      id: "typst" as const,
      source_format: "typst" as const,
      typst_options: typstOptions({ font_dirs: ["/p/fonts"] }),
    };
    useFilesStore.setState({ engine: typst });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(settingsStoreLanguageServiceSettings.get().fontPaths).toEqual(["/p/fonts"]);
    useFilesStore.setState({ engine: { ...typst, typst_options: typstOptions({ font_dirs: ["/p/fonts"] }) } });
    expect(listener).toHaveBeenCalledTimes(1);
    useFilesStore.setState({ engine: { ...typst, typst_options: typstOptions({ font_dirs: ["/p/fonts"], system_fonts: false }) } });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(settingsStoreLanguageServiceSettings.get().systemFonts).toBe(false);
    stop();
    useFilesStore.setState({ engine: LATEX_ENGINE });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
