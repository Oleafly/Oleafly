import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import {
  listMatches,
  type Place,
  placeAllows,
  renderBody,
  type Rendered,
  type SnippetLanguage,
  type SnippetRecord,
} from "@oleafly/snippets";
import { createCompletionRequestGuard } from "../completion-request";
import { type CompletionSyntax, isCompletionLexicallyTriggered } from "../completion-trigger";
import { guardCompletionForSource } from "../latex";
import { type EditorMessageKey, editorMessage } from "../messages";
import { defaultLineComment, insertSnippet, snippetBody, snippetName } from "./insert";
import { type SnippetLookup, snippetLookup } from "./lookup";
import { snippetPlaceAt } from "./place";
import type { SnippetPort } from "./port";
import { activeSnippetField, fieldOffersList, snippetFieldCompletions } from "./session";
import {
  ACTIVE_FIELD_CLASS,
  FIELD_CLASS,
  INFO_BODY_CLASS,
  INFO_CLASS,
  INFO_FOOTER_CLASS,
  INFO_META_CLASS,
  INFO_NAME_CLASS,
} from "./session-theme";

const TOKEN_LIMIT = 64;
const SPACE = /\s/u;
const WORD_START = /[\p{L}\p{N}]/u;
const MATH_PLACES: ReadonlySet<Place> = new Set(["math", "inline-math", "display-math"]);
const BOOST_LIMIT = 99;
const EXACT_BOOST = 20;
const USE_BOOST = 30;

const SYNTAX: Readonly<Record<SnippetLanguage, CompletionSyntax>> = {
  latex: "latex",
  typst: "typst",
  markdown: "markdown",
  bibtex: "bibtex",
  notes: "generic",
};

const PLACE_LABEL: Readonly<Record<Place, EditorMessageKey>> = {
  any: "snippets.place.any",
  text: "snippets.place.text",
  math: "snippets.place.math",
  "inline-math": "snippets.place.inlineMath",
  "display-math": "snippets.place.displayMath",
  code: "snippets.place.code",
};

const EXPAND_LABEL: Readonly<Record<SnippetRecord["expand"], EditorMessageKey>> = {
  list: "snippets.expand.list",
  tab: "snippets.expand.tab",
  auto: "snippets.expand.auto",
};

function keyFor(record: SnippetRecord, typed: string): string {
  const keys = [record.trigger as string, ...record.aliases];
  return keys.find((key) => key.startsWith(typed)) as string;
}

function boost(record: SnippetRecord, port: SnippetPort, exact: boolean): number {
  // biome-ignore lint/correctness/useHookAtTopLevel: SnippetPort.useCount reads a use counter, it is not a React hook
  const uses = port.useCount(record.id);
  const raw = record.priority + (exact ? EXACT_BOOST : 0) + Math.min(USE_BOOST, uses);
  return Math.max(-BOOST_LIMIT, Math.min(BOOST_LIMIT, raw));
}

function previewEnv(port: SnippetPort, language: SnippetLanguage) {
  return {
    selection: "",
    clipboard: "",
    now: new Date(),
    fileName: port.filePath(),
    projectName: port.projectName(),
    lineComment: defaultLineComment(language),
    captures: [],
    indent: "",
    indentUnit: "  ",
  };
}

function fieldClassAt(rendered: Rendered, at: number): string | null {
  const inside = (field: Rendered["fields"][number]) =>
    field.ranges.some((range) => at >= range.from && at < range.to);
  const [first, ...rest] = rendered.fields;
  if (first && inside(first)) return ACTIVE_FIELD_CLASS;
  return rest.some(inside) ? FIELD_CLASS : null;
}

function bodyPreview(rendered: Rendered): HTMLElement {
  const body = document.createElement("pre");
  body.className = INFO_BODY_CLASS;
  const text = rendered.text;
  for (let start = 0; start < text.length; ) {
    const kind = fieldClassAt(rendered, start);
    let end = start + 1;
    while (end < text.length && fieldClassAt(rendered, end) === kind) end += 1;
    if (kind) {
      const span = document.createElement("span");
      span.className = kind;
      span.textContent = text.slice(start, end);
      body.append(span);
    } else body.append(text.slice(start, end));
    start = end;
  }
  return body;
}

