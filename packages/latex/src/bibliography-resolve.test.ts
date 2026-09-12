import { describe, expect, it } from "vitest";
import {
  bibliographyCandidatePaths,
  bibliographyDeclarations,
  bibliographyDisplayName,
  bibliographyEngineForCommand,
  resolveBibliographyPath,
} from "./bibliography-resolve";

describe("bibliographyCandidatePaths", () => {
  it("puts the project root ahead of the declaring directory for latex", () => {
    expect(
      bibliographyCandidatePaths("refs.bib", "document-body/intro.tex", "latex"),
    ).toEqual(["refs.bib", "document-body/refs.bib"]);
  });

  it("puts the declaring directory ahead of the project root for typst", () => {
    expect(
      bibliographyCandidatePaths("refs.bib", "chapters/one.typ", "typst"),
    ).toEqual(["chapters/refs.bib", "refs.bib"]);
  });

  it("puts the declaring directory ahead of the project root for markdown", () => {
    expect(
      bibliographyCandidatePaths("refs.bib", "chapters/one.md", "markdown"),
    ).toEqual(["chapters/refs.bib", "refs.bib"]);
  });

  it("supplies the .bib extension when the target has none", () => {
    expect(bibliographyCandidatePaths("refs", "main.tex", "latex")).toEqual([
      "refs",
      "refs.bib",
    ]);
  });

  it("leaves a non-bib extension alone", () => {
    expect(bibliographyCandidatePaths("refs.yml", "main.typ", "typst")).toEqual([
      "refs.yml",
    ]);
  });

  it("supplies the .bib extension after a dotted name segment", () => {
    expect(bibliographyCandidatePaths("refs.v1", "main.tex", "latex")).toEqual([
      "refs.v1",
      "refs.v1.bib",
    ]);
  });

  it("never supplies an extension for an \\addbibresource target", () => {
    expect(bibliographyCandidatePaths("refs.v1", "main.tex", "biblatex")).toEqual([
      "refs.v1",
    ]);
    expect(bibliographyCandidatePaths("refs", "main.tex", "biblatex")).toEqual([
      "refs",
    ]);
  });

  it("still puts the project root first for an \\addbibresource target", () => {
    expect(
      bibliographyCandidatePaths("refs.bib", "document-body/intro.tex", "biblatex"),
    ).toEqual(["refs.bib", "document-body/refs.bib"]);
  });

  it("keeps a target that already ends in .bib as the only spelling", () => {
    expect(bibliographyCandidatePaths("refs.bib", "main.tex", "latex")).toEqual([
      "refs.bib",
    ]);
  });

  it("strips a leading ./ and collapses .. segments", () => {
    expect(
      bibliographyCandidatePaths("../shared/refs.bib", "parts/one.tex", "latex"),
    ).toEqual(["shared/refs.bib"]);
  });

  it("returns nothing for a url, an absolute path, or an empty target", () => {
    expect(
      bibliographyCandidatePaths("https://example.org/refs.bib", "main.tex", "latex"),
    ).toEqual([]);
    expect(bibliographyCandidatePaths("/etc/refs.bib", "main.tex", "latex")).toEqual([]);
    expect(bibliographyCandidatePaths("   ", "main.tex", "latex")).toEqual([]);
  });

  it("returns nothing for a target that climbs out of the project", () => {
    expect(bibliographyCandidatePaths("../refs.bib", "main.tex", "latex")).toEqual([]);
  });
});

