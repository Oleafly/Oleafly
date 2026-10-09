export const LATEX_SECTION_LEVELS: Readonly<Record<string, number>> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

type ArgumentToken = "s" | "o" | "m";

export interface LatexSectionWrapper {
  readonly kind: "command" | "environment";
  readonly name: string;
  readonly level: number;
  readonly argument: number;
  readonly tokens: readonly ArgumentToken[];
}

export interface LatexDefinitions {
  readonly spans: readonly (readonly [number, number])[];
  readonly wrappers: readonly LatexSectionWrapper[];
}

export interface LatexWrapperSection {
  readonly level: number;
  readonly line: number;
  readonly title: string;
  readonly from: number;
  readonly to: number;
  readonly titleFrom: number;
  readonly titleTo: number;
}

type Head = Readonly<{
  pattern: RegExp;
  groups: number;
  bodyGroup: number;
  read: (match: RegExpExecArray, groups: readonly string[]) => Omit<
    LatexSectionWrapper,
    "level" | "argument"
  > | null;
}>;

const NAME = String.raw`(?:\{\s*\\([\p{L}\p{M}@]+)\s*\}|\\([\p{L}\p{M}@]+))`;
const COUNT_AND_DEFAULT = String.raw`(?:\[\s*(\d)\s*\]\s*)?(\[[^\]]*\]\s*)?`;
const SECTIONING = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\]\s*)?\{/gu;

function counted(count: string | undefined, optionalFirst: boolean): ArgumentToken[] {
  const total = Number(count ?? 0);
  const tokens: ArgumentToken[] = Array.from({ length: total }, () => "m");
  if (optionalFirst && total > 0) tokens[0] = "o";
  return tokens;
}

function xparseTokens(spec: string): ArgumentToken[] | null {
  const tokens: ArgumentToken[] = [];
  let index = 0;
  while (index < spec.length) {
    const character = spec[index];
    if (/\s|\+|!/u.test(character)) {
      index += 1;
    } else if (character === "s" || character === "o" || character === "m") {
      tokens.push(character);
      index += 1;
    } else if (character === "O" && spec[index + 1] === "{") {
      const close = matchingBrace(spec, index + 1);
      if (close < 0) return null;
      tokens.push("o");
      index = close + 1;
    } else {
      return null;
    }
  }
  return tokens;
}

const HEADS: readonly Head[] = [
  {
    pattern: new RegExp(
      String.raw`\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*${NAME}\s*${COUNT_AND_DEFAULT}(?=\{)`,
      "gu",
    ),
    groups: 1,
    bodyGroup: 0,
    read: (match) => ({
      kind: "command",
      name: match[1] ?? match[2],
      tokens: counted(match[3], match[4] !== undefined),
    }),
  },
  {
    pattern: /\\[gex]?def\s*\\([\p{L}\p{M}@]+)((?:[^{}\n\p{L}\p{M}@][^{}\n]*)?)(?=\{)/gu,
    groups: 1,
    bodyGroup: 0,
    read: (match) => {
      if (!/^(?:\s*#\d)*\s*$/u.test(match[2])) return null;
      return {
        kind: "command",
        name: match[1],
        tokens: counted(String(match[2].match(/#\d/gu)?.length ?? 0), false),
      };
    },
  },
  {
    pattern: new RegExp(
      String.raw`\\(?:newenvironment|renewenvironment|provideenvironment)\*?\s*\{([^{}]*)\}\s*${COUNT_AND_DEFAULT}(?=\{)`,
      "gu",
    ),
    groups: 2,
    bodyGroup: 0,
    read: (match) => ({
      kind: "environment",
      name: match[1].trim(),
      tokens: counted(match[2], match[3] !== undefined),
    }),
  },
  {
    pattern: new RegExp(
      String.raw`\\(?:New|Renew|Provide|Declare)DocumentCommand\s*${NAME}\s*(?=\{)`,
      "gu",
    ),
    groups: 2,
    bodyGroup: 1,
    read: (match, groups) => {
      const tokens = xparseTokens(groups[0]);
      return tokens ? { kind: "command", name: match[1] ?? match[2], tokens } : null;
    },
  },
  {
    pattern: /\\(?:New|Renew|Provide|Declare)DocumentEnvironment\s*\{([^{}]*)\}\s*(?=\{)/gu,
    groups: 3,
    bodyGroup: 1,
    read: (match, groups) => {
      const tokens = xparseTokens(groups[0]);
      return tokens ? { kind: "environment", name: match[1].trim(), tokens } : null;
    },
  },
];

export function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipSpace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/u.test(text[index])) index += 1;
  return index;
}

function wrapperSection(body: string): { level: number; argument: number } | null {
  SECTIONING.lastIndex = 0;
  for (let match = SECTIONING.exec(body); match; match = SECTIONING.exec(body)) {
    const open = SECTIONING.lastIndex - 1;
    const close = matchingBrace(body, open);
    if (close < 0) return null;
    const argument = /#(\d)/u.exec(body.slice(open + 1, close));
    if (argument) return { level: LATEX_SECTION_LEVELS[match[1]], argument: Number(argument[1]) };
    SECTIONING.lastIndex = close + 1;
  }
  return null;
}

function readGroups(text: string, from: number, count: number): { groups: string[]; end: number } {
  const groups: string[] = [];
  let position = from;
  let end = -1;
  for (let group = 0; group < count; group += 1) {
    position = skipSpace(text, position);
    if (text[position] !== "{") break;
    const close = matchingBrace(text, position);
    if (close < 0) break;
    groups.push(text.slice(position + 1, close));
    end = close + 1;
    position = end;
  }
  return { groups, end };
}

function sectionWrapper(
  head: Head,
  match: RegExpExecArray,
  groups: readonly string[],
): LatexSectionWrapper | null {
  const body = groups[head.bodyGroup];
  if (body === undefined) return null;
  const read = head.read(match, groups);
  if (!read || LATEX_SECTION_LEVELS[read.name] !== undefined) return null;
  const section = wrapperSection(body);
  if (!section || read.tokens[section.argument - 1] === undefined) return null;
  if (read.tokens[section.argument - 1] === "s") return null;
  return { ...read, ...section };
}

function mergeSpans(spans: (readonly [number, number])[]): (readonly [number, number])[] {
  spans.sort((left, right) => left[0] - right[0]);
  const merged: (readonly [number, number])[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] < last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], span[1])];
    else merged.push(span);
  }
  return merged;
}

export function scanLatexDefinitions(text: string): LatexDefinitions {
  const spans: (readonly [number, number])[] = [];
  const wrappers: LatexSectionWrapper[] = [];
  for (const head of HEADS) {
    head.pattern.lastIndex = 0;
    for (let match = head.pattern.exec(text); match; match = head.pattern.exec(text)) {
      const { groups, end } = readGroups(text, head.pattern.lastIndex, head.groups);
      if (end < 0) continue;
      spans.push([match.index, end]);
      const wrapper = sectionWrapper(head, match, groups);
      if (wrapper) wrappers.push(wrapper);
    }
  }
  return { spans: mergeSpans(spans), wrappers };
}

function spanAtOrBefore(spans: readonly (readonly [number, number])[], offset: number): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle][0] <= offset) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function insideLatexDefinition(
  spans: readonly (readonly [number, number])[],
  offset: number,
): boolean {
  const index = spanAtOrBefore(spans, offset);
  return index >= 0 && offset < spans[index][1];
}