function footer(record: SnippetRecord, port: SnippetPort): HTMLElement {
  const row = document.createElement("div");
  row.className = INFO_FOOTER_CLASS;
  const insert = document.createElement("span");
  const key = document.createElement("kbd");
  key.textContent = "Tab";
  insert.append(key, ` ${editorMessage("snippets.info.insert")}`);
  row.append(insert);
  const edit = port.editSnippet?.bind(port);
  if (edit) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = editorMessage("snippets.info.edit");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => edit(record.id));
    row.append(button);
  }
  return row;
}

export function snippetInfo(record: SnippetRecord, port: SnippetPort, language: SnippetLanguage): HTMLElement {
  const info = document.createElement("div");
  info.className = INFO_CLASS;
  const name = document.createElement("div");
  name.className = INFO_NAME_CLASS;
  name.textContent = snippetName(record);
  const meta = document.createElement("div");
  meta.className = INFO_META_CLASS;
  meta.textContent = `${editorMessage(PLACE_LABEL[record.place])} · ${editorMessage(EXPAND_LABEL[record.expand])}`;
  info.append(name, meta);
  const nodes = snippetBody(record, language);
  if (nodes) {
    const rendered = renderBody(nodes, previewEnv(port, language));
    info.append(bodyPreview(rendered));
    const math = MATH_PLACES.has(record.place) ? port.renderMathPreview?.(rendered.text, language) : null;
    if (math) info.append(math);
  }
  info.append(footer(record, port));
  return info;
}

function option(record: SnippetRecord, lookup: SnippetLookup, typed: string): Completion {
  const { port, language } = lookup;
  const label = keyFor(record, typed);
  return {
    label,
    displayLabel: `${label} ${snippetName(record)}`,
    detail: port.collectionName?.(record.collection) ?? record.collection,
    type: "snippet",
    boost: boost(record, port, label === typed),
    info: () => snippetInfo(record, port, language),
    apply: (view, completion, from, to) => {
      insertSnippet(view, record, from, to, "list", { completion });
    },
  };
}

function runStart(line: string): number {
  let start = line.length;
  while (start > 0 && line.length - start < TOKEN_LIMIT && !SPACE.test(line[start - 1])) start -= 1;
  return start;
}

function listAt(context: CompletionContext, lookup: SnippetLookup): CompletionResult | null {
  const line = lookup.ctx.lineBefore;
  const start = runStart(line);
  let lexical: boolean | null = null;
  const allowed = (typed: string): boolean => {
    if (context.explicit) return typed !== "" || start === line.length;
    if (typed === "" || WORD_START.test(typed[0])) return false;
    lexical ??= isCompletionLexicallyTriggered(context.state, context.pos, SYNTAX[lookup.language]);
    return lexical;
  };
  for (let at = start; at <= line.length; at += 1) {
    const typed = line.slice(at);
    if (!allowed(typed)) continue;
    const matches = listMatches(lookup.index, lookup.ctx, typed);
    if (matches.length === 0) continue;
    const from = lookup.offset + at;
    const place = snippetPlaceAt(context.state, from, lookup.language);
    const fitting = place === null ? [] : matches.filter((record) => placeAllows(record, place));
    if (fitting.length === 0) continue;
    const guard = createCompletionRequestGuard(context);
    return {
      from,
      options: fitting.map((record) => guardCompletionForSource(guard, option(record, lookup, typed))),
    };
  }
  return null;
}

export function fieldOwnsList(context: CompletionContext): boolean {
  const field = activeSnippetField(context.state);
  if (!field || !fieldOffersList(field)) return false;
  const range = field.ranges[0];
  return context.pos >= range.from && context.pos <= range.to;
}

const source: CompletionSource = (context) => {
  if (fieldOwnsList(context)) return snippetFieldCompletions(context);
  const lookup = snippetLookup(context.state, context.pos);
  if (!lookup || !lookup.port.enabled().list) return null;
  return listAt(context, lookup);
};

export function snippetCompletionSource(): CompletionSource {
  return source;
}
