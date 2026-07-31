import { describe, expect, it } from "vitest";
import type { PackageCatalog } from "@oleafly/latex-intelligence";
import {
  fileTargetAccepts,
  keyvalKeysForCommand,
  optionKeysForCatalog,
  recognizeFileTarget,
  recognizeGlossaryKey,
  recognizeImportPath,
  recognizeKeyval,
  recognizePackageOption,
} from "./latex-contexts";

describe("recognizeGlossaryKey", () => {
  it("recognizes an empty query right after the opening brace", () => {
    expect(recognizeGlossaryKey(String.raw`\gls{`)).toEqual({ query: "" });
  });

  it("recognizes a partial key in a capitalized variant", () => {
    expect(recognizeGlossaryKey(String.raw`\Gls{par`)).toEqual({
      query: "par",
    });
  });

  it("recognizes acronym commands", () => {
    expect(recognizeGlossaryKey(String.raw`\acrshort{ab`)).toEqual({
      query: "ab",
    });
  });

  it("recognizes the first argument of \\glslink", () => {
    expect(recognizeGlossaryKey(String.raw`\glslink{key`)).toEqual({
      query: "key",
    });
  });

  it("returns the last key of a comma-separated key list", () => {
    expect(recognizeGlossaryKey(String.raw`\gls{a,b`)).toEqual({
      query: "b",
    });
  });

  it("does not match unrelated commands that merely start with gls letters", () => {
    expect(recognizeGlossaryKey(String.raw`\glossary{x`)).toBeNull();
  });

  it("does not match a glossary command without an opening brace", () => {
    expect(recognizeGlossaryKey(String.raw`\gls`)).toBeNull();
  });
});

describe("recognizePackageOption", () => {
  it("recognizes an option query inside \\usepackage with the name after the cursor", () => {
    expect(
      recognizePackageOption(String.raw`\usepackage[marg`, "in]{geometry}"),
    ).toEqual({ kind: "package", name: "geometry", query: "marg" });
  });

  it("recognizes \\documentclass options as class kind", () => {
    expect(
      recognizePackageOption(String.raw`\documentclass[11p`, "t]{article}"),
    ).toEqual({ kind: "class", name: "article", query: "11p" });
  });

  it("uses only the trailing entry of a comma-separated option list", () => {
    expect(
      recognizePackageOption(
        String.raw`\usepackage[a4paper, marg`,
        "]{geometry}",
      ),
    ).toEqual({ kind: "package", name: "geometry", query: "marg" });
  });

  it("returns null when the closing bracket and braced name are missing", () => {
    expect(
      recognizePackageOption(String.raw`\usepackage[marg`, "in and no close"),
    ).toBeNull();
  });

  it("returns null when the braces after the options are empty", () => {
    expect(
      recognizePackageOption(String.raw`\usepackage[marg`, "]{}"),
    ).toBeNull();
  });
});

describe("recognizeKeyval", () => {
  it("recognizes the command and partial key inside \\hypersetup", () => {
    expect(recognizeKeyval(String.raw`\hypersetup{colorl`)).toEqual({
      command: "hypersetup",
      query: "colorl",
    });
  });

  it("recognizes the key after an earlier key=value pair", () => {
    expect(
      recognizeKeyval(String.raw`\sisetup{per-mode=symbol, round-`),
    ).toEqual({ command: "sisetup", query: "round-" });
  });

  it("recognizes commands with optional arguments before the brace", () => {
    expect(recognizeKeyval(String.raw`\cmd[x]{ke`)).toEqual({
      command: "cmd",
      query: "ke",
    });
  });

  it("returns null for plain text without a command", () => {
    expect(recognizeKeyval("just some prose text")).toBeNull();
  });
});

describe("recognizeImportPath", () => {
  it("recognizes directory and partial file of \\import", () => {
    expect(recognizeImportPath(String.raw`\import{chapters/}{intro`)).toEqual({
      directory: "chapters",
      query: "intro",
    });
  });

  it("recognizes \\subimport with an empty query", () => {
    expect(recognizeImportPath(String.raw`\subimport{a/b}{`)).toEqual({
      directory: "a/b",
      query: "",
    });
  });

  it("does not match while the first (directory) argument is still open", () => {
    expect(recognizeImportPath(String.raw`\import{chap`)).toBeNull();
  });
});

