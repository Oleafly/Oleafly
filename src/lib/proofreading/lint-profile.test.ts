import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalLinter } from "harper.js";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { binaryInlined as binary } from "harper.js/binaryInlined";
import {
  ACADEMIC_DISABLED_RULES,
  ACADEMIC_PROFILE_RULES,
  buildLintConfig,
  isLintRuleName,
  lintConfigFingerprint,
  sanitizeLintRuleNames,
} from "./lint-profile";

describe("buildLintConfig", () => {
  it("turns off every rule in the academic profile", () => {
    const config = buildLintConfig();
    for (const rule of ACADEMIC_DISABLED_RULES) {
      expect(config[rule], rule).toBe(false);
    }
    expect(Object.keys(config)).toHaveLength(
      ACADEMIC_DISABLED_RULES.length,
    );
  });

  it("turns a profile rule back on when the writer asks for it", () => {
    const config = buildLintConfig([], ["LongSentences"]);
    expect(config.LongSentences).toBe(true);
    expect(config.Hedging).toBe(false);
  });

  it("turns off a rule the writer dismissed from a card", () => {
    const config = buildLintConfig(["AnA"], []);
    expect(config.AnA).toBe(false);
  });

  it("lets a disabled rule win over the same rule enabled", () => {
    expect(
      buildLintConfig(["LongSentences"], ["LongSentences"]).LongSentences,
    ).toBe(false);
  });

  it("drops names the installed Harper does not have instead of throwing", () => {
    const config = buildLintConfig(
      ["RuleFromAnOlderRelease"],
      ["AlsoGone"],
      ["Spaces", "AnA"],
    );
    expect(config).toEqual({ Spaces: false });
  });

  it("ignores values that are not rule names", () => {
    const config = buildLintConfig(
      ["has space", "", "a".repeat(120), "9Leading"],
      [],
    );
    expect(Object.keys(config)).toEqual([...ACADEMIC_DISABLED_RULES]);
  });

  it("fingerprints the same config identically regardless of key order", () => {
    expect(lintConfigFingerprint({ B: false, A: true })).toBe(
      lintConfigFingerprint({ A: true, B: false }),
    );
    expect(lintConfigFingerprint({ A: true })).not.toBe(
      lintConfigFingerprint({ A: false }),
    );
  });
});

describe("sanitizeLintRuleNames", () => {
  it("sorts, de-duplicates, and drops anything that is not a rule name", () => {
    expect(
      sanitizeLintRuleNames(["Zeta", "Alpha", "Alpha", 7, "bad name", null]),
    ).toEqual(["Alpha", "Zeta"]);
  });

  it("returns nothing for a value that is not a list", () => {
    expect(sanitizeLintRuleNames("Alpha")).toEqual([]);
    expect(sanitizeLintRuleNames(undefined)).toEqual([]);
  });

  it("accepts the rule names Harper actually ships", () => {
    for (const rule of ACADEMIC_DISABLED_RULES) {
      expect(isLintRuleName(rule), rule).toBe(true);
    }
  });
});

describe("the academic profile against the installed Harper", () => {
  let linter: LocalLinter;

  beforeAll(async () => {
    linter = new LocalLinter({ binary });
    await linter.setup();
  });

  afterAll(() => {
    linter.dispose?.();
  });

  it("names only rules the installed Harper knows", async () => {
    const descriptions = await linter.getLintDescriptions();
    for (const { rule, example } of ACADEMIC_PROFILE_RULES) {
      expect(descriptions[rule], rule).toBeTruthy();
      expect(enSettings.proofreading.profileRules.reasons[rule].trim().length, rule).toBeGreaterThan(0);
      expect(example.trim().length, rule).toBeGreaterThan(0);
    }
  });

  it("describes the split and merge rules the way Harper applies them", async () => {
    const split = await linter.lint("I like it alot.");
    const merged = await linter.lint("We went to gether.");
    expect(split.some((lint) => lint.lint_kind_pretty() === "SplitWords" || lint.get_problem_text() === "alot")).toBe(true);
    expect(merged.some((lint) => lint.get_problem_text().includes("to gether"))).toBe(true);
  });
});
