import { describe, expect, it } from "vitest";
import {
  draftFromVariants,
  draftProblem,
  newVariantName,
  selectionAfterSave,
  variantsFromDraft,
  type DraftVariant,
} from "./variants-draft";

const label = (number: number) => `variant ${number}`;

describe("the variant editor draft", () => {
  it("round-trips the project's variants", () => {
    const variants = { draft: { draft: "true" }, final: { draft: "false", venue: "acm" } };
    const draft = draftFromVariants(variants);
    expect(draft.map((variant) => variant.original)).toEqual(["draft", "final"]);
    expect(variantsFromDraft(draft)).toEqual(variants);
  });

  it("trims names and keys and keeps values as typed", () => {
    const draft: DraftVariant[] = [
      { id: 1, original: null, name: " review ", inputs: [{ id: 2, key: " anonymous ", value: " yes " }] },
    ];
    expect(variantsFromDraft(draft)).toEqual({ review: { anonymous: " yes " } });
  });

  it("names new variants without clashing", () => {
    const draft = draftFromVariants({ "variant 1": {}, "variant 3": {} });
    expect(newVariantName(draft, label)).toBe("variant 4");
    expect(newVariantName([], label)).toBe("variant 1");
  });

  it("reports the first problem a save would hit", () => {
    const base = (name: string, keys: string[]): DraftVariant => ({
      id: Math.random(),
      original: null,
      name,
      inputs: keys.map((key, index) => ({ id: index, key, value: "x" })),
    });
    expect(draftProblem([base("a", ["k"])])).toBeNull();
    expect(draftProblem([base("  ", [])])).toBe("nameRequired");
    expect(draftProblem([base("a", []), base(" a", [])])).toBe("nameTaken");
    expect(draftProblem([base("a", [""])])).toBe("keyInvalid");
    expect(draftProblem([base("a", ["x=y"])])).toBe("keyInvalid");
    expect(draftProblem([base("a", ["k", " k "])])).toBe("keyTaken");
  });

  it("follows a renamed selection and drops a removed one", () => {
    const draft: DraftVariant[] = [
      { id: 1, original: "final", name: "camera-ready", inputs: [] },
      { id: 2, original: null, name: "new", inputs: [] },
    ];
    expect(selectionAfterSave(draft, "final")).toBe("camera-ready");
    expect(selectionAfterSave(draft, "draft")).toBeNull();
    expect(selectionAfterSave(draft, null)).toBeNull();
  });
});
