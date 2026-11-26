import { escapeBodyText } from "./body";
import { applyHelper } from "./helpers";
import type { SnippetLanguage } from "./types";

export type SuggestionKind = "caption" | "label" | "cite" | "path" | "column-spec" | "number" | "title" | "table-body";

export interface FieldSuggestion {
  kind: SuggestionKind;
  from: number;
  to: number;
  text: string;
  linkedTo?: number;
  selected: boolean;
}

const SELECTED: Readonly<Record<SuggestionKind, boolean>> = {
  caption: true,
  label: true,
  cite: true,
  path: true,
  "column-spec": true,
  number: false,
  title: true,
  "table-body": false,
};

const OPTIONAL_ARG = String.raw`(?:\[[^\]]*\])`;
const LATEX_GROUPS: ReadonlyArray<readonly [SuggestionKind, RegExp]> = [
  ["caption", new RegExp(String.raw`\\caption\*?${OPTIONAL_ARG}?\{`, "gu")],
  ["title", new RegExp(String.raw`\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph|title)\*?${OPTIONAL_ARG}?\{`, "gu")],
  ["label", /\\label\{/gu],
  ["cite", new RegExp(String.raw`\\[A-Za-z]*cite[A-Za-z]*\*?${OPTIONAL_ARG}{0,2}\{`, "gu")],
  ["path", new RegExp(String.raw`\\includegraphics\*?${OPTIONAL_ARG}?\{`, "gu")],
  ["path", /\\(?:input|include)\{/gu],
];
const TABULAR = new RegExp(String.raw`\\begin\{(tabular|longtable|array)\}${OPTIONAL_ARG}?\{`, "gu");
const NUMBER = /(?<![\p{L}\p{N}_.\\])(?:\d+\.\d+|\.\d+|\d+)(?![\p{L}\p{N}_])/gu;
const RULE_START = /^\s*(?:\\toprule\b)?\s*/u;
const RULE_END = /\s*(?:\\bottomrule\b)?\s*$/u;
const LABEL_KEY = /^[\p{L}\p{N}_:.-]+$/u;
const TYPST_LABEL = /<([\p{L}\p{N}_:.-]+)>/dgu;
const TYPST_CITE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)/dgu;
const TYPST_CAPTION = /caption:\s*\[/gu;
const TYPST_IMAGE = /image\(\s*"([^"\n]*)"/dgu;
const TYPST_HEADING = /^=+[ \t]+(.+?)[ \t]*$/dgmu;
const MARKDOWN_IMAGE = /!\[([^\]\n]*)\]\(([^)\s]+)/dgu;
const MARKDOWN_CITE = /\[@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*)/dgu;
const MARKDOWN_LABEL = /\{#([\p{L}\p{N}_:.-]+)/dgu;
const MARKDOWN_HEADING = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/dgmu;
const IMAGE_CONTEXT = /(?:\\includegraphics\*?(?:\[[^\]]*\])?\{|image\(\s*"|\]\()$/u;

interface Draft {
  kind: SuggestionKind;
  from: number;
  to: number;
}

function closing(text: string, start: number, open: string, close: string): number {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === open) depth += 1;
    else if (char === close && --depth === 0) return index;
  }
  return -1;
}

function groups(text: string, pattern: RegExp, kind: SuggestionKind, open = "{", close = "}"): Draft[] {
  const drafts: Draft[] = [];
  for (const match of text.matchAll(pattern)) {
    const from = (match.index as number) + match[0].length;
    const to = closing(text, from, open, close);
    if (to > from) drafts.push({ kind, from, to });
  }
  return drafts;
}

function captured(text: string, pattern: RegExp, kind: SuggestionKind, group: number): Draft[] {
  const drafts: Draft[] = [];
  for (const match of text.matchAll(pattern)) {
    const span = match.indices?.[group];
    if (span && span[1] > span[0]) drafts.push({ kind, from: span[0], to: span[1] });
  }
  return drafts;
}

function trimKey(drafts: Draft[], text: string): Draft[] {
  return drafts.map((draft) => {
    let to = draft.to;
    while (to > draft.from && (text[to - 1] === "." || text[to - 1] === ":")) to -= 1;
    return { ...draft, to };
  });
}

function labelKeys(drafts: Draft[], text: string): Draft[] {
  return drafts.flatMap((draft) => {
    const content = text.slice(draft.from, draft.to);
    if (!LABEL_KEY.test(content)) return [];
    const colon = content.indexOf(":");
    return colon < 0 || colon === content.length - 1 ? [draft] : [{ ...draft, from: draft.from + colon + 1 }];
  });
}

function latexDrafts(text: string): { drafts: Draft[]; blocked: Draft[] } {
  const drafts = LATEX_GROUPS.flatMap(([kind, pattern]) => groups(text, pattern, kind));
  const labels = drafts.filter((draft) => draft.kind === "label");
  const others = drafts.filter((draft) => draft.kind !== "label");
  const bodies: Draft[] = [];
  for (const match of text.matchAll(TABULAR)) {
    const from = (match.index as number) + match[0].length;
    const to = closing(text, from, "{", "}");
    if (to <= from) continue;
    others.push({ kind: "column-spec", from, to });
    const end = text.indexOf(`\\end{${match[1]}}`, to);
    if (end < 0) continue;
    const inner = text.slice(to + 1, end);
    const start = to + 1 + (RULE_START.exec(inner)?.[0].length ?? 0);
    const stop = end - (RULE_END.exec(inner)?.[0].length ?? 0);
    if (stop > start) bodies.push({ kind: "table-body", from: start, to: stop });
  }
  const numbers = [...text.matchAll(NUMBER)].map((match): Draft => ({
    kind: "number",
    from: match.index as number,
    to: (match.index as number) + match[0].length,
  }));
  return { drafts: [...others, ...labelKeys(labels, text), ...bodies, ...numbers], blocked: bodies };
}

function typstDrafts(text: string): Draft[] {
  const cites = trimKey(captured(text, TYPST_CITE, "cite", 1), text).filter(
    (draft) => !text.slice(draft.from, draft.to).includes(":"),
  );
  return [
    ...groups(text, TYPST_CAPTION, "caption", "[", "]"),
    ...labelKeys(captured(text, TYPST_LABEL, "label", 1), text),
    ...cites,
    ...captured(text, TYPST_IMAGE, "path", 1),
    ...captured(text, TYPST_HEADING, "title", 1),
  ];
}

function markdownDrafts(text: string): Draft[] {
  return [
    ...captured(text, MARKDOWN_IMAGE, "caption", 1),
    ...captured(text, MARKDOWN_IMAGE, "path", 2),
    ...trimKey(captured(text, MARKDOWN_CITE, "cite", 1), text),
    ...labelKeys(captured(text, MARKDOWN_LABEL, "label", 1), text),
    ...captured(text, MARKDOWN_HEADING, "title", 1),
  ];
}

function linkable(key: string, caption: string): boolean {
  const slug = applyHelper("slug", caption);
  if (!key || !slug) return false;
  if (key.startsWith(slug)) return true;
  const words = new Set(slug.split("-"));
  return key
    .toLowerCase()
    .split(/[-_.]+/u)
    .filter((word) => word.length > 0)
    .every((word) => words.has(word));
}

function overlaps(a: Draft, b: Draft): boolean {
  return a.from < b.to && b.from < a.to;
}

export function suggestFields(text: string, language: SnippetLanguage): FieldSuggestion[] {
  let drafts: Draft[] = [];
  let blocked: Draft[] = [];
  if (language === "latex") ({ drafts, blocked } = latexDrafts(text));
  else if (language === "typst") drafts = typstDrafts(text);
  else if (language === "markdown" || language === "notes") drafts = markdownDrafts(text);
  const kept: Draft[] = [];
  for (const draft of drafts.sort((a, b) => a.from - b.from || b.to - a.to)) {
    if (draft.kind === "number" && blocked.some((body) => overlaps(body, draft))) continue;
    if (!kept.some((other) => overlaps(other, draft))) kept.push(draft);
  }
  let lastHeading: FieldSuggestion | null = null;
  return kept.map((draft) => {
    const suggestion: FieldSuggestion = {
      kind: draft.kind,
      from: draft.from,
      to: draft.to,
      text: text.slice(draft.from, draft.to),
      selected: SELECTED[draft.kind],
    };
    if (draft.kind === "label" && lastHeading && linkable(suggestion.text, lastHeading.text)) {
      suggestion.linkedTo = lastHeading.from;
    }
    if (draft.kind === "caption" || draft.kind === "title") lastHeading = suggestion;
    return suggestion;
  });
}

function fieldBody(text: string, suggestion: FieldSuggestion, index: number): string {
  const placeholder = escapeBodyText(suggestion.text, "placeholder");
  if (suggestion.kind === "cite") return `\${${index}@cite:${placeholder}}`;
  if (suggestion.kind === "path") {
    const kind = IMAGE_CONTEXT.test(text.slice(Math.max(0, suggestion.from - 200), suggestion.from)) ? "image" : "file";
    return `\${${index}@${kind}:${placeholder}}`;
  }
  return `\${${index}:${placeholder}}`;
}

export function bodyFromSelection(text: string, accepted: readonly FieldSuggestion[]): string {
  const sorted: FieldSuggestion[] = [];
  for (const suggestion of [...accepted].sort((a, b) => a.from - b.from)) {
    if (!sorted.some((other) => overlaps(other, suggestion))) sorted.push(suggestion);
  }
  const numbers = new Map<number, number>();
  const linked = (suggestion: FieldSuggestion) =>
    suggestion.linkedTo !== undefined && sorted.some((other) => other.from === suggestion.linkedTo && other !== suggestion);
  for (const suggestion of sorted) if (!linked(suggestion)) numbers.set(suggestion.from, numbers.size + 1);
  let body = "";
  let position = 0;
  for (const suggestion of sorted) {
    body += escapeBodyText(text.slice(position, suggestion.from), "top");
    body += linked(suggestion)
      ? `\${${numbers.get(suggestion.linkedTo as number)}/slug}`
      : fieldBody(text, suggestion, numbers.get(suggestion.from) as number);
    position = suggestion.to;
  }
  return `${body}${escapeBodyText(text.slice(position), "top")}$0`;
}
