import { describe, expect, it } from "vitest";
import { buildMarkdownInsights, missingMarkdownSources, parseFrontMatter } from "./markdown-insights";

function insights(main: string, extra: Record<string, string> = {}) {
  return buildMarkdownInsights({ mainDoc: "paper.md", texts: { "paper.md": main, ...extra } });
}

describe("markdown insights for raw LaTeX math", () => {
  it("lists a multi-line equation environment with its label", () => {
    const result = insights(
      ["Intro.", "", String.raw`\begin{equation}`, String.raw`E = mc^2 \label{eq:mass}`, String.raw`\end{equation}`, "", "See @eq:mass."].join("\n"),
    );

    expect(result.equations.map((entry) => [entry.label, entry.location?.line])).toEqual([["eq:mass", 3]]);
    expect(result.labels.map((entry) => [entry.name, entry.kind])).toContainEqual(["eq:mass", "equation"]);
  });

  it("lists a one-line equation and an unlabelled one", () => {
    const result = insights(
      [String.raw`\begin{align*} a &= b \end{align*}`, "", String.raw`\begin{equation}\label{eq:one} x = 1 \end{equation}`].join("\n"),
    );

    expect(result.equations.map((entry) => entry.label)).toEqual([null, "eq:one"]);
  });
});

describe("markdown metadata authors", () => {
  it("reads structured, literal and split author names", () => {
    const front = [
      "---",
      "author:",
      "  - name:",
      "      given: Ada",
      "      family: Lovelace",
      "  - literal: The Collective",
      "  - given: Alan",
      "    family: Turing",
      "  - name:",
      "      literal: Grace Hopper",
      "  - [nested, list]",
      "---",
      "",
      "Body.",
    ].join("\n");

    expect(insights(front).metadata.authors).toEqual(["Ada Lovelace", "The Collective", "Alan Turing", "Grace Hopper"]);
  });

  it("reads a flow mapping and skips blank and comment lines inside a mapping", () => {
    const front = parseFrontMatter(
      ["---", "meta: {lang: en, toc: true}", "nested:", "", "  # note", "  key: value", "---", "x"].join("\n"),
    );

    expect(front?.values.meta).toEqual({ lang: "en", toc: "true" });
    expect(front?.values.nested).toEqual({ key: "value" });
  });
});

describe("missing markdown sources", () => {
  it("lists the main document when it is not loaded", () => {
    expect(missingMarkdownSources("paper.md", {})).toEqual(["paper.md"]);
    expect(buildMarkdownInsights({ mainDoc: "paper.md", texts: {} }).headings).toEqual([]);
  });

  it("resolves bibliographies relative to a nested main document", () => {
    const main = "---\nbibliography:\n  - ./refs.bib\n  - ../shared/library.bib\n---\n\nText.\n";

    expect(missingMarkdownSources("docs/paper.md", { "docs/paper.md": main })).toEqual([
      "docs/refs.bib",
      "shared/library.bib",
    ]);
    expect(
      missingMarkdownSources("docs/paper.md", { "docs/paper.md": main, "docs/refs.bib": "", "shared/library.bib": "" }),
    ).toEqual([]);
  });
});
