import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { EXCALIDRAW_ASSET_PATH } from "../components/editor/board/board-assets";
import { EXCALIDRAW_FONTS_DIR, excalidrawAssets, excalidrawFontFiles, excalidrawLocales, excalidrawLocalesFor } from "./excalidraw-assets";

const dir = mkdtempSync(path.join(tmpdir(), "excalidraw-fonts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Excalidraw fonts served by the app", () => {
  it("ships every font family Excalidraw draws text with, CJK included", () => {
    const families = new Set([...excalidrawFontFiles().keys()].map((name) => name.split("/")[2]));
    expect(families).toEqual(new Set(["Assistant", "Cascadia", "ComicShanns", "Excalifont", "Liberation", "Lilita", "Nunito", "Virgil", "Xiaolai"]));
    expect(EXCALIDRAW_FONTS_DIR.endsWith(path.join("dist", "prod", "fonts"))).toBe(true);
  });

  it("serves the fonts in development and emits them into the build", () => {
    mkdirSync(path.join(dir, "Virgil"));
    writeFileSync(path.join(dir, "Virgil", "Virgil-Regular.woff2"), "font");
    writeFileSync(path.join(dir, "Virgil", "LICENSE.txt"), "licence");
    const fileName = `${EXCALIDRAW_ASSET_PATH}fonts/Virgil/Virgil-Regular.woff2`;
    expect([...excalidrawFontFiles(dir).keys()]).toEqual([fileName]);

    const plugin = excalidrawAssets(dir);
    const emitted: { fileName: string }[] = [];
    (plugin.generateBundle as unknown as (this: unknown) => void).call({ emitFile: (file: { fileName: string }) => emitted.push(file) });
    expect(emitted.map((file) => file.fileName)).toEqual([fileName]);

    type Middleware = (request: { url: string }, response: { setHeader: (name: string, value: string) => void; end: (body: unknown) => void }, next: () => void) => void;
    let middleware: Middleware | undefined;
    (plugin.configureServer as unknown as (server: unknown) => void)({
      config: { base: "/" },
      middlewares: { use: (handler: Middleware) => (middleware = handler) },
    });
    const setHeader = vi.fn();
    const end = vi.fn();
    const next = vi.fn();
    middleware?.({ url: `/${fileName}?v=1` }, { setHeader, end }, next);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "font/woff2");
    expect(String(end.mock.calls[0]?.[0])).toBe("font");
    middleware?.({ url: "/excalidraw/fonts/missing.woff2" }, { setHeader, end }, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("Excalidraw translations in the build", () => {
  it("keeps one translation for each interface language and drops the rest", () => {
    const keep = excalidrawLocalesFor();
    expect(keep).toEqual(
      new Set([
        "en", "percentages", "zh-CN", "zh-TW", "de-DE", "fr-FR", "es-ES", "it-IT", "nl-NL", "pt-BR", "pl-PL",
        "ru-RU", "uk-UA", "tr-TR", "cs-CZ", "da-DK", "sv-SE", "nb-NO", "fi-FI", "ro-RO", "ja-JP", "ko-KR", "vi-VN",
      ]),
    );
  });

  it("points every dropped translation at one empty module", () => {
    const plugin = excalidrawLocales(new Set(["en", "de-DE"]));
    const resolve = (source: string, importer?: string) =>
      (plugin.resolveId as unknown as (source: string, importer?: string) => string | null)(source, importer);
    const importer = "/repo/node_modules/@excalidraw/excalidraw/dist/prod/index.js";
    expect(resolve("./locales/de-DE-XR44H4JA.js", importer)).toBeNull();
    expect(resolve("./locales/th-TH-HPSO5L25.js", importer)).toBe("\0excalidraw-unused-locale");
    expect(resolve("./locales/th-TH-HPSO5L25.js", "/repo/src/locales/index.ts")).toBeNull();
    expect((plugin.load as unknown as (id: string) => string | null)("\0excalidraw-unused-locale")).toBe("export {};");
  });
});
