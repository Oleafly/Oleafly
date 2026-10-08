export const SETTINGS_SEARCH_SECTIONS = [
  "general",
  "appearance",
  "dictionary",
  "data",
  "ai",
  "engine",
  "downloads",
  "integrations",
  "shortcuts",
  "experimentation",
  "developer",
  "help",
] as const;

export type SettingsSearchSection = (typeof SETTINGS_SEARCH_SECTIONS)[number];

export type CatalogPath = readonly [namespace: string, ...keys: string[]];

const keywords = (section: SettingsSearchSection): CatalogPath => [
  "shell",
  "settings",
  "search",
  "keywords",
  section,
];

export const SETTINGS_SEARCH_SOURCES: Readonly<Record<SettingsSearchSection, readonly CatalogPath[]>> = {
  general: [
    ["shell", "settings", "general"],
    ["shell", "settings", "tours"],
    ["settings", "language"],
    ["settings", "systemIntegration"],
    ["settings", "shellCommand"],
    keywords("general"),
  ],
  appearance: [
    ["settings", "appearance"],
    // Cookie import sits with the in-app browser settings.
    ["settings", "integrations", "cookies"],
    keywords("appearance"),
  ],
  dictionary: [["settings", "proofreading"], keywords("dictionary")],
  data: [["shell", "settings", "data"], ["settings", "checkpoints"], keywords("data")],
  ai: [
    ["settings", "ai"],
    // The assistant's own MCP servers, on the AI section's MCP tab.
    ["settings", "mcp", "servers"],
    ["settings", "mcp", "registry"],
    ["settings", "mcp", "import"],
    keywords("ai"),
  ],
  engine: [["settings", "engine"], keywords("engine")],
  downloads: [["settings", "downloads"], keywords("downloads")],
  integrations: [
    ["settings", "integrations", "actions"],
    ["settings", "integrations", "alphaxiv"],
    ["settings", "integrations", "zotero"],
    ["settings", "github"],
    ["settings", "citations"],
    // The Oleafly MCP server that other apps connect to.
    ["settings", "mcp", "section"],
    keywords("integrations"),
  ],
  shortcuts: [["settings", "shortcuts"], keywords("shortcuts")],
  experimentation: [["shell", "settings", "experimentation"], keywords("experimentation")],
  developer: [["core", "developer"]],
  help: [["shell", "settings", "help"], ["settings", "cite"], keywords("help")],
};

export const SETTINGS_SEARCH_EXCLUDED: readonly CatalogPath[] = [
  ["settings", "reset"],
  ["shell", "settings", "nav"],
  ["shell", "settings", "close"],
  ["shell", "settings", "footer"],
  ["shell", "settings", "sectionsNav"],
  ["shell", "settings", "title"],
  ["shell", "settings", "search"],
];

/**
 * The sub-tab each row lives on, by catalog path below the namespace, where
 * the row's keys do not name the tab. The longest matching prefix wins. Rows
 * not listed here open a tab one of their keys names, if any. Rows on a
 * section's default tab are listed too, so they open from any other tab.
 */
export const SETTINGS_SEARCH_TABS: Readonly<Record<string, string>> = {
  "appearance.customTheme": "app",
  "appearance.preview": "pdf",
  "appearance.zen": "app",
  "integrations.cookies": "browser",
  "shortcuts.actions": "application",
  "shortcuts.editorKeys": "editor",
  "downloads.fontPacks": "fonts",
  "mcp.servers": "mcp",
  "mcp.section": "oleafly-mcp",
  "engine.defaultEngine": "latex",
  "engine.choices": "latex",
  "engine.distributions": "latex",
  "engine.packages": "latex",
  "engine.tagging": "latex",
  "ai.approvals": "providers",
  "ai.budget": "providers",
  "ai.models": "providers",
  "settings.data.storage": "local",
  "settings.data.recycleBin": "local",
  "settings.data.danger": "local",
  checkpoints: "local",
};

export type SettingsSearchPlatform = "macos" | "windows" | "linux";

/** Rows the app shows on one platform only, by catalog path below the namespace. */
const PLATFORM_ROWS: Readonly<Record<string, SettingsSearchPlatform>> = {
  "systemIntegration.quickAction": "macos",
  "systemIntegration.explorerMenu": "windows",
  "systemIntegration.dolphin": "linux",
  "systemIntegration.nemo": "linux",
  "systemIntegration.nautilus": "linux",
  "systemIntegration.folderOpenWith": "linux",
};

/**
 * Flows a button opens, such as a picker or an import dialog. Their titles are
 * not on the page until then, so they are not rows, but their words still find
 * the section.
 */
const FLOW_PATHS: ReadonlySet<string> = new Set(["mcp.import", "mcp.registry"]);

const SKIPPED_KEY_WORDS = new Set(["aria", "error", "errors", "failed", "toast", "confirm"]);
/** Subtrees that are dialogs, sign-in steps or empty states, not rows on the page. */
const NOT_A_ROW_KEY_WORDS = new Set(["dialog", "device", "empty"]);
const ROW_LABEL_KEYS = ["label", "title", "heading", "name"] as const;
const MAX_ROWS_PER_SECTION = 3;

