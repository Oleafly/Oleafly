export type LintConfigValue = boolean | null;
export type LintConfig = Record<string, LintConfigValue>;

export interface LintProfileRule {
  rule: string;
  reason: string;
  example: string;
}

export const ACADEMIC_PROFILE_RULES: readonly LintProfileRule[] = [
  {
    rule: "Spaces",
    reason:
      "Collapses repeated spaces, which the prose mask leaves wherever markup was blanked out.", example: "\"two  spaces\" becomes \"two spaces\"",
  },
  {
    rule: "NoFrenchSpaces",
    reason:
      "Removes the space before punctuation that French typography uses.", example: "\"Really?  Yes.\" loses the second space after the question mark",
  },
  {
    rule: "TransposedSpace",
    reason:
      "Moves a space that sits on the wrong side of punctuation, which masking often produces.", example: "\"wor dhere\" becomes \"word here\"",
  },
  {
    rule: "ExpandMemoryShorthands",
    reason: "Wants KB and MB spelled out.", example: "\"8 kB\" becomes \"8 kilobytes\"",
  },
  {
    rule: "ExpandTimeShorthands",
    reason: "Wants min and sec spelled out.", example: "\"5 min\" becomes \"5 minutes\"",
  },
  {
    rule: "ExpandStandardInputAndOutput",
    reason: "Wants stdin and stdout spelled out.", example: "\"stdin\" becomes \"standard input\"",
  },
  { rule: "ExpandAlgorithm", reason: "Wants algo spelled out.", example: "\"the algo\" becomes \"the algorithm\"" },
  { rule: "ExpandArgument", reason: "Wants arg spelled out.", example: "\"the arg\" becomes \"the argument\"" },
  { rule: "ExpandParameter", reason: "Wants param spelled out.", example: "\"the param\" becomes \"the parameter\"" },
  { rule: "ExpandCoordinate", reason: "Wants coord spelled out.", example: "\"each coord\" becomes \"each coordinate\"" },
  {
    rule: "MoreAdjective",
    reason: "Prefers the comparative form over more plus an adjective.", example: "\"more tall\" becomes \"taller\"",
  },
  {
    rule: "AvoidContractions",
    reason: "Asks you to write out every contraction.", example: "\"isn't\" becomes \"is not\"",
  },
  {
    rule: "LongSentences",
    reason: "Flags any sentence past its length limit.", example: "flags any sentence of 41 words or more",
  },
  {
    rule: "Hedging",
    reason:
      "Flags hedging phrases such as I would argue that and to a certain degree.", example: "flags \"I would argue that the method works\"",
  },
  { rule: "FillerWords", reason: "Flags words it counts as filler.", example: "flags a word that pads a sentence without adding meaning" },
  { rule: "BoringWords", reason: "Asks for a livelier word.", example: "flags an overused word and suggests a livelier one" },
  {
    rule: "DiscourseMarkers",
    reason:
      "Flags a sentence that opens with a marker such as however and leaves out the comma after it.", example: "\"However the method fails\" becomes \"However, the method fails\"",
  },
  {
    rule: "ExplainLikeImFive",
    reason: "Expands an initialism into its full words.", example: "\"ELI5\" becomes \"explain like I'm five\"",
  },
  {
    rule: "SplitWords",
    reason: "Splits a word that should be two, such as alot.", example: "\"alot\" becomes \"a lot\"",
  },
  {
    rule: "MergeWords",
    reason: "Joins a word that a stray space split in two, such as to gether.", example: "\"to gether\" becomes \"together\"",
  },
  {
    rule: "CompoundNouns",
    reason: "Joins a compound noun that was written as two words.", example: "\"data base\" becomes \"database\"",
  },
  { rule: "OxfordComma", reason: "Requires the serial comma.", example: "\"red, green and blue\" becomes \"red, green, and blue\"" },
  { rule: "NoOxfordComma", reason: "Removes the serial comma.", example: "\"red, green, and blue\" becomes \"red, green and blue\"" },
  {
    rule: "Dashes",
    reason: "Replaces a typed -- or --- with the proper dash character.", example: "\"--\" becomes an en dash and \"---\" an em dash",
  },
  {
    rule: "EllipsisLength",
    reason: "Fixes an ellipsis that is not three dots.", example: "\"..\" becomes \"...\"",
  },
  {
    rule: "NumericRangeEnDash",
    reason: "Wants an en dash between the ends of a number range.", example: "\"pages 12-14\" gets an en dash instead of the hyphen",
  },
  {
    rule: "SentenceCapitalization",
    reason:
      "Capitalizes the first word of a sentence, including one that starts after masked markup.", example: "\"It works. and then\" becomes \"It works. And then\"",
  },
];

export const ACADEMIC_DISABLED_RULES: readonly string[] =
  ACADEMIC_PROFILE_RULES.map((entry) => entry.rule);

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
