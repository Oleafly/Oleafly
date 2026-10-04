import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { languageForPath } from "./languages";

describe("languageForPath", () => {
  it.each([
    "main.tex",
    "main.ltx",
    "main.latex",
    "package.sty",
    "document.cls",
    "notes.md",
    "notes.markdown",
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
  ])("highlights the project file %s as %s", (path, language) => {
    expect(languageForPath(path)?.language.name).toBe(language);
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
