import type { PreservedInlineRange } from "../preserve-inline";

interface Flags {
  open: boolean;
  close: boolean;
}

interface Run {
  char: string;
  from: number;
  to: number;
  cm: Flags;
  pandoc: Flags;
}

type Reading = "cm" | "pandoc";

const SPACE = /[\t\n\v\f\r    -   　]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const ALNUM = /[\p{L}\p{N}]/u;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/u;
const SKIPPED_LINE = /^(?: {4}|\t|[ \t]{0,3}(?:<|([*_-])(?:[ \t]*\1){2,}[ \t]*$))/u;
const LINE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)*(?:[ \t]{0,3}(?:[*+-]|\d{1,9}[.)])[ \t]+)?(?:[ \t]{0,3}#{1,6}[ \t]+)?/u;
const UNSAFE = /[[\]()<>`|]/u;

function flagsOf(char: string, last: string, next: string): { cm: Flags; pandoc: Flags } {
  const lastSpace = last === "" || SPACE.test(last);
  const nextSpace = next === "" || SPACE.test(next);
  const lastPunct = !lastSpace && PUNCTUATION.test(last);
  const nextPunct = !nextSpace && PUNCTUATION.test(next);
  const left = !nextSpace && (!nextPunct || lastSpace || lastPunct);
  const right = !lastSpace && (!lastPunct || nextSpace || nextPunct);
  if (char === "*") return { cm: { open: left, close: right }, pandoc: { open: !nextSpace, close: !lastSpace } };
  return {
    cm: { open: left && (!right || lastPunct), close: right && (!left || nextPunct) },
    pandoc: { open: !nextSpace && !ALNUM.test(last), close: !lastSpace && !ALNUM.test(next) },
  };
}

function partnersOf(runs: readonly Run[], reading: Reading): number[][] {
  const left = runs.map((run) => run.to - run.from);
  const partners = runs.map((): number[] => []);
  const openers: number[] = [];
  runs.forEach((closer, at) => {
    if (closer[reading].close) {
      for (let slot = openers.length - 1; slot >= 0 && left[at] > 0; slot--) {
        const opener = openers[slot];
        const run = runs[opener];
        if (run.char !== closer.char || left[opener] === 0) continue;
        const lengths = [run.to - run.from, closer.to - closer.from];
        if (reading === "pandoc" && lengths[0] !== lengths[1] && !lengths.includes(3)) continue;
        const both = run[reading].close || closer[reading].open;
        if (reading === "cm" && both && (lengths[0] + lengths[1]) % 3 === 0 && (lengths[0] % 3 !== 0 || lengths[1] % 3 !== 0)) continue;
        const used = left[opener] >= 2 && left[at] >= 2 ? 2 : 1;
        left[opener] -= used;
        left[at] -= used;
        partners[opener].push(at);
        partners[at].push(opener);
        openers.splice(slot + 1);
        if (left[opener] > 0) slot++;
      }
    }
    if (closer[reading].open && left[at] > 0) openers.push(at);
  });
  return partners;
}

function disputedRuns(runs: readonly Run[], text: string): Set<number> {
  const cm = partnersOf(runs, "cm");
  const pandoc = partnersOf(runs, "pandoc");
  const disputed = new Set<number>();
  runs.forEach((_run, at) => {
    if (cm[at].join() !== pandoc[at].join()) disputed.add(at);
  });
  runs.forEach((run, at) => {
    for (const partner of cm[at]) {
      if (partner < at) continue;
      for (let inside = at + 1; inside < partner; inside++) {
        const between = runs[inside];
        const bare = SPACE.test(text[between.from - 1] ?? " ") && SPACE.test(text[between.to] ?? " ");
        if (between.char === run.char && cm[inside].length === 0 && !bare) disputed.add(at).add(partner).add(inside);
      }
    }
  });
  for (let grew = true; grew; ) {
    grew = false;
    for (const at of [...disputed]) {
      for (const partner of [...cm[at], ...pandoc[at]]) {
        if (disputed.has(partner)) continue;
        disputed.add(partner);
        grew = true;
      }
    }
  }
  return disputed;
}

function atomAt(excluded: readonly PreservedInlineRange[], at: number): PreservedInlineRange | undefined {
  return excluded.find((range) => range.from <= at && at < range.to);
}

function segmentRanges(text: string, from: number, to: number, excluded: readonly PreservedInlineRange[]): PreservedInlineRange[] {
  const charAt = (at: number, before: boolean): string => {
    const position = before ? at - 1 : at;
    if (position < from || position >= to) return "";
    if (atomAt(excluded, position)) return "a";
    return before ? (Array.from(text.slice(Math.max(from, at - 2), at)).at(-1) ?? "") : (Array.from(text.slice(at, at + 2))[0] ?? "");
  };
  const runs: Run[] = [];
  for (let at = from; at < to; at++) {
    const atom = atomAt(excluded, at);
    if (atom) {
      at = atom.to - 1;
      continue;
    }
    const char = text[at];
    if (char === "\\") {
      at++;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (text[at + run] === "`") run++;
      const close = text.indexOf("`".repeat(run), at + run);
      at = close < 0 || close >= to ? at + run - 1 : close + run - 1;
      continue;
    }
    if (char !== "*" && char !== "_") continue;
    let end = at + 1;
    while (end < to && text[end] === char) end++;
    runs.push({ char, from: at, to: end, ...flagsOf(char, charAt(at, true), charAt(end, false)) });
    at = end - 1;
  }
  const disputed = disputedRuns(runs, text);
  if (disputed.size === 0) return [];
  const involved = [...disputed].map((at) => runs[at]);
  const start = Math.min(...involved.map((run) => run.from));
  const end = Math.max(...involved.map((run) => run.to));
  const crossesAtom = excluded.some((range) => range.from < end && start < range.to);
  return crossesAtom || UNSAFE.test(text.slice(start, end)) ? [] : [{ from: start, to: end }];
}

export function disputedEmphasisRanges(
  text: string,
  from: number,
  excluded: readonly PreservedInlineRange[],
): PreservedInlineRange[] {
  const ranges: PreservedInlineRange[] = [];
  let fence: string | null = null;
  for (let start = from; start < text.length; ) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end);
    const opener = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (opener?.[0] === fence[0] && opener.length >= fence.length && line.trim() === opener) fence = null;
    } else if (opener) {
      fence = opener;
    } else if ((line.includes("*") || line.includes("_")) && !SKIPPED_LINE.test(line)) {
      let segment = start + (LINE_PREFIX.exec(line)?.[0].length ?? 0);
      for (let at = segment; at <= end; at++) {
        if (at < end && (text[at] !== "|" || text[at - 1] === "\\")) continue;
        ranges.push(...segmentRanges(text, segment, at, excluded));
        segment = at + 1;
      }
    }
    start = end + 1;
  }
  return ranges;
}
