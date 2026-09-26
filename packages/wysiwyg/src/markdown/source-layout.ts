import type { JSONContent } from "@tiptap/core";
import type { PreservedInlineRange } from "../preserve-inline";

export interface MarkdownBlockToken {
  level: number;
  nesting: number;
  map: [number, number] | null;
}

export interface MarkdownSourceUnit {
  source: string;
  nodes: number;
}

export interface MarkdownSourceLayout {
  units: MarkdownSourceUnit[];
  separators: string[];
  trailing: string;
}

export interface MarkdownUnitPlan {
  leading: string;
  units: string[];
  separators: string[];
  trailing: string;
}

export interface MarkdownSourceSnapshot {
  layout: MarkdownSourceLayout;
  keys: string[];
  unitOfNode: number[];
  firstNode: number[];
  preservable: boolean[];
}

type Item = { unit: number } | { fresh: JSONContent[] };

const REGENERATED_NODE_TYPES = new Set(["figure"]);
const MAX_ALIGNMENT_CELLS = 1_000_000;

function lineStartsAt(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^[ \t]{0,3}$/u.test(text.slice(lineStart, index));
}

function afterFence(text: string, index: number): number | null {
  if (!lineStartsAt(text, index)) return null;
  const fence = /^(`{3,}|~{3,})/u.exec(text.slice(index, index + 64))?.[1];
  if (!fence) return null;
  let cursor = text.indexOf("\n", index);
  while (cursor >= 0) {
    const lineEnd = text.indexOf("\n", cursor + 1);
    const line = text.slice(cursor + 1, lineEnd < 0 ? text.length : lineEnd);
    const close = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*\r?$/u.exec(line)?.[1];
    if (close?.startsWith(fence[0]) && close.length >= fence.length) {
      return lineEnd < 0 ? text.length : lineEnd;
    }
    cursor = lineEnd;
  }
  return text.length;
}

function afterCodeSpan(text: string, index: number): number {
  let run = 1;
  while (text[index + run] === "`") run++;
  const close = text.indexOf("`".repeat(run), index + run);
  return close < 0 ? index + run : close + run;
}

export function markdownPreservedRanges(
  text: string,
  from = 0,
): PreservedInlineRange[] {
  const ranges: PreservedInlineRange[] = [];
  let cursor = from;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "<" && text.startsWith("<!--", cursor)) {
      const end = text.indexOf("-->", cursor + 4);
      if (end < 0) break;
      ranges.push({ from: cursor, to: end + 3 });
      cursor = end + 3;
      continue;
    }
    if (char === "[" && text[cursor + 1] === "^") {
      const footnote = /^\[\^[^\]\s[]+\]/u.exec(text.slice(cursor, cursor + 256))?.[0];
      if (footnote) {
        ranges.push({ from: cursor, to: cursor + footnote.length });
        cursor += footnote.length;
        continue;
      }
    }
    if (char === "`" || char === "~") {
      const fenceEnd = afterFence(text, cursor);
      if (fenceEnd !== null) {
        cursor = fenceEnd;
        continue;
      }
    }
    cursor = char === "`" ? afterCodeSpan(text, cursor) : cursor + 1;
  }
  return ranges;
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*\r?\n?$/u.test(line);
}

function withoutLineBreak(line: string): number {
  if (line.endsWith("\r\n")) return line.length - 2;
  if (line.endsWith("\n")) return line.length - 1;
  return line.length;
}

export function planMarkdownUnits(
  content: string,
  tokens: readonly MarkdownBlockToken[],
): MarkdownUnitPlan | null {
  if (/\r(?!\n)/u.test(content)) return null;
  const lines = content === "" ? [] : content.split(/(?<=\n)/u);
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length);

  const spans: { start: number; end: number }[] = [];
  const pushGap = (from: number, to: number) => {
    let start = -1;
    for (let index = from; index < to; index++) {
      if (isBlankLine(lines[index])) {
        if (start >= 0) spans.push({ start, end: index });
        start = -1;
      } else if (start < 0) {
        start = index;
      }
    }
    if (start >= 0) spans.push({ start, end: to });
  };

  let line = 0;
  for (const token of tokens) {
    if (token.level !== 0 || token.nesting === -1 || !token.map) continue;
    const [start, rawEnd] = token.map;
    const end = Math.min(rawEnd, lines.length);
    if (start < line || end <= start) continue;
    pushGap(line, start);
    let last = end;
    while (last > start + 1 && isBlankLine(lines[last - 1])) last--;
    spans.push({ start, end: last });
    line = end;
  }
  pushGap(line, lines.length);
  if (spans.length === 0) return null;

  const bounds = spans.map(({ start, end }) => ({
    from: offsets[start],
    to: offsets[end - 1] + withoutLineBreak(lines[end - 1]),
  }));
  return {
    leading: content.slice(0, bounds[0].from),
    units: bounds.map(({ from, to }) => content.slice(from, to)),
    separators: bounds
      .slice(1)
      .map((bound, index) => content.slice(bounds[index].to, bound.from)),
    trailing: content.slice(bounds[bounds.length - 1].to),
  };
}

