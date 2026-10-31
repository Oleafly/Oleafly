import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_DIRS = ["src", "packages"];
const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const PIXEL_TEXT = /(?:^|[\s"'`:])((?:text|leading)-\[\d+(?:\.\d+)?px\])/gm;
const EDITOR_THEME = /\bEditorView\.(?:baseTheme|theme)\(/;
const PIXEL_FONT_SIZE = /(?:\bfontSize|["']font-size["'])\s*:\s*["'`](\d+(?:\.\d+)?px)["'`]/g;

function sourceFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((path) => SOURCE_FILE.test(path) && !TEST_FILE.test(path))
      .filter((path) => !path.split(/[\\/]/).includes("node_modules"))
      .map((path) => join(ROOT, dir, path)),
  );
}

function pixelTextClasses(text: string): string[] {
  return [...text.matchAll(PIXEL_TEXT)].map((match) => match[1]);
}

function pixelThemeFontSizes(text: string): string[] {
  return EDITOR_THEME.test(text) ? [...text.matchAll(PIXEL_FONT_SIZE)].map((match) => match[1]) : [];
}

describe("text that follows the App font size", () => {
  it("recognises fixed pixel text sizes and line heights, with or without a variant", () => {
    expect(
      pixelTextClasses('cn("text-[11px] md:text-[10px] leading-[13px]", "text-[0.6875rem] text-xs text-[clamp(1rem,2vw,2rem)]")'),
    ).toEqual(["text-[11px]", "text-[10px]", "leading-[13px]"]);
  });

  it("sizes interface text in rem, so App font size scales it", () => {
    const offenders = sourceFiles().flatMap((path) =>
      pixelTextClasses(readFileSync(path, "utf8")).map((found) => `${relative(ROOT, path)}: ${found}`),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises a fixed pixel font size in a CodeMirror theme, and only there", () => {
    const theme = `EditorView.theme({ ".a": { fontSize: "11px" }, ".b": { "font-size": '12.5px' }, ".c": { fontSize: "0.75rem" }, ".d": { fontSize: "var(--cm-font-size, 13px)" } })`;
    expect(pixelThemeFontSizes(theme)).toEqual(["11px", "12.5px"]);
    expect(pixelThemeFontSizes(theme.replace("EditorView.theme", "EditorView.baseTheme"))).toEqual(["11px", "12.5px"]);
    expect(pixelThemeFontSizes(`const style = { fontSize: "11px" };`)).toEqual([]);
  });

  it("sizes CodeMirror theme text in rem, so App font size scales the editor's panels and popups", () => {
    const offenders = sourceFiles().flatMap((path) =>
      pixelThemeFontSizes(readFileSync(path, "utf8")).map((found) => `${relative(ROOT, path)}: fontSize ${found}`),
    );
    expect(offenders).toEqual([]);
  });
});
