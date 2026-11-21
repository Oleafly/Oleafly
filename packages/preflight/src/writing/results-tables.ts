import { metricDirection, metricRanks, parseMetricNumber, type MetricDirection } from "@oleafly/conversion-registry/table";
import { matchingBrace } from "@oleafly/latex";
import { message, type PreflightMessageKey } from "../messages";
import type { Finding, TextEdit } from "../types";
import { closingBracket, type ProseView } from "./prose";
import { capped, fix, writingFinding, writingFingerprint, type WritingRule } from "./rules";

const ID = "writing-results-best";
const TABULAR = /\\begin\s*\{(tabular\*?|tabularx|tabulary|NiceTabular)\}/g;
const ENVIRONMENT = /\\(begin|end)\s*\{[^{}]*\}/g;
const WIDTH_FIRST = new Set(["tabular*", "tabularx", "tabulary"]);
const BOLD_COMMAND = /\\(?:textbf|mathbf|boldsymbol|bm)\s*\{/;
const BOLD_SWITCH = /\\(?:bf|bfseries)(?![A-Za-z])\s*/;
const UNDERLINE_COMMAND = /\\(?:underline|uline)\s*\{/;
const NUMBER_TOKEN = /[+\-−]?(?:\d[\d,]*)?\.?\d+(?:\\?%)?/g;

const RULES: Readonly<Record<string, readonly [options: string, braces: number, full: boolean]>> = {
  toprule: ["[", 0, true],
  midrule: ["[", 0, true],
  bottomrule: ["[", 0, true],
  hline: ["", 0, true],
  specialrule: ["", 3, true],
  Xhline: ["", 1, true],
  hhline: ["", 1, true],
  cline: ["", 1, false],
  cmidrule: ["[(", 1, false],
  morecmidrules: ["", 0, false],
  addlinespace: ["[", 0, false],
  noalign: ["", 1, false],
};

interface Span {
  readonly from: number;
  readonly to: number;
}

interface Cell {
  readonly span: number;
  readonly content: Span;
}

interface Row {
  readonly cells: readonly Cell[];
  readonly ruleAbove: boolean;
}

interface Mark extends Span {
  readonly remove: TextEdit[];
}

interface Entry {
  readonly block: number;
  readonly value: number;
  readonly token: Span;
  readonly math: boolean;
  readonly bold: Mark | null;
  readonly underline: Mark | null;
}

type Kind = "best" | "second";

function skipSpace(text: string, at: number, to: number): number {
  let index = at;
  while (index < to && /\s/.test(text[index])) index += 1;
  return index;
}

function trimmed(text: string, span: Span): Span {
  let from = span.from;
  let to = span.to;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  return { from, to };
}

function groupEnd(text: string, open: number, limit: number): number {
  const character = text[open];
  const close = character === "{" ? matchingBrace(text, open) : character === "[" ? closingBracket(text, open) : text.indexOf(")", open);
  return close >= 0 && close < limit ? close + 1 : -1;
}

function skipRules(text: string, from: number, to: number): { at: number; full: boolean } {
  let at = from;
  let full = false;
  for (;;) {
    at = skipSpace(text, at, to);
    const name = /^\\([A-Za-z]+)/.exec(text.slice(at, at + 24))?.[1];
    const rule = name && Object.hasOwn(RULES, name) ? RULES[name] : undefined;
    if (!name || !rule) return { at, full };
    let next = at + name.length + 1;
    for (const open of rule[0]) {
      const start = skipSpace(text, next, to);
      if (text[start] !== open) continue;
      next = groupEnd(text, start, to);
      if (next < 0) return { at, full };
    }
    for (let count = 0; count < rule[1]; count += 1) {
      const start = skipSpace(text, next, to);
      if (text[start] !== "{") break;
      next = groupEnd(text, start, to);
      if (next < 0) return { at, full };
    }
    full ||= rule[2];
    at = next;
  }
}

function afterLineBreak(text: string, at: number, to: number): number {
  const next = text[at] === "*" ? at + 1 : at;
  const open = skipSpace(text, next, to);
  if (text[open] !== "[") return next;
  const end = groupEnd(text, open, to);
  return end < 0 ? next : end;
}

function scanRow(text: string, from: number, to: number): { cells: Span[]; next: number } {
  const cells: Span[] = [];
  let braces = 0;
  let environments = 0;
  let start = from;
  for (let at = from; at < to; at += 1) {
    const character = text[at];
    const top = braces === 0 && environments === 0;
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "&" && top) {
      cells.push({ from: start, to: at });
      start = at + 1;
    } else if (character === "\\") {
      const name = /^[A-Za-z]+/.exec(text.slice(at + 1, at + 33))?.[0];
      if (!name && text[at + 1] === "\\" && top) {
        cells.push({ from: start, to: at });
        return { cells, next: afterLineBreak(text, at + 2, to) };
      }
      if (name === "tabularnewline" && top) {
        cells.push({ from: start, to: at });
        return { cells, next: at + name.length + 1 };
      }
      if (name === "begin") environments += 1;
      else if (name === "end") environments -= 1;
      at += name ? name.length : 1;
    }
  }
  cells.push({ from: start, to });
  return { cells, next: to };
}

function unwrap(text: string, span: Span, command: string): { first: string; inner: Span } | null {
  if (!text.startsWith(`\\${command}`, span.from) || /[A-Za-z]/.test(text[span.from + command.length + 1] ?? "")) return null;
  const args: Span[] = [];
  let at = span.from + command.length + 1;
  while (args.length < 3) {
    at = skipSpace(text, at, span.to);
    if (text[at] !== "[" && text[at] !== "{") return null;
    const end = groupEnd(text, at, span.to);
    if (end < 0) return null;
    if (text[at] === "{") args.push({ from: at + 1, to: end - 1 });
    at = end;
  }
  return { first: text.slice(args[0].from, args[0].to), inner: args[2] };
}

function cellOf(text: string, raw: Span): Cell {
  let content = trimmed(text, raw);
  let span = 1;
  const multicolumn = unwrap(text, content, "multicolumn");
  if (multicolumn) {
    span = Math.max(1, Number.parseInt(multicolumn.first, 10) || 1);
    content = trimmed(text, multicolumn.inner);
  }
  const multirow = unwrap(text, content, "multirow");
  return { span, content: multirow ? trimmed(text, multirow.inner) : content };
}

function tableRows(text: string, from: number, to: number): Row[] {
  const rows: Row[] = [];
  let at = from;
  let ruleAbove = false;
  while (at < to) {
    const lead = skipRules(text, at, to);
    ruleAbove ||= lead.full;
    const { cells, next } = scanRow(text, lead.at, to);
    const parsed = cells.map((cell) => cellOf(text, cell));
    if (parsed.some((cell) => cell.content.to > cell.content.from)) {
      rows.push({ cells: parsed, ruleAbove });
      ruleAbove = false;
    }
    if (next <= at) break;
    at = next;
  }
  return rows;
}

function columns(row: Row): (Cell | null)[] {
  return row.cells.flatMap((cell) => (cell.span === 1 ? [cell] : Array.from({ length: cell.span }, () => null)));
}

function headerTitles(text: string, header: readonly Row[]): string[] {
  const titles: string[] = [];
  for (const row of header) {
    let column = 0;
    for (const cell of row.cells) {
      const title = text.slice(cell.content.from, cell.content.to);
      for (let offset = 0; offset < cell.span; offset += 1) {
        titles[column + offset] = `${titles[column + offset] ?? ""} ${title}`;
      }
      column += cell.span;
    }
  }
  return Array.from(titles, (title) => title ?? "");
}

function wrapperMark(text: string, content: Span, pattern: RegExp): Mark | null {
  const match = pattern.exec(text.slice(content.from, content.to));
  if (!match) return null;
  const from = content.from + match.index;
  const open = from + match[0].length - 1;
  const close = matchingBrace(text, open);
  if (close < 0 || close >= content.to) return null;
  return { from, to: close + 1, remove: [{ from, to: open + 1, insert: "" }, { from: close, to: close + 1, insert: "" }] };
}

function boldMark(text: string, content: Span): Mark | null {
  const wrapped = wrapperMark(text, content, BOLD_COMMAND);
  if (wrapped) return wrapped;
  const match = BOLD_SWITCH.exec(text.slice(content.from, content.to));
  if (!match) return null;
  const from = content.from + match.index;
  return { from, to: content.to, remove: [{ from, to: from + match[0].length, insert: "" }] };
}

function numberToken(text: string, content: Span, value: number): Span | null {
  const slice = text.slice(content.from, content.to);
  for (const match of slice.matchAll(NUMBER_TOKEN)) {
    if (parseMetricNumber(match[0]) === value) return { from: content.from + match.index, to: content.from + match.index + match[0].length };
  }
  return null;
}

function inMath(text: string, from: number, to: number): boolean {
  let dollars = 0;
  for (let index = from; index < to; index += 1) {
    if (text[index] === "$" && text[index - 1] !== "\\") dollars += 1;
  }
  return dollars % 2 === 1;
}

function rowHighlighted(text: string, cells: readonly (Cell | null)[]): boolean {
  const [first, ...rest] = cells;
  if (!first || !boldMark(text, first.content)) return false;
  const numeric = rest.filter((cell): cell is Cell => cell !== null && parseMetricNumber(text.slice(cell.content.from, cell.content.to)) !== null);
  return numeric.length > 0 && numeric.every((cell) => boldMark(text, cell.content) !== null);
}

function entryOf(text: string, cell: Cell, block: number, highlighted: boolean): Entry | null {
  const value = parseMetricNumber(text.slice(cell.content.from, cell.content.to));
  if (value === null) return null;
  const token = numberToken(text, cell.content, value);
  if (!token) return null;
  return {
    block,
    value,
    token,
    math: inMath(text, cell.content.from, token.from),
    bold: highlighted ? null : boldMark(text, cell.content),
    underline: wrapperMark(text, cell.content, UNDERLINE_COMMAND),
  };
}

function addMark(entry: Entry, kind: Kind): TextEdit[] {
  const open = kind === "second" ? "\\underline{" : entry.math ? "\\mathbf{" : "\\textbf{";
  return [{ from: entry.token.from, to: entry.token.from, insert: open }, { from: entry.token.to, to: entry.token.to, insert: "}" }];
}

function detailKey(kind: Kind, direction: MetricDirection): PreflightMessageKey {
  const base = kind === "best" ? "detail" : "detailSecond";
  return `rules.${ID}.${base}${direction === "lower" ? "Lower" : ""}` as PreflightMessageKey;
}

function resultFinding(view: ProseView, text: string, entry: Entry, targets: readonly Entry[], kind: Kind, direction: MetricDirection, title: string): Finding {
  const mark = (kind === "best" ? entry.bold : entry.underline) as Mark;
  const value = text.slice(entry.token.from, entry.token.to);
  const best = text.slice(targets[0].token.from, targets[0].token.to);
  const additions = targets.filter((target) => !(kind === "best" ? target.bold : target.underline)).flatMap((target) => addMark(target, kind));
  return writingFinding(ID, view, mark.from, mark.to, {
    ...(kind === "second" ? { title: message(`rules.${ID}.titleSecond` as PreflightMessageKey) } : {}),
    detail: message(detailKey(kind, direction), { value, best }),
    fingerprint: writingFingerprint(ID, `${kind}|${title.trim()}|${value}|${best}`),
    fix: fix(kind === "best" ? "fixes.boldBest" : "fixes.underlineSecond", [...mark.remove, ...additions], { value: best }),
  });
}

function scopes(entries: readonly Entry[]): Entry[][] {
  const blocks = new Map<number, Entry[]>();
  for (const entry of entries) blocks.set(entry.block, [...(blocks.get(entry.block) ?? []), entry]);
  const marked = [...blocks.values()].filter((group) => group.length > 1 && group.some((entry) => entry.bold || entry.underline));
  return marked.length > 1 ? [...blocks.values()] : [[...entries]];
}

function checkColumn(view: ProseView, text: string, entries: readonly Entry[], direction: MetricDirection, title: string, out: Finding[]): void {
  if (entries.length < 2) return;
  const boldEverywhere = entries.every((entry) => entry.bold);
  const usesUnderline = entries.some((entry) => entry.underline);
  for (const group of scopes(entries)) {
    if (group.length < 2) continue;
    const ranks = metricRanks(group.map((entry) => entry.value), direction);
    const best = ranks.best.map((index) => group[index]);
    const second = ranks.second.map((index) => group[index]);
    for (const entry of group) {
      if (!boldEverywhere && entry.bold && best.length > 0 && !best.includes(entry)) {
        out.push(resultFinding(view, text, entry, best, "best", direction, title));
      }
      if (usesUnderline && entry.underline && second.length > 0 && !second.includes(entry)) {
        out.push(resultFinding(view, text, entry, second, "second", direction, title));
      }
    }
  }
}

function checkTable(view: ProseView, text: string, rows: readonly Row[], out: Finding[]): void {
  if (rows.length < 3) return;
  const split = rows.findIndex((row, index) => index > 0 && row.ruleAbove);
  const headerCount = split > 0 ? split : 1;
  const titles = headerTitles(text, rows.slice(0, headerCount));
  const body = rows.slice(headerCount);
  let block = 0;
  const grid = body.map((row, index) => {
    if (index > 0 && row.ruleAbove) block += 1;
    const cells = columns(row);
    return { block, cells, highlighted: rowHighlighted(text, cells) };
  });
  titles.forEach((title, column) => {
    const direction = metricDirection(title);
    if (!direction) return;
    const entries = grid.flatMap(({ block: rowBlock, cells, highlighted }) => {
      const cell = cells[column];
      const entry = cell ? entryOf(text, cell, rowBlock, highlighted) : null;
      return entry ? [entry] : [];
    });
    checkColumn(view, text, entries, direction, title, out);
  });
}

function bodyStart(text: string, at: number, name: string): number {
  let mandatory = WIDTH_FIRST.has(name) ? 2 : 1;
  let index = at;
  for (;;) {
    const next = skipSpace(text, index, text.length);
    const open = text[next];
    if (open !== "[" && !(open === "{" && mandatory > 0)) return mandatory === 0 ? index : -1;
    const end = groupEnd(text, next, text.length);
    if (end < 0) return -1;
    if (open === "{") mandatory -= 1;
    index = end;
  }
}

function environmentEnd(text: string, from: number): number {
  let depth = 1;
  ENVIRONMENT.lastIndex = from;
  for (let match = ENVIRONMENT.exec(text); match; match = ENVIRONMENT.exec(text)) {
    depth += match[1] === "begin" ? 1 : -1;
    if (depth === 0) return match.index;
  }
  return -1;
}

export const resultsBest: WritingRule = {
  id: ID,
  profiles: ["general", "cvpr"],
  run: ({ view, source }) => {
    const out: Finding[] = [];
    TABULAR.lastIndex = 0;
    for (let match = TABULAR.exec(source); match; match = TABULAR.exec(source)) {
      const from = match.index + match[0].length;
      const to = environmentEnd(source, from);
      if (to < 0) break;
      const start = bodyStart(source, from, match[1]);
      if (match.index >= view.bodyStart && start >= 0 && start <= to) checkTable(view, source, tableRows(source, start, to), out);
      TABULAR.lastIndex = to;
    }
    return capped(out);
  },
};
