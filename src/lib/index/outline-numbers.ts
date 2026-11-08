import { LATEX_DOCUMENT_SOURCE, LATEX_SECTION_LEVELS, latexHeadingTitleBrace } from "@oleafly/latex";
import type { AuxToc } from "@/lib/aux-numbers";
import { documentSourcePaths } from "@/lib/document-sources";
import { outlineFromIndex, type ExtraOutlineSection, type OutlineItem } from "./outline";
import { maskComments } from "./parse-file";
import type { ProjectIndex } from "./types";

export interface NumberingHeading {
  readonly level: number;
  readonly keys: readonly string[];
}

export interface NumberingTocEntry {
  readonly level: number;
  readonly key: string;
  readonly number: string | null;
}

export function headingKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const pairKey = (level: number, key: string): string => `${level}:${key}`;
const sourceKey = (item: OutlineItem): string => `${item.file}:${item.from}:${item.to}`;
const COMMAND_NAME = /\\([\p{L}\p{M}@]+)/uy;

type Pair = readonly [heading: number, entry: number];

interface Link {
  readonly pair: Pair;
  readonly previous: Link | null;
}

function increasingPairs(pairs: readonly Pair[]): Pair[] {
  const tails: Link[] = [];
  for (const pair of pairs) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle].pair[1] < pair[1]) low = middle + 1;
      else high = middle;
    }
    tails[low] = { pair, previous: low > 0 ? tails[low - 1] : null };
  }
  const run: Pair[] = [];
  for (let link = tails.at(-1) ?? null; link; link = link.previous) run.push(link.pair);
  return run.reverse();
}

class Matcher {
  readonly pairs: Pair[] = [];
  private readonly numberedLevels: ReadonlySet<number>;

  constructor(
    private readonly headings: readonly NumberingHeading[],
    private readonly toc: readonly NumberingTocEntry[],
  ) {
    this.numberedLevels = new Set(toc.flatMap((entry) => (entry.number === null ? [] : [entry.level])));
  }

  uniquePairs(headingFrom: number, headingTo: number, entryFrom: number, entryTo: number): Pair[] {
    const entries = new Map<string, number | null>();
    for (let at = entryFrom; at < entryTo; at++) {
      const { level, key } = this.toc[at];
      if (key === "") continue;
      const name = pairKey(level, key);
      entries.set(name, entries.has(name) ? null : at);
    }
    const holders = new Map<string, number | null>();
    for (let at = headingFrom; at < headingTo; at++) {
      const { level, keys } = this.headings[at];
      for (const key of new Set(keys)) {
        if (key === "") continue;
        const name = pairKey(level, key);
        holders.set(name, holders.has(name) ? null : at);
      }
    }
    const found = new Map<number, number | null>();
    for (const [name, heading] of holders) {
      const entry = entries.get(name);
      if (heading === null || entry === undefined || entry === null) continue;
      const earlier = found.get(heading);
      found.set(heading, earlier === undefined || earlier === entry ? entry : null);
    }
    return [...found]
      .flatMap(([heading, entry]): Pair[] => (entry === null ? [] : [[heading, entry]]))
      .sort((left, right) => left[0] - right[0]);
  }

  match(headingFrom: number, headingTo: number, entryFrom: number, entryTo: number): void {
    const anchors = increasingPairs(this.uniquePairs(headingFrom, headingTo, entryFrom, entryTo));
    if (anchors.length === 0) {
      this.fillGap(headingFrom, headingTo, entryFrom, entryTo);
      return;
    }
    let heading = headingFrom;
    let entry = entryFrom;
    for (const anchor of anchors) {
      this.match(heading, anchor[0], entry, anchor[1]);
      this.pairs.push(anchor);
      heading = anchor[0] + 1;
      entry = anchor[1] + 1;
    }
    this.match(heading, headingTo, entry, entryTo);
  }

  private fillTitleAlignedGap(headingFrom: number, headingTo: number, entryFrom: number, entryTo: number): boolean {
    const length = headingTo - headingFrom;
    if (length !== entryTo - entryFrom) return false;
    for (let offset = 0; offset < length; offset++) {
      const heading = this.headings[headingFrom + offset];
      const entry = this.toc[entryFrom + offset];
      if (entry.key === "" || heading.level !== entry.level || !heading.keys.includes(entry.key)) return false;
    }
    for (let offset = 0; offset < length; offset++) {
      this.pairs.push([headingFrom + offset, entryFrom + offset]);
    }
    return true;
  }

  private fillGap(headingFrom: number, headingTo: number, entryFrom: number, entryTo: number): void {
    if (this.fillTitleAlignedGap(headingFrom, headingTo, entryFrom, entryTo)) return;
    const headings: number[] = [];
    for (let at = headingFrom; at < headingTo; at++) {
      if (this.numberedLevels.has(this.headings[at].level)) headings.push(at);
    }
    const entries: number[] = [];
    for (let at = entryFrom; at < entryTo; at++) {
      if (this.toc[at].number !== null) entries.push(at);
    }
    if (headings.length !== entries.length) return;
    if (headings.some((at, index) => this.headings[at].level !== this.toc[entries[index]].level)) return;
    headings.forEach((at, index) => {
      this.pairs.push([at, entries[index]]);
    });
  }
}

function outlineMatches(
  headings: readonly (NumberingHeading | null)[],
  toc: readonly NumberingTocEntry[],
  mode: "ordered" | "unique" = "ordered",
): Pair[] {
  const taking: number[] = [];
  const comparable: NumberingHeading[] = [];
  headings.forEach((heading, index) => {
    if (heading === null) return;
    taking.push(index);
    comparable.push(heading);
  });
  const matcher = new Matcher(comparable, toc);
  if (mode === "ordered") matcher.match(0, comparable.length, 0, toc.length);
  const pairs = mode === "ordered" ? matcher.pairs : matcher.uniquePairs(0, comparable.length, 0, toc.length);
  return pairs.map(([heading, entry]): Pair => [taking[heading], entry]);
}