/** Scripts written without spaces between words, where a match inside a word is still a word match. */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export type SettingsSearchMatch = "title" | "row" | "keyword" | "text";

const MATCH_RANK: Readonly<Record<SettingsSearchMatch, number>> = { title: 0, row: 1, keyword: 2, text: 3 };

export interface SettingsSearchRowHit {
  label: string;
  /** Catalog keys below the namespace, e.g. ["appearance", "editor", "fontSize"]. */
  path: readonly string[];
}

export interface SettingsSearchRow extends SettingsSearchRowHit {
  labelText: string;
  text: string;
}

export interface SettingsSearchEntry {
  text: string;
  /** The section's own search keywords, normalized. */
  keywords: string;
  rows: SettingsSearchRow[];
}

export type SettingsSearchIndex = ReadonlyMap<SettingsSearchSection, SettingsSearchEntry>;

export type CatalogLookup = (path: CatalogPath) => unknown;

export interface SettingsSearchHit<Id extends string = string> {
  id: Id;
  rows: SettingsSearchRowHit[];
  /** What matched: the section title, a row label, the section keywords or other text. */
  match?: SettingsSearchMatch;
}

export function normalizeSearchText(value: string, locale?: string): string {
  let lowered: string;
  try {
    lowered = value.toLocaleLowerCase(locale);
  } catch {
    lowered = value.toLowerCase();
  }
  return lowered.normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim();
}

export function cleanCatalogText(value: string): string {
  let text = value.replace(/\{\{[^{}]*\}\}/g, " ");
  // Repeat until nothing changes: one pass can leave a tag behind
  // ("<scr<b>ipt>" becomes "<script>").
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<\/?[A-Za-z][\w-]*\s*\/?>/g, "");
  } while (text !== previous);
  return text.replace(/\s+/g, " ").trim();
}

function keyHasWord(key: string, words: ReadonlySet<string>): boolean {
  return key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_]+/)
    .some((word) => words.has(word));
}