describe("recognizeFileTarget and fileTargetAccepts", () => {
  it("recognizes \\includegraphics targets and filters to image files", () => {
    const context = recognizeFileTarget(String.raw`\includegraphics{fig`);
    expect(context).toEqual({ command: "includegraphics", query: "fig" });
    expect(fileTargetAccepts("includegraphics", "figure.png")).toBe(true);
    expect(fileTargetAccepts("includegraphics", "diagram.pdf")).toBe(true);
    expect(fileTargetAccepts("includegraphics", "chapter.tex")).toBe(false);
  });

  it("filters \\input, \\include, and \\subfile targets to TeX sources", () => {
    for (const command of ["input", "include", "subfile"]) {
      expect(
        recognizeFileTarget(`\\${command}{ch`),
      ).toEqual({ command, query: "ch" });
      expect(fileTargetAccepts(command, "chapter.tex")).toBe(true);
      expect(fileTargetAccepts(command, "chapter.ltx")).toBe(true);
      expect(fileTargetAccepts(command, "figure.png")).toBe(false);
    }
  });

  it("filters bibliography commands to .bib files only", () => {
    for (const command of ["addbibresource", "bibliography"]) {
      expect(fileTargetAccepts(command, "refs.bib")).toBe(true);
      expect(fileTargetAccepts(command, "refs.tex")).toBe(false);
      expect(fileTargetAccepts(command, "refs.pdf")).toBe(false);
    }
  });

  it("filters \\includepdf to .pdf files only", () => {
    expect(fileTargetAccepts("includepdf", "appendix.pdf")).toBe(true);
    expect(fileTargetAccepts("includepdf", "appendix.png")).toBe(false);
    expect(fileTargetAccepts("includepdf", "appendix.tex")).toBe(false);
  });
});

function catalog(
  keys: Record<string, string[]>,
  options?: string[],
): PackageCatalog {
  return {
    deps: [],
    macros: [],
    envs: [],
    keys,
    args: [],
    ...(options ? { options } : {}),
  };
}

describe("optionKeysForCatalog", () => {
  it("finds package options through \\usepackage/<name> lookups", () => {
    const geometry = catalog({
      "\\usepackage/geometry#c": ["margin=", "paper="],
    });
    expect(optionKeysForCatalog(geometry, "package", "geometry")).toEqual([
      "margin=",
      "paper=",
    ]);
  });

  it("finds class options through \\documentclass/<name> lookups", () => {
    const article = catalog({
      "\\documentclass/article#c": ["11pt", "twocolumn"],
    });
    expect(optionKeysForCatalog(article, "class", "article")).toEqual([
      "11pt",
      "twocolumn",
    ]);
    // The package marker must not pick up class-only lookups.
    expect(optionKeysForCatalog(article, "package", "article")).toEqual([]);
  });

  it("merges and dedupes the legacy options array with lookup keys", () => {
    const geometry = catalog(
      { "\\usepackage/geometry#c": ["margin=", "paper="] },
      ["landscape", "margin="],
    );
    expect(optionKeysForCatalog(geometry, "package", "geometry")).toEqual([
      "landscape",
      "margin=",
      "paper=",
    ]);
  });

  it("returns only legacy options when no lookup matches the name", () => {
    const geometry = catalog(
      { "\\usepackage/geometry#c": ["margin="] },
      ["landscape"],
    );
    expect(optionKeysForCatalog(geometry, "package", "fontenc")).toEqual([
      "landscape",
    ]);
  });
});

describe("keyvalKeysForCommand", () => {
  it("matches lookup entries exactly and by /variant prefix across catalogs", () => {
    const hyperref = catalog({
      "\\hypersetup": ["colorlinks", "linkcolor"],
    });
    const extra = catalog({
      "\\hypersetup/opts#c": ["urlcolor", "colorlinks"],
      "\\hypersetupx": ["never"],
    });
    expect(keyvalKeysForCommand([hyperref, extra], "hypersetup")).toEqual([
      "colorlinks",
      "linkcolor",
      "urlcolor",
    ]);
  });

  it("matches comma-separated lookup segments", () => {
    const siunitx = catalog({
      "\\sisetup,\\SI#c": ["per-mode=", "round-mode="],
    });
    expect(keyvalKeysForCommand([siunitx], "sisetup")).toEqual([
      "per-mode=",
      "round-mode=",
    ]);
  });

  it("returns an empty list for a command with no lookups", () => {
    const hyperref = catalog({ "\\hypersetup": ["colorlinks"] });
    expect(keyvalKeysForCommand([hyperref], "unknowncmd")).toEqual([]);
  });
});
