import { describe, expect, it } from "vitest";
import {
  ACADEMIC_DISABLED_RULES,
  buildLintConfig,
  lintConfigFingerprint,
  sanitizeLintRuleNames,
} from "./lint-profile";

describe("lint rule names without Harper", () => {
  it("stops collecting at the limit", () => {
    expect(sanitizeLintRuleNames(["Gamma", "Alpha", "Beta", "Delta"], 2)).toEqual(["Alpha", "Gamma"]);
  });

  it("keeps the writer's choices over the profile and the panicking rules off", () => {
    const config = buildLintConfig(["SpellCheck", "bad name"], ["Spaces", "BoringWords"], [
      "Spaces",
      "SpellCheck",
      "BoringWords",
    ]);
    expect(config).toEqual({ Spaces: true, SpellCheck: false, BoringWords: false });
    expect(Object.keys(buildLintConfig())).toEqual([...ACADEMIC_DISABLED_RULES, "BoringWords"]);
    expect(lintConfigFingerprint(config)).toBe("BoringWords=0,Spaces=1,SpellCheck=0");
  });
});
