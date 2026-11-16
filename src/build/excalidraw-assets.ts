import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { SUPPORTED_LOCALES } from "../../packages/i18n-contract/src/locale";
import { EXCALIDRAW_ASSET_PATH } from "../components/editor/board/board-assets";
import { boardLanguage } from "../components/editor/board/board-scene";
import { servedAssets } from "./served-assets";

const EXCALIDRAW_ENTRY = createRequire(import.meta.url).resolve("@excalidraw/excalidraw");

const EXCALIDRAW_PROD_DIR = path.join(
  EXCALIDRAW_ENTRY.slice(0, EXCALIDRAW_ENTRY.lastIndexOf(`${path.sep}dist${path.sep}`)),
  "dist",
  "prod",
);

export const EXCALIDRAW_FONTS_DIR = path.join(EXCALIDRAW_PROD_DIR, "fonts");

const LOCALE_CHUNK = /^\.\/locales\/(.+)-[A-Z0-9]{8}\.js$/u;
const UNUSED_LOCALE = "\0excalidraw-unused-locale";

export function excalidrawLocalesFor(
  appLocales: readonly string[] = SUPPORTED_LOCALES,
  localeDir = path.join(EXCALIDRAW_PROD_DIR, "locales"),
): Set<string> {
  const codes = readdirSync(localeDir).flatMap((name) => LOCALE_CHUNK.exec(`./locales/${name}`)?.[1] ?? []);
  return new Set(["en", "percentages", ...appLocales.map((locale) => boardLanguage(locale, codes))]);
}

export const excalidrawLocales = (keep: ReadonlySet<string> = excalidrawLocalesFor()): Plugin => ({
  name: "excalidraw-locales",
  apply: "build",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer?.includes("/@excalidraw/excalidraw/dist/")) return null;
    const code = LOCALE_CHUNK.exec(source)?.[1];
    return code && !keep.has(code) ? UNUSED_LOCALE : null;
  },
  load(id) {
    return id === UNUSED_LOCALE ? "export {};" : null;
  },
});

export function excalidrawFontFiles(fontsDir = EXCALIDRAW_FONTS_DIR): Map<string, string> {
  const files = new Map<string, string>();
  for (const family of readdirSync(fontsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const folder = path.join(fontsDir, family.name);
    for (const name of readdirSync(folder).filter((file) => file.endsWith(".woff2")).sort()) {
      files.set(`${EXCALIDRAW_ASSET_PATH}fonts/${family.name}/${name}`, path.join(folder, name));
    }
  }
  return files;
}

export const excalidrawAssets = (fontsDir = EXCALIDRAW_FONTS_DIR): Plugin =>
  servedAssets({
    name: "excalidraw-assets",
    files: () => new Map([...excalidrawFontFiles(fontsDir)].map(([fileName, source]) => [fileName, () => readFileSync(source)])),
    contentType: () => "font/woff2",
  });
