import { beforeAll, describe, expect, it } from "vitest";
import { i18n, loadNamespace } from "@/i18n";
import type { CollabSettingNotice } from "@/lib/tauri";
import { settingActivityText } from "./setting-activity";

type CollabT = Parameters<typeof settingActivityText>[2];

const t = i18n.t.bind(i18n) as unknown as CollabT;

function said(change: CollabSettingNotice, name = "Bob Smith"): string {
  return settingActivityText(change, name, t);
}

beforeAll(async () => {
  await loadNamespace("collab");
});

describe("activity lines for shared project settings", () => {
  it("names the compiler each engine and LaTeX flavor uses", () => {
    const compilers: [string, string | null, string][] = [
      ["typst", null, "Typst"],
      ["markdown", null, "Pandoc"],
      ["xetex", null, "Tectonic"],
      ["latexmk", "pdflatex", "pdfLaTeX"],
      ["latexmk", "xelatex", "XeLaTeX"],
      ["latexmk", "lualatex", "LuaLaTeX"],
      ["latexmk", "uplatex", "upLaTeX"],
      ["latexmk", "platex", "pLaTeX"],
      ["latexmk", null, "Auto"],
      ["latexmk", "something-new", "Auto"],
    ];
    for (const [engine, flavor, name] of compilers) {
      expect(said({ kind: "compiler", engine, flavor })).toBe(`Bob Smith set the compiler to ${name}`);
    }
  });

  it("describes main document, spelling and Typst changes, including going back to defaults", () => {
    expect(said({ kind: "mainDocument", path: "thesis/main.tex" })).toBe(
      "Bob Smith made thesis/main.tex the main document",
    );
    expect(said({ kind: "spellingLanguage", locale: "de_DE" })).toBe(
      "Bob Smith set the spelling language to German (Germany)",
    );
    expect(said({ kind: "spellingLanguage", locale: null })).toBe("Bob Smith cleared the project's spelling language");
    expect(said({ kind: "typstVersion", version: "0.14.0" })).toBe("Bob Smith set the Typst version to 0.14.0");
    expect(said({ kind: "typstVersion", version: null })).toBe("Bob Smith set the Typst version back to the default");
    expect(said({ kind: "typstOptions" }, "Someone")).toBe("Someone changed the Typst options");
  });

  it("says the main document followed its file to a new name without naming anyone", () => {
    expect(settingActivityText({ kind: "mainDocument", path: "main (2).tex" }, "Someone", t, false)).toBe(
      "main (2).tex is the main document now",
    );
  });
});
