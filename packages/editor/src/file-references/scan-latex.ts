import { latexBalancedGroupEnd, maskLatexIgnoredRegions } from "../latex-lexical";
import type { PathReference, PathReferenceKind, TextSpan } from "./types";

const COMMAND = /\\([A-Za-z]+)(?![A-Za-z@])/g;
const COMMAND_NAMES: ReadonlySet<string> = new Set([
  "input",
  "include",
  "includeonly",
  "InputIfFileExists",
  "subfile",
  "import",
  "subimport",
  "includegraphics",
  "includesvg",
  "includepdf",
  "includestandalone",
  "lstinputlisting",
  "verbatiminput",
  "inputminted",
  "bibliography",
  "addbibresource",
  "addglobalbib",
  "addsectionbib",
  "usepackage",
  "RequirePackage",
  "documentclass",
  "graphicspath",
  "svgpath",
]);

interface Group {
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly end: number;
}

interface CommandShape {
  readonly kind: PathReferenceKind;
  readonly options: boolean;
  readonly skip: number;
  readonly list: boolean;
}

const SHAPES: Readonly<Record<string, CommandShape>> = {
  input: { kind: "tex-input", options: false, skip: 0, list: false },
  InputIfFileExists: { kind: "tex-input", options: false, skip: 0, list: false },
  include: { kind: "tex-include", options: false, skip: 0, list: false },
  includeonly: { kind: "tex-include", options: false, skip: 0, list: true },
  subfile: { kind: "tex-subfile", options: false, skip: 0, list: false },
  includegraphics: { kind: "tex-graphics", options: true, skip: 0, list: false },
  includesvg: { kind: "tex-svg", options: true, skip: 0, list: false },
  includepdf: { kind: "tex-pdf", options: true, skip: 0, list: false },
  includestandalone: { kind: "tex-input", options: true, skip: 0, list: false },
  lstinputlisting: { kind: "tex-exact", options: true, skip: 0, list: false },
  verbatiminput: { kind: "tex-exact", options: false, skip: 0, list: false },
  inputminted: { kind: "tex-exact", options: true, skip: 1, list: false },
  bibliography: { kind: "tex-bibtex", options: false, skip: 0, list: true },
  addbibresource: { kind: "tex-biblatex", options: true, skip: 0, list: false },
  addglobalbib: { kind: "tex-biblatex", options: true, skip: 0, list: false },
  addsectionbib: { kind: "tex-biblatex", options: true, skip: 0, list: false },
  usepackage: { kind: "tex-package", options: true, skip: 0, list: true },
  RequirePackage: { kind: "tex-package", options: true, skip: 0, list: true },
  documentclass: { kind: "tex-class", options: true, skip: 0, list: false },
};

function skipSpace(text: string, at: number): number {
  let cursor = at;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function readGroup(text: string, at: number, opening: "{" | "["): Group | null {
  const start = skipSpace(text, at);
  if (text[start] !== opening) return null;
  const end = opening === "{"
    ? latexBalancedGroupEnd(text, start)
    : bracketGroupEnd(text, start);
  if (end === null) return null;
  return { contentFrom: start + 1, contentTo: end - 1, end };
}

function bracketGroupEnd(text: string, start: number): number | null {
  let braces = 0;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "\\") {
      cursor += 1;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces -= 1;
    } else if (character === "]" && braces <= 0) {
      return cursor + 1;
    }
  }
  return null;
}

function skipOptions(text: string, at: number): number {
  let cursor = at;
  for (let group = readGroup(text, cursor, "["); group; group = readGroup(text, cursor, "[")) {
    cursor = group.end;
  }
  return cursor;
}

function trimmedSpan(source: string, from: number, to: number): TextSpan | null {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  if (start === end) return null;
  const raw = source.slice(start, end);
  if (raw.includes("\\") || raw.includes("#")) return null;
  return { from: start, to: end, raw };
}

function listSpans(source: string, group: Group, list: boolean): TextSpan[] {
  if (!list) {
    const span = trimmedSpan(source, group.contentFrom, group.contentTo);
    return span ? [span] : [];
  }
  const spans: TextSpan[] = [];
  let itemFrom = group.contentFrom;
  for (let cursor = group.contentFrom; cursor <= group.contentTo; cursor += 1) {
    if (cursor === group.contentTo || source[cursor] === ",") {
      const span = trimmedSpan(source, itemFrom, cursor);
      if (span) spans.push(span);
      itemFrom = cursor + 1;
    }
  }
  return spans;
}

function reference(
  kind: PathReferenceKind,
  command: string,
  span: TextSpan,
  directory?: TextSpan,
): PathReference {
  return { language: "latex", kind, command, ...span, ...(directory ? { directory } : {}) };
}

function searchPathReferences(
  source: string,
  masked: string,
  command: string,
  at: number,
): PathReference[] {
  const outer = readGroup(masked, at, "{");
  if (!outer) return [];
  const kind: PathReferenceKind = command === "svgpath" ? "tex-svgpath" : "tex-graphicspath";
  const references: PathReference[] = [];
  let cursor = outer.contentFrom;
  for (
    let inner = readGroup(masked, cursor, "{");
    inner && inner.end <= outer.contentTo + 1;
    inner = readGroup(masked, cursor, "{")
  ) {
    const span = trimmedSpan(source, inner.contentFrom, inner.contentTo);
    if (span) references.push(reference(kind, command, span));
    cursor = inner.end;
  }
  return references;
}

function importReference(
  source: string,
  masked: string,
  command: string,
  at: number,
): PathReference[] {
  const directory = readGroup(masked, at, "{");
  if (!directory) return [];
  const file = readGroup(masked, directory.end, "{");
  if (!file) return [];
  const fileSpan = trimmedSpan(source, file.contentFrom, file.contentTo);
  if (!fileSpan) return [];
  const directorySpan = trimmedSpan(source, directory.contentFrom, directory.contentTo) ?? {
    from: directory.contentFrom,
    to: directory.contentTo,
    raw: source.slice(directory.contentFrom, directory.contentTo),
  };
  const kind: PathReferenceKind = command === "subimport" ? "tex-subimport" : "tex-import";
  return [reference(kind, command, fileSpan, directorySpan)];
}

function shapedReferences(
  source: string,
  masked: string,
  command: string,
  at: number,
): PathReference[] {
  const shape = SHAPES[command];
  let cursor = shape.options ? skipOptions(masked, at) : at;
  for (let skipped = 0; skipped < shape.skip; skipped += 1) {
    const group = readGroup(masked, cursor, "{");
    if (!group) return [];
    cursor = group.end;
  }
  const group = readGroup(masked, cursor, "{");
  if (!group) return [];
  return listSpans(source, group, shape.list).map((span) => reference(shape.kind, command, span));
}

export function scanLatexReferences(source: string): PathReference[] {
  const masked = maskLatexIgnoredRegions(source);
  const references: PathReference[] = [];
  for (const match of masked.matchAll(COMMAND)) {
    const command = match[1];
    if (!COMMAND_NAMES.has(command)) continue;
    let at = match.index + match[0].length;
    if (masked[at] === "*") at += 1;
    if (command === "graphicspath" || command === "svgpath") {
      references.push(...searchPathReferences(source, masked, command, at));
    } else if (command === "import" || command === "subimport") {
      references.push(...importReference(source, masked, command, at));
    } else {
      references.push(...shapedReferences(source, masked, command, at));
    }
  }
  return references;
}