function isSkippedKey(key: string): boolean {
  return keyHasWord(key, SKIPPED_KEY_WORDS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A dialog, flow, sign-in step or empty state: its title is never a row on the page. */
function isTransient(node: Record<string, unknown>, path: readonly string[]): boolean {
  const key = path.at(-1) ?? "";
  return (
    keyHasWord(key, NOT_A_ROW_KEY_WORDS) ||
    typeof node.confirm === "string" ||
    FLOW_PATHS.has(path.join("."))
  );
}

function onOtherPlatform(path: readonly string[], platform: SettingsSearchPlatform): boolean {
  const only = PLATFORM_ROWS[path.join(".")];
  return only !== undefined && only !== platform;
}

function rowLabel(node: Record<string, unknown>): string | null {
  for (const key of ROW_LABEL_KEYS) {
    const value = node[key];
    if (typeof value === "string" && !value.includes("{{")) {
      const label = cleanCatalogText(value);
      if (label) return label;
    }
  }
  return null;
}

interface IndexContext {
  locale: string;
  platform: SettingsSearchPlatform;
}

/** `path` is the catalog path below the namespace. */
function collectText(
  node: unknown,
  path: readonly string[],
  out: string[],
  platform: SettingsSearchPlatform,
): void {
  if (isSkippedKey(path.at(-1) ?? "") || onOtherPlatform(path, platform)) return;
  if (typeof node === "string") {
    const text = cleanCatalogText(node);
    if (text) out.push(text);
    return;
  }
  if (!isRecord(node)) return;
  for (const [childKey, child] of Object.entries(node)) {
    collectText(child, [...path, childKey], out, platform);
  }
}

function collectRows(
  node: unknown,
  path: readonly string[],
  rows: SettingsSearchRow[],
  context: IndexContext,
): void {
  const { locale, platform } = context;
  if (
    !isRecord(node) ||
    isSkippedKey(path.at(-1) ?? "") ||
    onOtherPlatform(path, platform) ||
    isTransient(node, path)
  ) {
    return;
  }
  const label = rowLabel(node);
  if (label) {
    const parts: string[] = [];
    collectText(node, path, parts, platform);
    rows.push({
      label,
      path,
      labelText: normalizeSearchText(label, locale),
      text: normalizeSearchText(parts.join("\n"), locale),
    });
  }
  for (const [childKey, child] of Object.entries(node)) {
    collectRows(child, [...path, childKey], rows, context);
  }
}

/** Builds the index for one locale, leaving out rows other platforms show. */
export function buildSettingsIndex(
  lookup: CatalogLookup,
  locale: string,
  platform: SettingsSearchPlatform,
): SettingsSearchIndex {
  const index = new Map<SettingsSearchSection, SettingsSearchEntry>();
  for (const section of SETTINGS_SEARCH_SECTIONS) {
    const parts: string[] = [];
    const rows: SettingsSearchRow[] = [];
    for (const path of SETTINGS_SEARCH_SOURCES[section]) {
      const node = lookup(path);
      collectText(node, path.slice(1), parts, platform);
      collectRows(node, path.slice(1), rows, { locale, platform });
    }
    const sectionKeywords = lookup(keywords(section));
    index.set(section, {
      text: normalizeSearchText(parts.join("\n"), locale),
      keywords: typeof sectionKeywords === "string" ? normalizeSearchText(sectionKeywords, locale) : "",
      rows,
    });
  }
  return index;
}

/** The sub-tab a row lives on when its keys do not name it, or null. */
export function settingsTabFor(path: readonly string[]): string | null {
  for (let length = path.length; length > 0; length -= 1) {
    const tab = SETTINGS_SEARCH_TABS[path.slice(0, length).join(".")];
    if (tab !== undefined) return tab;
  }
  return null;
}

export function searchTerms(query: string, locale?: string): string[] {
  return normalizeSearchText(query, locale).split(" ").filter(Boolean);
}

function characterBefore(text: string, index: number): string {
  // At a low surrogate codePointAt returns that unit alone, so this asks
  // whether the unit before `index` is a low surrogate, the end of a pair.
  const code = text.codePointAt(index - 1) ?? 0;
  const pair = code >= 0xdc00 && code <= 0xdfff && index >= 2;
  return text.slice(pair ? index - 2 : index - 1, index);
}

/**
 * True when the term starts a word in the text, so "ai" finds "AI budget"
 * but not "install". Text in scripts written without spaces matches anywhere.
 */
function startsWord(text: string, term: string): boolean {
  const unspacedTerm = UNSPACED_SCRIPT.test(String.fromCodePoint(term.codePointAt(0) ?? 0));
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    if (at === 0 || unspacedTerm) return true;
    const before = characterBefore(text, at);
    if (!WORD_CHARACTER.test(before) || UNSPACED_SCRIPT.test(before)) return true;
  }
  return false;
}

function matchesAll(text: string, terms: readonly string[]): boolean {
  return terms.every((term) => startsWord(text, term));
}

function matchingRows(
  entry: SettingsSearchEntry,
  terms: readonly string[],
): { rows: SettingsSearchRowHit[]; byLabel: boolean } {
  const byLabel: SettingsSearchRowHit[] = [];
  const byText: SettingsSearchRowHit[] = [];
  const seen = new Set<string>();
  for (const { label, path, labelText, text } of entry.rows) {
    if (seen.has(label)) continue;
    if (matchesAll(labelText, terms)) {
      seen.add(label);
      byLabel.push({ label, path });
    } else if (matchesAll(text, terms)) {
      seen.add(label);
      byText.push({ label, path });
    }
  }
  return { rows: [...byLabel, ...byText].slice(0, MAX_ROWS_PER_SECTION), byLabel: byLabel.length > 0 };
}

/** Hits come back in the order of `sections`; use bestSettingsHit to pick one to open. */
export function searchSettings<Id extends string>(
  index: SettingsSearchIndex,
  sections: readonly { id: Id; label: string }[],
  query: string,
  locale?: string,
): SettingsSearchHit<Id>[] {
  const terms = searchTerms(query, locale);
  if (terms.length === 0) return sections.map(({ id }) => ({ id, rows: [] }));
  const hits: SettingsSearchHit<Id>[] = [];
  for (const { id, label } of sections) {
    const entry = index.get(id as SettingsSearchSection);
    const title = normalizeSearchText(label, locale);
    if (matchesAll(title, terms)) {
      hits.push({ id, rows: [], match: "title" });
      continue;
    }
    if (!entry || !matchesAll(`${title}\n${entry.text}`, terms)) continue;
    const { rows, byLabel } = matchingRows(entry, terms);
    let match: SettingsSearchMatch = "text";
    if (byLabel) match = "row";
    else if (matchesAll(`${title}\n${entry.keywords}`, terms)) match = "keyword";
    hits.push({ id, rows, match });
  }
  return hits;
}

/**
 * The section to open for a search: a title match first, then a row label,
 * then the section keywords, then any other text. Ties go to `current` when
 * it is one of them, and otherwise to the first in list order.
 */
export function bestSettingsHit<Id extends string>(
  hits: readonly SettingsSearchHit<Id>[],
  current?: Id,
): Id | null {
  const rank = (hit: SettingsSearchHit<Id>) => MATCH_RANK[hit.match ?? "text"];
  let best: SettingsSearchHit<Id> | null = null;
  for (const hit of hits) {
    if (!best || rank(hit) < rank(best)) best = hit;
  }
  if (!best) return null;
  const open = hits.find((hit) => hit.id === current);
  return open && rank(open) === rank(best) ? open.id : best.id;
}

export function matchSettingsSections<Id extends string>(
  index: SettingsSearchIndex,
  sections: readonly { id: Id; label: string }[],
  query: string,
  locale?: string,
): Id[] {
  return searchSettings(index, sections, query, locale).map((hit) => hit.id);
}