export function latexDefinitionStartsAt(
  spans: readonly (readonly [number, number])[],
  offset: number,
): boolean {
  const index = spanAtOrBefore(spans, offset);
  return index >= 0 && spans[index][0] === offset;
}

type ArgumentRange = readonly [number, number] | null;

type ArgumentRead = Readonly<{ value: ArgumentRange; position: number }>;

function readStar(text: string, position: number): ArgumentRead {
  const next = skipSpace(text, position);
  return text[next] === "*" ? { value: [next, next + 1], position: next + 1 } : { value: null, position };
}

function readOptional(text: string, position: number): ArgumentRead | null {
  const next = skipSpace(text, position);
  if (text[next] !== "[") return { value: null, position };
  const close = text.indexOf("]", next);
  if (close < 0) return null;
  return { value: [next + 1, close], position: close + 1 };
}

function readMandatory(text: string, position: number): ArgumentRead | null {
  const next = skipSpace(text, position);
  if (text[next] !== "{") return null;
  const close = matchingBrace(text, next);
  if (close < 0) return null;
  return { value: [next + 1, close], position: close + 1 };
}

function argumentReader(token: ArgumentToken): (text: string, position: number) => ArgumentRead | null {
  if (token === "s") return readStar;
  if (token === "o") return readOptional;
  return readMandatory;
}

