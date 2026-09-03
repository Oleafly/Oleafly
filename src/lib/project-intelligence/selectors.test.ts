import { describe, expect, it } from "vitest";
import { analyzeSeedProject, canonicalJson, sha256 } from "./seed-fixture";
import { citationCompletions } from "./selectors";

const GOLDEN_CITATION_DIGESTS: Readonly<Record<string, string>> = {
  "": "e1b645aa31cdd8d40933ff43a29f0d49d97450c16ecb18bf6ad2324b53836d52",
  a: "14444d11b00a79bff8d9f92cc3cb6bc565f7e2584e61121b03c87b14df0ea802",
  e: "fe8b4fe57c3a8b520aa2cf41324e1f89e36de7c5d76b7277c019976cfc548cd8",
  "2019": "9285d2632e42a309a02dfadfdc64274f154ac8c3a035c8c287e264e5501cf57e",
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
  "79661ed83c7836e4f41267d7f58ad4a506ccf4a8a85013c9a0894d9e6d47e375";

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
