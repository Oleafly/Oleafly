export const WRITING_PROFILE_IDS = ["auto", "general", "cvpr"] as const;
export type WritingProfileId = (typeof WRITING_PROFILE_IDS)[number];
export type ResolvedWritingProfile = Exclude<WritingProfileId, "auto">;

export interface CustomWritingRule {
  readonly id: string;
  readonly find: string;
  readonly replace: string | null;
  readonly wholeWord: boolean;
  readonly caseSensitive: boolean;
  readonly note?: string;
}

export interface WritingSettings {
  readonly underlines: boolean;
  readonly profile: WritingProfileId;
  readonly disabled: readonly string[];
  readonly ignored: readonly string[];
  readonly rules: readonly CustomWritingRule[];
}

export const DEFAULT_WRITING_SETTINGS: WritingSettings = {
  underlines: true,
  profile: "auto",
  disabled: [],
  ignored: [],
  rules: [],
};

export const WRITING_SETTINGS_LIMITS = {
  rules: 200,
  disabled: 200,
  ignored: 2000,
  text: 200,
  id: 64,
} as const;

const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function shortText(value: unknown, limit: number = WRITING_SETTINGS_LIMITS.text): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 && value.length <= limit ? value : null;
}

function textList(value: unknown, limit: number, itemLimit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = shortText(item, itemLimit);
    if (text !== null) seen.add(text);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

function customRule(value: unknown): CustomWritingRule | null {
  const entry = record(value);
  if (!entry) return null;
  const id = typeof entry.id === "string" && RULE_ID.test(entry.id) ? entry.id : null;
  const find = shortText(entry.find);
  if (!id || !find || find.trim().length === 0) return null;
  const replace = entry.replace === null || entry.replace === undefined ? null : typeof entry.replace === "string" && entry.replace.length <= WRITING_SETTINGS_LIMITS.text ? entry.replace : null;
  const note = shortText(entry.note);
  return {
    id,
    find,
    replace,
    wholeWord: entry.whole_word !== false,
    caseSensitive: entry.case_sensitive !== false,
    ...(note ? { note } : {}),
  };
}

export function parseWritingSettings(value: unknown): WritingSettings {
  const entry = record(value);
  if (!entry) return DEFAULT_WRITING_SETTINGS;
  const profile = WRITING_PROFILE_IDS.find((id) => id === entry.profile) ?? "auto";
  const rules: CustomWritingRule[] = [];
  const ids = new Set<string>();
  if (Array.isArray(entry.rules)) {
    for (const item of entry.rules) {
      const rule = customRule(item);
      if (!rule || ids.has(rule.id)) continue;
      ids.add(rule.id);
      rules.push(rule);
      if (rules.length >= WRITING_SETTINGS_LIMITS.rules) break;
    }
  }
  return {
    underlines: entry.underlines !== false,
    profile,
    disabled: textList(entry.disabled, WRITING_SETTINGS_LIMITS.disabled, WRITING_SETTINGS_LIMITS.id),
    ignored: textList(entry.ignored, WRITING_SETTINGS_LIMITS.ignored, WRITING_SETTINGS_LIMITS.text),
    rules,
  };
}

export function serializeWritingSettings(settings: WritingSettings): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (!settings.underlines) out.underlines = false;
  if (settings.profile !== "auto") out.profile = settings.profile;
  if (settings.disabled.length > 0) out.disabled = [...settings.disabled];
  if (settings.ignored.length > 0) out.ignored = [...settings.ignored];
  if (settings.rules.length > 0) {
    out.rules = settings.rules.map((rule) => ({
      id: rule.id,
      find: rule.find,
      replace: rule.replace,
      ...(rule.wholeWord ? {} : { whole_word: false }),
      ...(rule.caseSensitive ? {} : { case_sensitive: false }),
      ...(rule.note ? { note: rule.note } : {}),
    }));
  }
  return Object.keys(out).length > 0 ? out : null;
}

const CVPR_FAMILY = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{(?:cvpr|iccv|eccv|wacv|3dv)\}|\\def\\cvprPaperID\b|\\def\\iccvPaperID\b/;

export function detectWritingProfile(texts: readonly string[]): ResolvedWritingProfile {
  return texts.some((text) => CVPR_FAMILY.test(text)) ? "cvpr" : "general";
}

export function resolveWritingProfile(settings: WritingSettings, texts: readonly string[]): ResolvedWritingProfile {
  return settings.profile === "auto" ? detectWritingProfile(texts) : settings.profile;
}

export function nextCustomRuleId(settings: WritingSettings, seed = Date.now()): string {
  const taken = new Set(settings.rules.map((rule) => rule.id));
  let counter = settings.rules.length + 1;
  let id = `rule-${counter}`;
  while (taken.has(id)) {
    counter += 1;
    id = `rule-${counter}-${(seed % 1000).toString(36)}`;
  }
  return id;
}