function readArguments(
  text: string,
  from: number,
  tokens: readonly ArgumentToken[],
): { values: ArgumentRange[]; end: number } | null {
  const values: ArgumentRange[] = [];
  let position = from;
  for (const token of tokens) {
    const read = argumentReader(token)(text, position);
    if (!read) return null;
    values.push(read.value);
    position = read.position;
  }
  return { values, end: position };
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function wrapperNames(wrappers: readonly LatexSectionWrapper[], kind: LatexSectionWrapper["kind"]): string {
  return [
    ...new Set(
      wrappers
        .filter((wrapper) => wrapper.kind === kind && wrapper.name !== "")
        .map((wrapper) => wrapper.name),
    ),
  ]
    .sort((left, right) => right.length - left.length)
    .map(escapeName)
    .join("|");
}

function wrapperPattern(commands: string, environments: string): RegExp {
  const alternatives = [
    commands ? String.raw`\\(${commands})(?![\p{L}\p{M}@])` : null,
    environments ? String.raw`\\begin\s*\{(${environments})\}` : null,
  ].filter((alternative) => alternative !== null);
  return new RegExp(alternatives.join("|"), "gu");
}

function matchedWrapper(
  match: RegExpExecArray,
  hasCommands: boolean,
  byName: ReadonlyMap<string, LatexSectionWrapper>,
): LatexSectionWrapper | undefined {
  if (!hasCommands) return byName.get(`environment:${match[1]}`);
  if (match[1]) return byName.get(`command:${match[1]}`);
  return byName.get(`environment:${match[2]}`);
}

function lineCounter(text: string): (offset: number) => number {
  let lineOffset = 0;
  let line = 1;
  return (offset) => {
    for (; lineOffset < offset; lineOffset += 1) {
      if (text[lineOffset] === "\n") line += 1;
    }
    return line;
  };
}

export function latexWrapperSections(
  text: string,
  wrappers: readonly LatexSectionWrapper[],
  spans: readonly (readonly [number, number])[] = scanLatexDefinitions(text).spans,
): LatexWrapperSection[] {
  if (wrappers.length === 0) return [];
  const byName = new Map<string, LatexSectionWrapper>();
  for (const wrapper of wrappers) byName.set(`${wrapper.kind}:${wrapper.name}`, wrapper);
  const commands = wrapperNames(wrappers, "command");
  const environments = wrapperNames(wrappers, "environment");
  if (!commands && !environments) return [];
  const pattern = wrapperPattern(commands, environments);
  const lineAt = lineCounter(text);
  const sections: LatexWrapperSection[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (insideLatexDefinition(spans, match.index)) continue;
    const wrapper = matchedWrapper(match, commands !== "", byName);
    if (!wrapper) continue;
    const parsed = readArguments(text, pattern.lastIndex, wrapper.tokens);
    const range = parsed?.values[wrapper.argument - 1];
    if (!parsed || !range) continue;
    const title = text.slice(range[0], range[1]);
    if (/#\d/u.test(title)) continue;
    sections.push({
      level: wrapper.level,
      line: lineAt(match.index),
      title: title.trim(),
      from: match.index,
      to: parsed.end,
      titleFrom: range[0],
      titleTo: range[1],
    });
  }
  return sections;
}
