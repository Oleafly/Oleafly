import { describe, expect, it } from "vitest";
import { texDistributionNames } from "./tex-distributions";

describe("texDistributionNames", () => {
  it("names only the distributions each platform has", () => {
    expect(texDistributionNames(true, false)).toEqual(["MacTeX", "TeX Live", "TinyTeX"]);
    expect(texDistributionNames(false, true)).toEqual(["TeX Live", "MiKTeX", "TinyTeX"]);
    expect(texDistributionNames(false, false)).toEqual(["TeX Live", "TinyTeX"]);
  });
});
