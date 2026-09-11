export type LintConfigValue = boolean | null;
export type LintConfig = Record<string, LintConfigValue>;

export const ACADEMIC_DISABLED_RULES: readonly string[] = [
  "Spaces",
  "NoFrenchSpaces",
  "TransposedSpace",
  "ExpandMemoryShorthands",
  "ExpandTimeShorthands",
  "ExpandStandardInputAndOutput",
  "ExpandAlgorithm",
  "ExpandArgument",
  "ExpandParameter",
  "ExpandCoordinate",
  "MoreAdjective",
  "AvoidContractions",
  "LongSentences",
  "Hedging",
  "FillerWords",
  "BoringWords",
  "DiscourseMarkers",
  "ExplainLikeImFive",
  "SplitWords",
  "MergeWords",
  "CompoundNouns",
  "OxfordComma",
  "NoOxfordComma",
  "Dashes",
  "EllipsisLength",
  "NumericRangeEnDash",
  "SentenceCapitalization",
];

export const LINT_RULE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

export function isLintRuleName(value: unknown): value is string {
  return typeof value === "string" && LINT_RULE_NAME_PATTERN.test(value);
}

export function sanitizeLintRuleNames(
  value: unknown,
  limit = 2_000,
): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isLintRuleName(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    if (seen.size >= limit) break;
  }
  return [...seen].sort((left, right) =>
    Number(left > right) - Number(left < right),
  );
}

export function buildLintConfig(
  userDisabled: readonly string[] = [],
  userEnabled: readonly string[] = [],
  knownRules?: readonly string[],
): LintConfig {
  const known = knownRules ? new Set(knownRules) : null;
  const config: LintConfig = {};
  const assign = (rule: string, value: boolean) => {
    if (!isLintRuleName(rule)) return;
    if (known && !known.has(rule)) return;
    config[rule] = value;
  };
  for (const rule of ACADEMIC_DISABLED_RULES) assign(rule, false);
  for (const rule of userEnabled) assign(rule, true);
  for (const rule of userDisabled) assign(rule, false);
  return config;
}

export function lintConfigFingerprint(config: LintConfig): string {
  return Object.keys(config)
    .sort((left, right) => Number(left > right) - Number(left < right))
    .map((rule) => `${rule}=${config[rule] === true ? "1" : "0"}`)
    .join(",");
}
