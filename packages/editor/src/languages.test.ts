// @vitest-environment jsdom

import { language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { jsxLanguage, tsxLanguage } from "@codemirror/lang-javascript";
import { describe, expect, it, vi } from "vitest";
import { codeChunkLanguage } from "./code-chunks";
import { editorLanguageForPath, languageForPath } from "./languages";

describe("languageForPath", () => {
  it.each([
    "main.tex",
    "main.ltx",
    "main.latex",
    "package.sty",
    "document.cls",
    "notes.md",
    "notes.markdown",
    "paper.qmd",
    "analysis.Rmd",
    "main.typ",
    "references.bib",
  ])("loads contractual source support for %s case-insensitively", (path) => {
    expect(languageForPath(path)).not.toBeNull();
    expect(languageForPath(`chapters/${path.toUpperCase()}`)).not.toBeNull();
  });

  it.each([
    "main.typ.txt",
    "main.tex.txt",
    "notes.markdown.bak",
    "plain.bst",
    "PLAIN.BST",
  ])("does not grant contractual support to excluded/lookalike path %s", (path) => {
    expect(languageForPath(path)).toBeNull();
  });

  it("gives a BibTeX buffer its comment token and closing brackets", () => {
    const support = languageForPath("references.bib");
    expect(support).not.toBeNull();
    const state = EditorState.create({
      doc: "@article{a,\n  title = {T},\n}",
      extensions: [support!],
    });
    expect(
      state.languageDataAt<{ line: string }>("commentTokens", 1)[0]?.line,
    ).toBe("%");
    expect(
      state.languageDataAt<{ brackets: string[] }>("closeBrackets", 1)[0]
        ?.brackets,
    ).toEqual(["{", '"', "("]);
  });

  it("routes a lookalike with a real generic suffix to that suffix only", () => {
    expect(languageForPath("references.bib.json")?.language.name).toBe(
      "json",
    );
    expect(languageForPath("main.tex.json")?.language.name).toBe("json");
    expect(languageForPath("paper.qmd.html")?.language.name).toBe("html");
  });

  it.each([
    ["styles.css", "css"],
    [".gitignore", "properties"],
    ["web/.dockerignore.gitignore", "properties"],
    ["config/.env", "properties"],
    ["ci.yml", "yaml"],
    ["ci.yaml", "yaml"],
    ["Cargo.toml", "toml"],
    ["build.sh", "shell"],
    ["run.bash", "shell"],
    ["theme.scss", "css"],
    ["notebook.ipynb", "json"],
    ["web/index.html", "html"],
    ["web/legacy.HTM", "html"],
    ["web/app.js", "javascript"],
    ["tools/build.mjs", "javascript"],
    ["tools/config.cjs", "javascript"],
    ["src/main.ts", "typescript"],
  ])("highlights the project file %s as %s", (path, language) => {
    expect(languageForPath(path)?.language.name).toBe(language);
  });

  it.each([
    ["src/App.jsx", jsxLanguage],
    ["slides/demo/index.tsx", tsxLanguage],
  ])("reads JSX in %s", (path, dialect) => {
    expect(languageForPath(path)?.language).toBe(dialect);
  });

  it("uses the Dockerfile mode for a file named Dockerfile", () => {
    const dockerfile = languageForPath("Dockerfile");
    expect(dockerfile).not.toBeNull();
    expect(dockerfile?.language.name).not.toBe("shell");
  });

  it.each(["app.dockerfile", "docker/API.Dockerfile"])(
    "uses the Dockerfile mode for %s",
    (path) => {
      expect(languageForPath(path)?.language.name).toBe(
        languageForPath("Dockerfile")?.language.name,
      );
    },
  );

  it("keeps a shell script named after Dockerfile in the shell mode", () => {
    expect(languageForPath("dockerfile.sh")?.language.name).toBe("shell");
  });
});

describe("Quarto sources", () => {
  it.each(["paper.qmd", "analysis.Rmd", "ANALYSIS.RMD"])("reads %s as Markdown", (path) => {
    expect(languageForPath(path)?.language.name).toBe("markdown");
  });
});

describe("editorLanguageForPath", () => {
  function open(path: string) {
    return new EditorView({ state: EditorState.create({ doc: "x = 1", extensions: editorLanguageForPath(path) }) });
  }

  it("leaves a file closed before its language loads alone", async () => {
    const view = open("fit.jl");
    const dispatch = vi.spyOn(view, "dispatch");
    view.destroy();
    await codeChunkLanguage("jl")?.load();
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["tools/analysis.py", "python"],
    ["models/fit.R", "r"],
    ["fit.jl", "julia"],
  ])("highlights %s as %s once its mode loads", async (path, name) => {
    const view = open(path);
    await vi.waitFor(() => expect(view.state.facet(language)?.name).toBe(name));
    view.destroy();
  });

  it("gives a file with a ready language that language at once", () => {
    const view = open("web/index.html");
    expect(view.state.facet(language)?.name).toBe("html");
    view.destroy();
  });

  it("gives a plain text file no language", () => {
    const view = open("notes.txt");
    expect(view.state.facet(language)).toBeNull();
    view.destroy();
  });
});