function containsRegeneratedNode(node: JSONContent): boolean {
  if (node.type && REGENERATED_NODE_TYPES.has(node.type)) return true;
  return node.content?.some(containsRegeneratedNode) ?? false;
}

function isEmptyParagraph(node: JSONContent | undefined): boolean {
  return node?.type === "paragraph" && !node.content?.length;
}

export function createMarkdownSourceSnapshot(
  sourceLayout: MarkdownSourceLayout | null,
  loaded: JSONContent,
): MarkdownSourceSnapshot | null {
  if (!sourceLayout) return null;
  const nodes = loaded.content ?? [];
  const total = sourceLayout.units.reduce((sum, unit) => sum + unit.nodes, 0);
  const trailingNode = nodes.length === total + 1 && isEmptyParagraph(nodes.at(-1));
  if (total !== nodes.length && !trailingNode) return null;
  const layout: MarkdownSourceLayout = trailingNode
    ? {
        ...sourceLayout,
        units: [...sourceLayout.units, { source: "", nodes: 1 }],
        separators: [...sourceLayout.separators, ""],
      }
    : sourceLayout;
  const unitOfNode: number[] = [];
  const firstNode: number[] = [];
  const preservable: boolean[] = [];
  layout.units.forEach((unit, index) => {
    firstNode.push(unitOfNode.length);
    for (let count = 0; count < unit.nodes; count++) unitOfNode.push(index);
    const own = nodes.slice(firstNode[index], firstNode[index] + unit.nodes);
    preservable.push(!own.some(containsRegeneratedNode));
  });
  return {
    layout,
    keys: nodes.map((node) => JSON.stringify(node)),
    unitOfNode,
    firstNode,
    preservable,
  };
}

interface AlignmentWindow {
  oFrom: number;
  oTo: number;
  cFrom: number;
  cTo: number;
}

function alignWindowByLcs(
  original: readonly string[],
  current: readonly string[],
  match: number[],
  { oFrom, oTo, cFrom, cTo }: AlignmentWindow,
): void {
  const rows = oTo - oFrom;
  const columns = cTo - cFrom;
  const width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row * width + column] =
        original[oFrom + row] === current[cFrom + column]
          ? table[(row + 1) * width + column + 1] + 1
          : Math.max(table[(row + 1) * width + column], table[row * width + column + 1]);
    }
  }
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (original[oFrom + row] === current[cFrom + column]) {
      match[cFrom + column] = oFrom + row;
      row++;
      column++;
    } else if (table[(row + 1) * width + column] >= table[row * width + column + 1]) {
      row++;
    } else {
      column++;
    }
  }
}

function uniqueAnchors(
  original: readonly string[],
  current: readonly string[],
  { oFrom, oTo, cFrom, cTo }: AlignmentWindow,
): [number, number][] {
  const seen = new Map<string, { originals: number; original: number; currents: number }>();
  for (let index = oFrom; index < oTo; index++) {
    const entry = seen.get(original[index]);
    if (entry) entry.originals++;
    else seen.set(original[index], { originals: 1, original: index, currents: 0 });
  }
  for (let index = cFrom; index < cTo; index++) {
    const entry = seen.get(current[index]);
    if (entry) entry.currents++;
  }
  const pairs: [number, number][] = [];
  for (let index = cFrom; index < cTo; index++) {
    const entry = seen.get(current[index]);
    if (entry?.originals === 1 && entry.currents === 1) pairs.push([entry.original, index]);
  }
  const tails: number[] = [];
  const previous = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([originalIndex], index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pairs[tails[middle]][0] < originalIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const chain: [number, number][] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) chain.push(pairs[index]);
  return chain.reverse();
}

