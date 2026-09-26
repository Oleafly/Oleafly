import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import { analyzeSeedProject, canonicalJson, sha256 } from "./seed-fixture";
import { citationCompletions } from "./selectors";

const GOLDEN_CITATION_DIGESTS: Readonly<Record<string, string>> = {
  "": "617f3b49f5e522204797cf934a41b7c5d2014d3c248f2c58d08ac964d140f59c",
  a: "446b1ea3a9788cec4e1c12ad2fbff4417c477b1fa4f2e14d3d5fe3e36c7409b3",
  e: "33cae26c57c84deaa9da2f4cf9192d26b0e9617a5237c6eb18fd36116963ad3f",
  "2019": "318a82a39d9b377eae71676ac9f07e32f87a220f114fd197c841cc1f13a34bb3",
  smith: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "@quantum":
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  phys: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "zzz-none":
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  Brandt: "5c61e5456c675fb897001aebc14d49cf2d9032fa31a57830c8f09f1a1ffee17f",
  turbulence:
    "a94aef37e19118c5b08af7222eb41561a3aa0c3826723f171d8c48d877fcd350",
};
const GOLDEN_ALL_DIGEST =
  "518df70c8368c0791acfb467d08f52a48c6708f9227b2e1ea94a425b3b4e6b23";

describe("citation completion from the bibliography summary", () => {
  it("lists the same options the field-backed catalog produced", () => {
    const seed = analyzeSeedProject("computational-physics-phd-thesis");
    const results: Record<string, unknown> = {};
    for (const [query, digest] of Object.entries(GOLDEN_CITATION_DIGESTS)) {
      const completions = citationCompletions(seed.snapshot, query);
      results[query] = completions;
      expect(sha256(canonicalJson(completions)), query).toBe(digest);
    }
    expect(sha256(canonicalJson(results))).toBe(GOLDEN_ALL_DIGEST);
    expect(
      citationCompletions(seed.snapshot, "2019").map((completion) => [
        completion.key,
        completion.year,
      ]),
    ).toEqual([
      ["ferreira2019intermittency", "2019"],
      ["halvorsen2019closure", "2019"],
    ]);
    expect(
      citationCompletions(seed.snapshot, "Brandt").map(
        (completion) => completion.key,
      ),
    ).toEqual(["brandt2021stableabl", "devereux2023les"]);
    expect(
      citationCompletions(seed.snapshot, "").map((completion) => completion.key),
    ).toEqual(seed.snapshot.bibliography.entries.map((entry) => entry.key));
  });

  it("derives the display line from the retained fields once in the worker", () => {
    const seed = analyzeSeedProject("computational-physics-phd-thesis");
    for (const entry of seed.snapshot.bibliography.entries) {
      expect("fields" in entry).toBe(false);
      expect(entry.display).toBe(
        [entry.author, entry.year, entry.title].filter(Boolean).join(" · "),
      );
    }
    const detail = seed.bibliographyDetails.find(
      (entry) => entry.key === "brandt2021stableabl",
    );
    expect(detail?.fields.map((field) => field.name)).toEqual([
      "title",
      "author",
      "journal",
      "volume",
      "number",
      "pages",
      "year",
    ]);
    expect(detail?.display).toBe(
      seed.snapshot.bibliography.entries.find(
        (entry) => entry.key === "brandt2021stableabl",
      )?.display,
    );
  });
});

describe("citation search across spellings", () => {
  const bibliography = [
    String.raw`@book{rur, author={\v{C}apek, Karel}, title={R.U.R.}, year={1920}}`,
    String.raw`@book{nov, author={Nov{\'a}k, Jan}, title={Česká {\v{s}}kola}, year={2000}}`,
    "@book{nfd, author={Dvor\u030Ca\u0301k, Anton\u00edn}, title={Symfonie}, year={1893}}",
    "@book{ayse2001, author={İzmir, Ayşe}, title={Kıyı}, year={2001}}",
    "@book{piotr2002, author={Łódź, Piotr}, title={Straße}, year={2002}}",
  ].join("\n");
  const snapshot = assembleProjectIntelligence({
    identity: { projectId: "p", projectRevision: 1, requestGeneration: 1 },
    files: { "refs.bib": analyzeProjectFile("refs.bib", bibliography, 1) },
    knownFiles: ["refs.bib"],
    stats: {
      fileCount: 1,
      characterCount: bibliography.length,
      parsedFileCount: 1,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
  const keys = (query: string) =>
    citationCompletions(snapshot, query).map((completion) => completion.key);

  it("shows decoded names instead of raw TeX", () => {
    const entry = snapshot.bibliography.entries.find(
      (candidate) => candidate.key === "nov",
    );
    expect(entry?.author).toBe("Novák, Jan");
    expect(entry?.title).toBe("Česká škola");
    expect(entry?.display).toBe("Novák, Jan · 2000 · Česká škola");
  });

  it.each([
    ["Čapek", "rur"],
    ["capek", "rur"],
    ["Novák", "nov"],
    ["novak", "nov"],
    ["škola", "nov"],
    ["Dvořák", "nfd"],
    ["dvorak", "nfd"],
    ["izm", "ayse2001"],
    ["lodz", "piotr2002"],
    ["strasse", "piotr2002"],
  ])("finds %s", (query, key) => {
    expect(keys(query)).toContain(key);
  });
});
