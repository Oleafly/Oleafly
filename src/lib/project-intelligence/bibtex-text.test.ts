import { describe, expect, it } from "vitest";
import { bibtexTextToUnicode, searchFold } from "./bibtex-text";

describe("bibtexTextToUnicode", () => {
  it.each([
    [String.raw`\v{C}apek`, "Čapek"],
    [String.raw`{\v C}apek`, "Čapek"],
    [String.raw`\v Capek`, "Čapek"],
    [String.raw`Nov{\'a}k`, "Novák"],
    [String.raw`Nov\'{a}k`, "Novák"],
    [String.raw`Nov\'ak`, "Novák"],
    [String.raw`G\"{o}del`, "Gödel"],
    [String.raw`Mart\'{\i}nez`, "Martínez"],
    [String.raw`Fran\c{c}ois`, "François"],
    [String.raw`\k{a}ka`, "ąka"],
    [String.raw`Stra\ss e`, "Straße"],
    [String.raw`{\O}stergaard`, "Østergaard"],
    [String.raw`\L{}\'od\'z`, "Łódź"],
    [String.raw`Sk{\aa}r`, "Skår"],
    ["The {D3Q27} lattice", "The D3Q27 lattice"],
    [String.raw`Profit \& loss`, "Profit & loss"],
  ])("decodes %s", (raw, decoded) => {
    expect(bibtexTextToUnicode(raw)).toBe(decoded);
  });

  it("keeps math and unknown macros as written", () => {
    expect(bibtexTextToUnicode(String.raw`Flow at $Re_{\tau}$`)).toBe(
      String.raw`Flow at $Re_{\tau}$`,
    );
    expect(bibtexTextToUnicode(String.raw`See \url{https://x.org/a_b}`)).toBe(
      String.raw`See \url{https://x.org/a_b}`,
    );
  });

  it("returns NFC text", () => {
    expect(bibtexTextToUnicode("Dvor\u030Ca\u0301k")).toBe("Dvo\u0159\u00e1k");
  });
});

describe("searchFold", () => {
  it("folds accents, case and letters without a decomposition", () => {
    expect(searchFold("Dvořák")).toBe("dvorak");
    expect(searchFold("Dvor\u030Ca\u0301k")).toBe("dvorak");
    expect(searchFold("İzmir")).toBe("izmir");
    expect(searchFold("Łódź")).toBe("lodz");
    expect(searchFold("Straße")).toBe("strasse");
  });

  it("keeps marks that are letters of their script", () => {
    expect(searchFold("परिचय")).not.toBe(searchFold("पुरचय"));
    expect(searchFold("परिचय")).toBe("परिचय");
    expect(searchFold("が")).not.toBe(searchFold("か"));
    expect(searchFold("が").startsWith(searchFold("か"))).toBe(false);
    expect(searchFold("รูป")).toBe("รูป");
  });
});
