import { describe, expect, it } from "vitest";
import { texGapSignature } from "./files";
import { packageSuggestionSignature } from "./compile";

// Both signatures answer the same question: "have I already told the user
// about exactly this set of packages?" Order and repeats must not change the
// answer, or the same gap gets reported twice.
describe.each([
  ["texGapSignature", texGapSignature],
  ["packageSuggestionSignature", packageSuggestionSignature],
])("%s", (_name, signature) => {
  it("is independent of the order the packages arrived in", () => {
    expect(signature(["xcolor", "amsmath", "tikz"])).toBe(
      signature(["tikz", "xcolor", "amsmath"]),
    );
  });

  it("orders by code point", () => {
    expect(signature(["xcolor", "Amsmath", "tikz"])).toBe(
      "Amsmath,tikz,xcolor",
    );
  });

  it("collapses repeats so a duplicate does not look like a new gap", () => {
    expect(signature(["amsmath", "amsmath", "tikz"])).toBe("amsmath,tikz");
  });

  it("distinguishes genuinely different sets", () => {
    expect(signature(["amsmath"])).not.toBe(signature(["amsmath", "tikz"]));
  });

  it("handles the empty and single cases", () => {
    expect(signature([])).toBe("");
    expect(signature(["amsmath"])).toBe("amsmath");
  });
});
