import type { Finding } from "../types";
import { CONSISTENCY_WRITING_RULES } from "./consistency";
import { collectMacroTexts, type MacroText } from "./macros";
import { openPromiseRule } from "./promises";
import { commentFree, proseView } from "./prose";
import { resultsBest } from "./results-tables";
import { reviewPointRule } from "./reviews";
import { customRuleFindings, rulesForProfile, type WritingRule } from "./rules";
import {
  DEFAULT_WRITING_SETTINGS,
  detectWritingProfile,
  type ResolvedWritingProfile,
  type WritingSettings,
} from "./settings";

export * from "./settings";
export * from "./macros";
export { proseView, isProse, type ProseView } from "./prose";
export { notationEntries, type NotationEntry } from "./consistency";
export { collectLabels, splitSentences, trimQuote, type TextSpan } from "./promises";
export {
  isReviewsFile,
  paperPlaces,
  reviewPoints,
  reviewReferences,
  type PaperPlace,
  type PaperPlaceKind,
  type ReviewPoint,
  type ReviewReference,
  type ReviewReferenceKind,
} from "./reviews";
export {
  WRITING_RULE_IDS,
  writingFingerprint,
  writingFinding,
  customRuleMatches,
  customRulePattern,
  type WritingRuleId,
  type WritingRule,
  type WritingRun,
} from "./rules";

const MAX_FINDINGS = 500;

export interface WritingContext {
  readonly settings?: WritingSettings;
  readonly profile?: ResolvedWritingProfile;
  readonly macros?: readonly MacroText[];
}

export interface ProjectWritingFile {
  readonly path: string;
  readonly content: string;
}

export interface ProjectWritingContext {
  readonly settings: WritingSettings;
  readonly profile: ResolvedWritingProfile;
  readonly macros: readonly MacroText[];
  readonly mainFile: string;
}

export interface ProjectWritingRule {
  readonly id: string;
  readonly run: (files: readonly ProjectWritingFile[], context: ProjectWritingContext) => Finding[];
}

export const FILE_WRITING_RULES: WritingRule[] = [resultsBest];
export const PROJECT_WRITING_RULES: ProjectWritingRule[] = [...CONSISTENCY_WRITING_RULES, openPromiseRule, reviewPointRule];

function mergeMacros(first: readonly MacroText[], second: readonly MacroText[]): MacroText[] {
  const byName = new Map<string, MacroText>();
  for (const macro of [...first, ...second]) if (!byName.has(macro.name)) byName.set(macro.name, macro);
  return [...byName.values()];
}

function keep(findings: Finding[], settings: WritingSettings): Finding[] {
  const disabled = new Set(settings.disabled);
  const ignored = new Set(settings.ignored);
  return findings
    .filter((finding) => !disabled.has(finding.id) && !(finding.fingerprint && ignored.has(finding.fingerprint)))
    .sort((left, right) => (left.from ?? 0) - (right.from ?? 0))
    .slice(0, MAX_FINDINGS);
}

export function runWritingRules(text: string, context: WritingContext = {}): Finding[] {
  const settings = context.settings ?? DEFAULT_WRITING_SETTINGS;
  const view = proseView(text);
  const source = commentFree(text);
  const macros = mergeMacros(context.macros ?? [], collectMacroTexts([text]));
  const profile = context.profile ?? (settings.profile === "auto" ? detectWritingProfile([text]) : settings.profile);
  const disabled = new Set(settings.disabled);
  const run = { view, source, profile, macros };
  const findings: Finding[] = [];
  for (const rule of [...rulesForProfile(profile), ...FILE_WRITING_RULES.filter((rule) => rule.profiles.includes(profile))]) {
    if (!disabled.has(rule.id)) findings.push(...rule.run(run));
  }
  if (!disabled.has("writing-custom")) findings.push(...customRuleFindings(view, settings.rules));
  return keep(findings, settings);
}

export function runProjectWritingRules(files: readonly ProjectWritingFile[], context: ProjectWritingContext): Finding[] {
  if (PROJECT_WRITING_RULES.length === 0) return [];
  const disabled = new Set(context.settings.disabled);
  const findings: Finding[] = [];
  for (const rule of PROJECT_WRITING_RULES) {
    if (!disabled.has(rule.id)) findings.push(...rule.run(files, context));
  }
  return keep(findings, context.settings);
}

export function writingContextFor(texts: readonly string[], settings: WritingSettings = DEFAULT_WRITING_SETTINGS): { profile: ResolvedWritingProfile; macros: MacroText[] } {
  return {
    profile: settings.profile === "auto" ? detectWritingProfile(texts) : settings.profile,
    macros: collectMacroTexts(texts),
  };
}