export function outlineNumbers(
  headings: readonly (NumberingHeading | null)[],
  toc: readonly NumberingTocEntry[],
): (string | null)[] {
  const numbers: (string | null)[] = headings.map(() => null);
  for (const [heading, entry] of outlineMatches(headings, toc)) numbers[heading] = toc[entry].number;
  return numbers;
}

// Older LaTeX writes non-ASCII text to the aux file wrapped in `\IeC`.
function asTexWrites(text: string): string {
  return text
    .replace(/\\nobreakspace\s*\{\s*\}/gu, "~")
    .replace(/\\IeC\s*\{([^{}]*)\}/gu, "$1")
    .replace(/\\texorpdfstring\s*\{([^{}]*)\}\s*\{[^{}]*\}/gu, "$1")
    .replace(/\\(?:label|index|glossary)\s*\{[^{}]*\}/gu, "");
}

function omittedOutlineItems(
  index: ProjectIndex,
  documentItems: readonly OutlineItem[],
  files: readonly string[],
  compiled: (file: string) => boolean,
  extraSections?: (file: string) => readonly ExtraOutlineSection[],
): OutlineItem[] {
  const seen = new Set(documentItems.map(sourceKey));
  const omitted: OutlineItem[] = [];
  const add = (file: string, section: ExtraOutlineSection) => {
    if (!LATEX_DOCUMENT_SOURCE.test(file) || !compiled(file)) return;
    const item: OutlineItem = { ...section, file, kind: "section" };
    const key = sourceKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    omitted.push(item);
  };
  for (const definition of index.defs) {
    if (definition.kind !== "section" || definition.name.trim() === "") continue;
    add(definition.file, {
      title: definition.name,
      level: definition.level ?? 2,
      line: definition.line,
      from: definition.from,
      to: definition.to,
    });
  }
  if (extraSections) {
    for (const file of files) {
      for (const section of extraSections(file)) add(file, section);
    }
  }
  return omitted;
}

export interface LatexOutlineNumbersInput {
  readonly items: readonly OutlineItem[];
  readonly viewer: string;
  readonly toc: AuxToc;
  readonly index: ProjectIndex;
  readonly texts: Readonly<Record<string, string>>;
  readonly extraSections?: (file: string) => readonly ExtraOutlineSection[];
  readonly render: (tex: string) => string;
}

export function latexOutlineNumbers({
  items,
  viewer,
  toc,
  index,
  texts,
  extraSections,
  render,
}: LatexOutlineNumbersInput): (string | null)[] {
  const scope = index.unitScope;
  const included = scope ? null : new Set(documentSourcePaths(index, toc.mainDocument));
  const compiled = (file: string) =>
    scope ? scope.sharesScope(toc.mainDocument, file) : (included?.has(file) ?? false);
  if (!compiled(viewer) || toc.entries.length === 0) return items.map(() => null);
  const documentItems = outlineFromIndex(index, toc.mainDocument, extraSections).filter(
    (item) => item.kind === "section",
  );
  const maskedTexts = new Map<string, string>();
  const headingHead = (item: OutlineItem) => {
    const raw = texts[item.file];
    if (raw === undefined) return null;
    let text = maskedTexts.get(item.file);
    if (text === undefined) {
      text = maskComments(raw);
      maskedTexts.set(item.file, text);
    }
    COMMAND_NAME.lastIndex = item.from;
    const command = COMMAND_NAME.exec(text);
    if (!command || !Object.hasOwn(LATEX_SECTION_LEVELS, command[1])) return null;
    return latexHeadingTitleBrace(text, item.from);
  };
  const titleKey = (tex: string) => headingKey(render(asTexWrites(tex)));
  const numberingHeading = (item: OutlineItem): NumberingHeading | null => {
    if (item.kind !== "section" || !LATEX_DOCUMENT_SOURCE.test(item.file) || !compiled(item.file)) return null;
    const head = headingHead(item);
    if (head?.starred) return null;
    const keys = [titleKey(item.title)];
    if (head && head.shortTitle !== null) keys.push(titleKey(head.shortTitle));
    return { level: item.level, keys };
  };
  const headings = documentItems.map(numberingHeading);
  const entries = toc.entries.map((entry) => {
    const number = entry.number === null ? "" : render(asTexWrites(entry.number));
    return { level: entry.level, key: titleKey(entry.title), number: number === "" ? null : number };
  });
  const numbersBySource = new Map<string, string | null>();
  const omittedItems = omittedOutlineItems(index, documentItems, Object.keys(texts), compiled, extraSections);
  const reservedEntries = new Set<number>();
  if (omittedItems.length > 0) {
    const allHeadings = [...headings, ...omittedItems.map(numberingHeading)];
    for (const [heading, entry] of outlineMatches(allHeadings, entries, "unique")) {
      if (heading < headings.length) continue;
      reservedEntries.add(entry);
      numbersBySource.set(sourceKey(omittedItems[heading - headings.length]), entries[entry].number);
    }
  }
  const remainingEntries = entries.filter((_, entry) => !reservedEntries.has(entry));
  const documentNumbers = outlineNumbers(headings, remainingEntries);
  documentItems.forEach((item, heading) => {
    numbersBySource.set(sourceKey(item), documentNumbers[heading]);
  });
  return items.map((item) =>
    item.kind === "section" ? (numbersBySource.get(sourceKey(item)) ?? null) : null,
  );
}
