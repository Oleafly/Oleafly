import { describe, expect, it } from "vitest";
import { latexmkBlocked, latexmkUsable, texDistributionNames } from "./tex-distributions";

describe("texDistributionNames", () => {
  it("names only the distributions each platform has", () => {
    expect(texDistributionNames(true, false)).toEqual(["MacTeX", "TeX Live", "TinyTeX"]);
    expect(texDistributionNames(false, true)).toEqual(["TeX Live", "MiKTeX", "TinyTeX"]);
    expect(texDistributionNames(false, false)).toEqual(["TeX Live", "TinyTeX"]);
  });
});

describe("latexmk projects and PhiTeX", () => {
  const engine = { kind: "system" as const, lualatex: null, tlmgr: null, version: null, latexmk: "/test/latexmk" };
  const noTex = { ...engine, latexmk: null, latexmk_blocker: { code: "tex.latexmk_missing", params: {} } };

  it("counts an installed PhiTeX as a way to compile latexmk projects", () => {
    expect(latexmkUsable(engine)).toBe(true);
    expect(latexmkUsable(noTex)).toBe(false);
    expect(latexmkUsable({ ...noTex, phitex: "/test/phitex" })).toBe(true);
    expect(latexmkUsable(null)).toBe(false);
  });

  it("reports latexmk as blocked only when PhiTeX can't stand in", () => {
    expect(latexmkBlocked(noTex)).toBe(true);
    expect(latexmkBlocked({ ...noTex, phitex: "/test/phitex" })).toBe(false);
    expect(latexmkBlocked(engine)).toBe(false);
    expect(latexmkBlocked(null)).toBe(false);
  });
});