function alignNodes(original: readonly string[], current: readonly string[]): number[] {
  const match = new Array<number>(current.length).fill(-1);
  const pending: AlignmentWindow[] = [
    { oFrom: 0, oTo: original.length, cFrom: 0, cTo: current.length },
  ];
  for (let window = pending.pop(); window; window = pending.pop()) {
    let { oFrom, oTo, cFrom, cTo } = window;
    while (oFrom < oTo && cFrom < cTo && original[oFrom] === current[cFrom]) {
      match[cFrom++] = oFrom++;
    }
    while (oFrom < oTo && cFrom < cTo && original[oTo - 1] === current[cTo - 1]) {
      match[--cTo] = --oTo;
    }
    const rows = oTo - oFrom;
    const columns = cTo - cFrom;
    if (rows === 0 || columns === 0) continue;
    const trimmed = { oFrom, oTo, cFrom, cTo };
    if ((rows + 1) * (columns + 1) <= MAX_ALIGNMENT_CELLS) {
      alignWindowByLcs(original, current, match, trimmed);
      continue;
    }
    const anchors = uniqueAnchors(original, current, trimmed);
    if (anchors.length === 0) continue;
    let nextOriginal = oFrom;
    let nextCurrent = cFrom;
    for (const [anchorOriginal, anchorCurrent] of anchors) {
      match[anchorCurrent] = anchorOriginal;
      pending.push({ oFrom: nextOriginal, oTo: anchorOriginal, cFrom: nextCurrent, cTo: anchorCurrent });
      nextOriginal = anchorOriginal + 1;
      nextCurrent = anchorCurrent + 1;
    }
    pending.push({ oFrom: nextOriginal, oTo, cFrom: nextCurrent, cTo });
  }
  return match;
}

export function serializeWithSourceLayout(
  doc: JSONContent,
  snapshot: MarkdownSourceSnapshot,
  serializeNodes: (nodes: JSONContent[]) => string,
): string {
  const { layout, keys, unitOfNode, firstNode, preservable } = snapshot;
  const current = doc.content ?? [];
  const match = alignNodes(
    keys,
    current.map((node) => JSON.stringify(node)),
  );
  const matchedAt = new Array<number>(keys.length).fill(-1);
  match.forEach((original, index) => {
    if (original >= 0) matchedAt[original] = index;
  });
  const intact = layout.units.map((unit, index) => {
    if (unit.nodes === 0 || !preservable[index]) return false;
    const first = matchedAt[firstNode[index]];
    if (first < 0) return false;
    for (let offset = 1; offset < unit.nodes; offset++) {
      if (matchedAt[firstNode[index] + offset] !== first + offset) return false;
    }
    return true;
  });
  const hidden = layout.units.flatMap((unit, index) => (unit.nodes === 0 ? [index] : []));

  const items: Item[] = [];
  let fresh: JSONContent[] = [];
  let nextHidden = 0;
  const closeFresh = () => {
    if (fresh.length > 0) items.push({ fresh });
    fresh = [];
  };
  const flushHidden = (limit: number) => {
    while (nextHidden < hidden.length && firstNode[hidden[nextHidden]] <= limit) {
      closeFresh();
      items.push({ unit: hidden[nextHidden] });
      nextHidden++;
    }
  };

  let lastMatched = -1;
  for (let index = 0; index < current.length; index++) {
    const original = match[index];
    if (original < 0) {
      flushHidden(lastMatched + 1);
      fresh.push(current[index]);
      continue;
    }
    flushHidden(original);
    const unit = unitOfNode[original];
    if (intact[unit] && firstNode[unit] === original) {
      closeFresh();
      items.push({ unit });
      index += layout.units[unit].nodes - 1;
      lastMatched = original + layout.units[unit].nodes - 1;
      continue;
    }
    fresh.push(current[index]);
    lastMatched = original;
  }
  closeFresh();
  flushHidden(Number.POSITIVE_INFINITY);

  const eol = [layout.trailing, ...layout.separators, ...layout.units.map((unit) => unit.source)].some(
    (text) => text.includes("\r\n"),
  )
    ? "\r\n"
    : "\n";
  let output = "";
  let previous: number | null = null;
  let started = false;
  for (const item of items) {
    const text =
      "unit" in item
        ? layout.units[item.unit].source
        : serializeNodes(item.fresh).replace(/\r?\n/gu, eol);
    if (text === "") continue;
    const unit = "unit" in item ? item.unit : null;
    if (started) {
      output +=
        unit !== null && previous !== null && unit === previous + 1
          ? layout.separators[previous]
          : eol + eol;
    }
    output += text;
    started = true;
    previous = unit;
  }
  return started ? output + layout.trailing : output;
}
