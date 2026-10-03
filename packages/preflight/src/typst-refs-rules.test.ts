import { describe, expect, it } from "vitest";
import type { RefsContext } from "./refs-rules";
import { runTypstRefsRules } from "./typst-refs-rules";

const context = (overrides: Partial<RefsContext> = {}): RefsContext => ({
  definedLabels: [],
  bibKeys: [],
  bibLoaded: false,
  projectFiles: ["main.typ", "refs.bib", "figures/plot.png", "chapters/intro.typ"],
  duplicateDois: [],
  ...overrides,
});

const run = (sources: Record<string, string>, overrides: Partial<RefsContext> = {}) =>
  runTypstRefsRules(
    Object.entries(sources).map(([path, content]) => ({ path, content })),
    context(overrides),
  );
const ids = (sources: Record<string, string>, overrides: Partial<RefsContext> = {}) =>
  run(sources, overrides).map((finding) => finding.id);

describe("Typst references", () => {
  it("resolves a reference to a label in the file or in the index", () => {
    expect(ids({ "main.typ": "= Intro <sec:intro>\nSee @sec:intro and @fig:plot." }, { definedLabels: ["fig:plot"] })).toEqual([]);
  });

  it("reports a reference with no label and no bibliography entry", () => {
    const text = "See @fig:missing.";
    const [finding] = run({ "main.typ": text });
    expect(finding.id).toBe("refs-undefined-ref");
    expect(finding.severity).toBe("error");
    expect(finding.title).toEqual({ key: "rules.refs-undefined-ref.titleTypst", params: { label: "fig:missing" } });
    expect(finding.detail.key).toBe("rules.refs-undefined-ref.detailTypst");
    expect(finding.file).toBe("main.typ");
    expect(text.slice(finding.from, finding.to)).toBe("@fig:missing");
  });

  it("resolves a prefixed reference to a label a figure package numbers", () => {
    expect(ids({ "main.typ": "#figure(table())<results>\nSee @tbl:results and @fig:results." })).toEqual([]);
  });

  it("softens an unresolved reference when a package may create the label", () => {
    const [finding] = run({ "main.typ": '#import "@preview/glossarium:0.5.0": *\nThe @iot:short network.' });
    expect(finding).toMatchObject({
      id: "refs-undefined-ref",
      severity: "warning",
      certainty: "advisory",
      detail: { key: "rules.refs-undefined-ref.detailTypstPackage" },
    });
  });

  it("checks an explicit ref call", () => {
    expect(ids({ "main.typ": "#ref(<nowhere>)" })).toEqual(["refs-undefined-ref"]);
  });

  it("does not read an email address, an escaped @ or a comment as a reference", () => {
    expect(ids({ "main.typ": "Mail jane@example.com or \\@team.\n// See @fig:old" })).toEqual([]);
  });

  it("accepts a citation key from a declared bibliography", () => {
    expect(
      ids(
        { "main.typ": 'As shown by @smith2020 and #cite(<doe2021>).\n#bibliography("refs.bib")' },
        { bibKeys: ["smith2020", "doe2021"] },
      ),
    ).toEqual([]);
  });

  it("reports a cite call whose key is not in the bibliography", () => {
    const [finding] = run({ "main.typ": '#cite(<nobody>)\n#bibliography("refs.bib")' }, { bibKeys: ["smith2020"] });
    expect(finding.id).toBe("refs-undefined-cite");
    expect(finding.title).toEqual({ key: "rules.refs-undefined-cite.titleTypst", params: { key: "nobody" } });
  });

  it("reports citations when no file calls bibliography", () => {
    const findings = run({ "main.typ": "As shown by @smith2020." }, { bibKeys: ["smith2020"] });
    expect(findings.map((finding) => finding.id)).toEqual(["refs-no-bibliography"]);
    expect(findings[0].lens).toBe("refs");
  });

  it("finds a bibliography passed to a template", () => {
    expect(
      ids(
        { "main.typ": '#show: ieee.with(bibliography: bibliography("refs.bib"))\n@smith2020' },
        { bibKeys: ["smith2020"] },
      ),
    ).toEqual([]);
  });

  it.each([
    'bibliography: read("refs.bib")',
    'bibliography: bibliography.with("refs.bib", full: true)',
  ])("finds a bibliography handed to a template as %s", (argument) => {
    expect(ids({ "main.typ": `#show: thesis.with(${argument})\n@smith2020` }, { bibKeys: ["smith2020"] })).toEqual([]);
  });

  it("finds a bibliography printed by a package function", () => {
    expect(ids({ "main.typ": "@smith2020\n#bilingual-bibliography(full: true)" }, { bibKeys: ["smith2020"] })).toEqual(
      [],
    );
  });

  it("checks the file named in bibliography.with", () => {
    const findings = run({ "main.typ": '#show: thesis.with(bibliography: bibliography.with("gone.bib"))' });
    expect(findings.map((finding) => [finding.id, finding.title.params?.file])).toEqual([["refs-bib-missing", "gone.bib"]]);
  });

  it("reports a missing bibliography file and holds back the citations it cannot check", () => {
    const findings = run({ "main.typ": '@unknown\n#bibliography(("refs.bib", "gone.yml"))' });
    expect(findings.map((finding) => finding.id)).toEqual(["refs-bib-missing"]);
    expect(findings[0].title.params).toEqual({ file: "gone.yml" });
    expect(findings[0].detail.key).toBe("rules.refs-bib-missing.detailTypst");
  });

  it("holds back citation checks while the index has no keys for a present bibliography", () => {
    expect(ids({ "main.typ": '@smith2020 and #cite(<doe>)\n#bibliography("refs.bib")' })).toEqual([]);
  });

  it("reports a label defined twice in a file", () => {
    expect(ids({ "main.typ": "= A <dup>\n= B <dup>\n@dup" })).toEqual(["refs-duplicate-label"]);
  });

  it("reports images and includes that are not in the project", () => {
    const findings = run({
      "main.typ": '#image("figures/plot.png")\n#image("figures/gone.png")\n#include "chapters/intro.typ"\n#include "chapters/gone.typ"',
    });
    expect(findings.map((finding) => [finding.id, finding.title.params?.file, finding.detail.key])).toEqual([
      ["refs-missing-asset", "figures/gone.png", "rules.refs-missing-asset.detailImageTypst"],
      ["refs-missing-asset", "chapters/gone.typ", "rules.refs-missing-asset.detailIncludeTypst"],
    ]);
  });

  it("resolves paths against the including file and the project root", () => {
    expect(
      ids({
        "chapters/intro.typ": '#image("../figures/plot.png")\n#image("/figures/plot.png")\n#import "@preview/cetz:0.3.0": canvas',
      }),
    ).toEqual([]);
  });

  it("skips asset checks when the project tree is unknown", () => {
    expect(ids({ "main.typ": '#image("gone.png")' }, { projectFiles: [] })).toEqual([]);
  });

  it("counts Typst citations when it lists uncited bibliography entries", () => {
    const findings = run(
      { "main.typ": '@cited\n#bibliography("refs.bib")' },
      {
        bibKeys: ["cited", "spare"],
        bibEntries: [
          { key: "cited", type: "article", fields: { title: "A long enough title one", year: "2020", author: "A", journal: "J" } },
          { key: "spare", type: "article", fields: { title: "A long enough title two", year: "2021", author: "B", journal: "J" } },
        ],
        allCitedKeys: [],
      },
    );
    const uncited = findings.find((finding) => finding.id === "refs-uncited-entries");
    expect(uncited?.detail.params).toEqual({ keys: "spare" });
  });

  it("reports project label facts from the index once", () => {
    const findings = run(
      { "main.typ": "Text", "chapters/intro.typ": "More" },
      { duplicateLabels: [{ label: "fig:a", files: ["main.typ", "chapters/intro.typ"] }] },
    );
    expect(findings.filter((finding) => finding.id === "refs-project-duplicate-label")).toHaveLength(1);
  });
});
