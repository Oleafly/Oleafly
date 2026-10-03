import { describe, expect, it } from "vitest";
import {
  bibtexHasOleaflyEntry,
  oleaflyBibtex,
  oleaflyBibtexTokens,
  oleaflyHayagriva,
  OLEAFLY_CITATION_KEY,
} from "./cite-oleafly";

describe("oleaflyBibtex", () => {
  it("produces one software entry with the running version", () => {
    const text = oleaflyBibtex("0.4.0");
    expect(text.startsWith(`@software{${OLEAFLY_CITATION_KEY},`)).toBe(true);
    expect(text).toContain("version = {0.4.0}");
    expect(text).toContain("url     = {https://github.com/Oleafly/Oleafly}");
    expect(text.endsWith("\n}")).toBe(true);
    const opens = text.split("{").length;
    const closes = text.split("}").length;
    expect(opens).toBe(closes);
  });

  it("leaves the version out when it is unknown", () => {
    expect(oleaflyBibtex("  ")).not.toContain("version");
  });

  it("tokenises into the same text it prints", () => {
    const joined = oleaflyBibtexTokens("0.4.0")
      .map((line) => line.map((token) => token.text).join(""))
      .join("\n");
    expect(joined).toBe(oleaflyBibtex("0.4.0"));
    expect(oleaflyBibtexTokens("0.4.0")[0]?.map((token) => token.kind)).toEqual([
      "entry",
      "punctuation",
      "key",
      "punctuation",
    ]);
  });

  it("recognises an existing entry regardless of type and spacing", () => {
    expect(bibtexHasOleaflyEntry("@misc{ Oleafly ,\n title={x}}")).toBe(true);
    expect(bibtexHasOleaflyEntry("@article{oleafly2026,\n title={x}}")).toBe(false);
    expect(bibtexHasOleaflyEntry("")).toBe(false);
  });
});

describe("oleaflyHayagriva", () => {
  it("writes a quoted repository entry with the version as a note", () => {
    expect(oleaflyHayagriva(" 0.5.0 ")).toBe(
      [
        "oleafly:",
        "  type: repository",
        '  title: "Oleafly: a local-first desktop workspace for research writing"',
        "  author:",
        '    - "Venkateshmurthy, Prajwal S."',
        '    - name: "The Oleafly contributors"',
        "  date: 2026",
        '  url: "https://github.com/Oleafly/Oleafly"',
        '  note: "Version 0.5.0"',
      ].join("\n"),
    );
  });

  it("escapes backslashes and quotes and drops an empty version", () => {
    expect(oleaflyHayagriva(String.raw`1.0 "beta" \ build`)).toContain(
      String.raw`  note: "Version 1.0 \"beta\" \\ build"`,
    );
    expect(oleaflyHayagriva("  ")).not.toContain("note:");
  });
});
