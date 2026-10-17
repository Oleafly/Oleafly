import { describe, expect, it } from "vitest";
import { familyNames } from "./ranking";

describe("familyNames", () => {
  it("splits authors on any whitespace around and, in any case", () => {
    expect(familyNames("Doe, Jane\n and\tRoe, Kim AND  Max  van  Berg")).toEqual(["Doe", "Roe", "Berg"]);
  });

  it("has no names without an author", () => {
    expect(familyNames(undefined)).toEqual([]);
  });
});
