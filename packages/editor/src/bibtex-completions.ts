import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  BIBTEX_DIRECTIVES,
  BIBTEX_ENTRY_TYPES,
  bibtexEntryFields,
  bibtexEntryType,
} from "@oleafly/latex";
import {
  createCompletionRequestGuard,
  type CompletionRequestGuard,
} from "./completion-request";
import {
  boundedCompletionContext,
  shouldRunCompletionSource,
} from "./completion-trigger";
import { guardCompletionForSource } from "./latex";
import { editorMessage } from "./messages";

const ENTRY_TYPE_BEFORE = /(?:^|\n)[ \t]*@([A-Za-z]*)$/u;
const ENTRY_OPENER = /@([A-Za-z][A-Za-z0-9_-]*)[ \t]*([{(])/gu;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_+:-]*$/u;

const DIRECTIVE_TEMPLATES: Readonly<Record<string, string>> = {
  string: "@string{${1:name} = {${2:value}}}",
  preamble: "@preamble{${1}}",
  comment: "@comment{${1}}",
};

function entrySnippet(name: string): string {
  const fields = (bibtexEntryType(name)?.required ?? []).map(
    (group) => group[0],
  );
  const body = fields.length
    ? fields
        .map((field, index) => `  ${field} = {\${${index + 2}:${field}}},`)
        .join("\n")
    : "  ${2}";
  return `@${name}{\${1:key},\n${body}\n}`;
}

function entryTypeOptions(guard: CompletionRequestGuard): Completion[] {
  const entries = BIBTEX_ENTRY_TYPES.map((type) => ({
    label: `@${type.name}`,
    type: "type",
    detail: editorMessage("bibtex.completion.entryType"),
    apply: snippet(entrySnippet(type.name)),
  }));
  const directives = BIBTEX_DIRECTIVES.map((name) => ({
    label: `@${name}`,
    type: "keyword",
    detail: editorMessage("bibtex.completion.directive"),
    apply: snippet(DIRECTIVE_TEMPLATES[name]),
  }));
  return [...entries, ...directives].map((option) =>
    guardCompletionForSource(guard, option),
  );
}

export function bibtexEntryCompletions(
  context: CompletionContext,
): CompletionResult | null {
  const before = boundedCompletionContext(context.state, context.pos);
  const match = ENTRY_TYPE_BEFORE.exec(before);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    from: context.pos - query.length - 1,
    options: entryTypeOptions(createCompletionRequestGuard(context)),
  };
}

interface EntryOpener {
  readonly type: string;
  readonly close: string;
  readonly bodyFrom: number;
}

function lastEntryOpener(before: string): EntryOpener | null {
  let opener: EntryOpener | null = null;
  for (const match of before.matchAll(ENTRY_OPENER)) {
    opener = {
      type: match[1].toLowerCase(),
      close: match[2] === "(" ? ")" : "}",
      bodyFrom: (match.index ?? 0) + match[0].length,
    };
  }
  return opener;
}

interface FieldPosition {
  readonly type: string;
  readonly query: string;
}

interface BodyScan {
  depth: number;
  quoted: boolean;
  lastSeparator: number;
}

function advanceBodyScan(
  scan: BodyScan,
  char: string,
  index: number,
  close: string,
): boolean {
  if (scan.quoted) {
    if (char === '"') scan.quoted = false;
    return true;
  }
  if (char === '"') scan.quoted = scan.depth === 1;
  else if (char === "{") scan.depth += 1;
  else if (char === "}") scan.depth -= 1;
  else if (char === close) return scan.depth !== 1;
  else if (char === "," && scan.depth === 1) scan.lastSeparator = index;
  return scan.depth >= 1;
}

function fieldPositionInBody(
  body: string,
  opener: EntryOpener,
): FieldPosition | null {
  const scan: BodyScan = { depth: 1, quoted: false, lastSeparator: -1 };
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "\\") {
      index += 1;
      continue;
    }
    if (!advanceBodyScan(scan, body[index], index, opener.close)) return null;
  }
  if (scan.quoted || scan.depth !== 1 || scan.lastSeparator < 0) return null;
  const tail = body.slice(scan.lastSeparator + 1).trimStart();
  if (tail && !FIELD_NAME.test(tail)) return null;
  return { type: opener.type, query: tail };
}

export function bibtexFieldCompletions(
  context: CompletionContext,
): CompletionResult | null {
  const before = boundedCompletionContext(context.state, context.pos);
  const opener = lastEntryOpener(before);
  if (!opener) return null;
  const position = fieldPositionInBody(before.slice(opener.bodyFrom), opener);
  if (!position) return null;
  const entry = bibtexEntryType(position.type);
  if (!entry) return null;
  const required = new Set(entry.required.flat());
  const guard = createCompletionRequestGuard(context);
  return {
    from: context.pos - position.query.length,
    options: bibtexEntryFields(position.type).map((field) =>
      guardCompletionForSource(guard, {
        label: field,
        type: "property",
        detail: editorMessage(
          required.has(field)
            ? "bibtex.completion.requiredField"
            : "bibtex.completion.optionalField",
        ),
        boost: required.has(field) ? 1 : 0,
        apply: snippet(`${field} = {\${1}}`),
      }),
    ),
  };
}

export function bibtexCompletions(
  context: CompletionContext,
): CompletionResult | null {
  if (!shouldRunCompletionSource(context, "bibtex")) return null;
  return (
    bibtexEntryCompletions(context) ?? bibtexFieldCompletions(context)
  );
}