describe("resolveBibliographyPath", () => {
  it("prefers the root copy over a sibling for latex", () => {
    expect(
      resolveBibliographyPath("refs.bib", "document-body/intro.tex", [
        "refs.bib",
        "document-body/refs.bib",
      ], "latex"),
    ).toBe("refs.bib");
  });

  it("prefers the sibling copy over the root for typst", () => {
    expect(
      resolveBibliographyPath("refs.bib", "chapters/one.typ", [
        "refs.bib",
        "chapters/refs.bib",
      ], "typst"),
    ).toBe("chapters/refs.bib");
  });

  it("prefers the sibling copy over the root for markdown", () => {
    expect(
      resolveBibliographyPath("refs.bib", "chapters/one.md", [
        "refs.bib",
        "chapters/refs.bib",
      ], "markdown"),
    ).toBe("chapters/refs.bib");
  });

  it("falls back to the declaring directory when the root copy is absent", () => {
    expect(
      resolveBibliographyPath("refs.bib", "document-body/intro.tex", [
        "document-body/refs.bib",
      ], "latex"),
    ).toBe("document-body/refs.bib");
  });

  it("matches a differently cased spelling", () => {
    expect(
      resolveBibliographyPath("References.bib", "main.tex", ["references.bib"], "latex"),
    ).toBe("references.bib");
  });

  it("returns null when no spelling is in the project", () => {
    expect(
      resolveBibliographyPath("missing/refs.bib", "main.tex", ["other/refs.bib"], "latex"),
    ).toBeNull();
  });

  it("does not accept an unrelated file that only shares a basename", () => {
    expect(
      resolveBibliographyPath("bibliography/refs.bib", "main.tex", ["vendor/refs.bib"], "latex"),
    ).toBeNull();
  });

  it("finds refs.v1.bib for a dotted \\bibliography name", () => {
    expect(
      resolveBibliographyPath("refs.v1", "main.tex", ["main.tex", "refs.v1.bib"], "latex"),
    ).toBe("refs.v1.bib");
  });

  it("finds refs.bib when the declaration already spells the extension", () => {
    expect(
      resolveBibliographyPath("refs.bib", "main.tex", ["main.tex", "refs.bib"], "latex"),
    ).toBe("refs.bib");
  });

  it("finds a .v2 suffixed library from a nested declaring file", () => {
    expect(
      resolveBibliographyPath(
        "references.v2",
        "chapters/one.tex",
        ["chapters/one.tex", "chapters/references.v2.bib"],
        "latex",
      ),
    ).toBe("chapters/references.v2.bib");
  });

  it("still reports a dotted name that has no .bib file", () => {
    expect(
      resolveBibliographyPath("refs.v1", "main.tex", ["main.tex", "refs.bib"], "latex"),
    ).toBeNull();
  });

  it("refuses refs.v1.bib for a dotted \\addbibresource name", () => {
    expect(
      resolveBibliographyPath(
        "refs.v1",
        "main.tex",
        ["main.tex", "refs.v1.bib"],
        "biblatex",
      ),
    ).toBeNull();
  });

  it("refuses a bare \\addbibresource name whose .bib file exists", () => {
    expect(
      resolveBibliographyPath("refs", "main.tex", ["main.tex", "refs.bib"], "biblatex"),
    ).toBeNull();
  });

  it("finds the file an \\addbibresource names in full", () => {
    expect(
      resolveBibliographyPath(
        "refs.v1.bib",
        "chapters/one.tex",
        ["chapters/one.tex", "chapters/refs.v1.bib"],
        "biblatex",
      ),
    ).toBe("chapters/refs.v1.bib");
  });
});

describe("bibliographyEngineForCommand", () => {
  it("gives \\addbibresource the biblatex rules and \\bibliography the bibtex ones", () => {
    expect(bibliographyEngineForCommand("addbibresource")).toBe("biblatex");
    expect(bibliographyEngineForCommand("bibliography")).toBe("latex");
  });
});

describe("bibliographyDeclarations", () => {
  it("splits a comma separated \\bibliography list", () => {
    const source = "\\bibliography{refs,extra}";
    expect(bibliographyDeclarations(source)).toEqual([
      { raw: "refs", from: 0, to: source.length, command: "bibliography" },
      { raw: "extra", from: 0, to: source.length, command: "bibliography" },
    ]);
  });

  it("reports the command range for \\addbibresource", () => {
    const command = "\\addbibresource{references.bib}";
    const source = `text\n${command}\n`;
    expect(bibliographyDeclarations(source)).toEqual([
      {
        raw: "references.bib",
        from: 5,
        to: 5 + command.length,
        command: "addbibresource",
      },
    ]);
  });

  it("reports which command declared each file", () => {
    expect(
      bibliographyDeclarations("\\bibliography{refs}\n\\addbibresource{extra.bib}").map(
        (declaration) => declaration.command,
      ),
    ).toEqual(["bibliography", "addbibresource"]);
  });

  it("skips a remote resource", () => {
    expect(
      bibliographyDeclarations("\\addbibresource[location=remote]{https://example.org/r.bib}"),
    ).toEqual([]);
  });

  it("finds nothing in a document with no bibliography", () => {
    expect(bibliographyDeclarations("\\cite{a}")).toEqual([]);
  });
});

describe("bibliographyDisplayName", () => {
  it("supplies the .bib extension for a bare name", () => {
    expect(bibliographyDisplayName("refs")).toBe("refs.bib");
  });

  it("keeps a name that already carries an extension", () => {
    expect(bibliographyDisplayName("chapters/refs.bib")).toBe("chapters/refs.bib");
    expect(bibliographyDisplayName("refs.yml")).toBe("refs.yml");
  });

  it("reports an \\addbibresource target exactly as the author wrote it", () => {
    expect(bibliographyDisplayName("refs", "biblatex")).toBe("refs");
    expect(bibliographyDisplayName("refs.v1", "biblatex")).toBe("refs.v1");
  });
});
