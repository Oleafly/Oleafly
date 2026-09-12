export type LintConfigValue = boolean | null;
export type LintConfig = Record<string, LintConfigValue>;

export interface LintProfileRule {
  rule: string;
  example: string;
}

export const ACADEMIC_PROFILE_RULES = [
  { rule: "Spaces", example: "\"two  spaces\" becomes \"two spaces\"" },
  { rule: "NoFrenchSpaces", example: "\"Really?  Yes.\" loses the second space after the question mark" },
  { rule: "TransposedSpace", example: "\"wor dhere\" becomes \"word here\"" },
  { rule: "ExpandMemoryShorthands", example: "\"8 kB\" becomes \"8 kilobytes\"" },
  { rule: "ExpandTimeShorthands", example: "\"5 min\" becomes \"5 minutes\"" },
  { rule: "ExpandStandardInputAndOutput", example: "\"stdin\" becomes \"standard input\"" },
  { rule: "ExpandAlgorithm", example: "\"the algo\" becomes \"the algorithm\"" },
  { rule: "ExpandArgument", example: "\"the arg\" becomes \"the argument\"" },
  { rule: "ExpandParameter", example: "\"the param\" becomes \"the parameter\"" },
  { rule: "ExpandCoordinate", example: "\"each coord\" becomes \"each coordinate\"" },
  { rule: "MoreAdjective", example: "\"more tall\" becomes \"taller\"" },
  { rule: "AvoidContractions", example: "\"isn't\" becomes \"is not\"" },
  { rule: "LongSentences", example: "flags any sentence of 41 words or more" },
  { rule: "Hedging", example: "flags \"I would argue that the method works\"" },
  { rule: "FillerWords", example: "flags a word that pads a sentence without adding meaning" },
  { rule: "BoringWords", example: "flags an overused word and suggests a livelier one" },
  { rule: "DiscourseMarkers", example: "\"However the method fails\" becomes \"However, the method fails\"" },
  { rule: "ExplainLikeImFive", example: "\"ELI5\" becomes \"explain like I'm five\"" },
  { rule: "SplitWords", example: "\"alot\" becomes \"a lot\"" },
  { rule: "MergeWords", example: "\"to gether\" becomes \"together\"" },
  { rule: "CompoundNouns", example: "\"data base\" becomes \"database\"" },
  { rule: "OxfordComma", example: "\"red, green and blue\" becomes \"red, green, and blue\"" },
  { rule: "NoOxfordComma", example: "\"red, green, and blue\" becomes \"red, green and blue\"" },
  { rule: "Dashes", example: "\"--\" becomes an en dash and \"---\" an em dash" },
  { rule: "EllipsisLength", example: "\"..\" becomes \"...\"" },
  { rule: "NumericRangeEnDash", example: "\"pages 12-14\" gets an en dash instead of the hyphen" },
  { rule: "SentenceCapitalization", example: "\"It works. and then\" becomes \"It works. And then\"" },
] as const satisfies readonly LintProfileRule[];

export type AcademicProfileRule = (typeof ACADEMIC_PROFILE_RULES)[number]["rule"];

export const ACADEMIC_DISABLED_RULES: readonly string[] =
  ACADEMIC_PROFILE_RULES.map((entry) => entry.rule);

export const LINT_RULE_NAME_PATTERN = /^[A-Za-z]\w{0,63}$/u;

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
