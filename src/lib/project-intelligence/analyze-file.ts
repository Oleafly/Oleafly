import { parseFile } from "@/lib/index/parse-file";
import type { Sym } from "@/lib/index/types";
import {
  latexBalancedGroupEnd,
  maskLatexIgnoredRegions,
  validateXparseArgumentSpecification,
} from "@oleafly/editor/latex-analysis";
import { type BibliographyEngine, bibliographyCandidatePaths } from "@oleafly/latex";
import { astAugmentLatexFile } from "./latex-ast";
import { bibliographyEntrySummary } from "./bibliography-summary";
import { parseBibtexIntelligence } from "./parse-bibtex";
import {
  engineForPath,
  lineStarts,
  location,
  maskTypstComments,
  rangeFromOffsets,
  resolveProjectPath,
  sourceHash,
  stableId,
} from "./source";
import type {
  FileAnalysis,
  OutlineNode,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectDiagnostic,
  ProjectEdge,
  ProjectIntelligenceEngine,
  ProjectUse,
  ProjectUseKind,
  LatexDefinitionArguments,
  PackageReference,
  SourceRange,
} from "./types";

interface DelimitedGroup {
  readonly open: "[" | "{";
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly complete: boolean;
}

type CommandGroupIndex = ReadonlyMap<number, number>;

function buildCommandGroupIndex(source: string): CommandGroupIndex {
  const closingByOpening = new Map<number, number>();
  const square: number[] = [];
  const brace: number[] = [];
  for (let cursor = 0; cursor < source.length; cursor++) {
    if (source[cursor] === "\\") {
      cursor++;
      continue;
    }
    if (source[cursor] === "[") {
      square.push(cursor);
    } else if (source[cursor] === "{") {
      brace.push(cursor);
    } else if (source[cursor] === "]") {
      const opening = square.pop();
      if (opening !== undefined) {
        closingByOpening.set(opening, cursor + 1);
      }
    } else if (source[cursor] === "}") {
      const opening = brace.pop();
      if (opening !== undefined) {
        closingByOpening.set(opening, cursor + 1);
      }
    }
  }
  return closingByOpening;
}

function commandGroups(
  source: string,
  offset: number,
  closingByOpening: CommandGroupIndex,
): readonly DelimitedGroup[] {
  const groups: DelimitedGroup[] = [];
  let cursor = offset;
  for (;;) {
    // Comment masking preserves line breaks. Treat every whitespace character
    // as an argument separator so `\cite% comment\n{key}` and commands split
    // across lines retain the same argument semantics as TeX.
    while (cursor < source.length && /\s/u.test(source[cursor])) {
      cursor++;
    }
    const open = source[cursor];
    if (open !== "[" && open !== "{") break;
    const from = cursor;
    const to = closingByOpening.get(from);
    const complete = to !== undefined;
    groups.push({
      open,
      from,
      to: to ?? Math.min(source.length, from + 1),
      contentFrom: from + 1,
      contentTo: to === undefined ? from + 1 : to - 1,
      complete,
    });
    if (!complete) break;
    cursor = to;
  }
  return groups;
}

interface LogicalGroupToken {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

interface LogicalCharacter {
  readonly value: string;
  readonly offset: number;
}

function flushLogicalToken(
  logical: readonly LogicalCharacter[],
  result: LogicalGroupToken[],
): void {
  let fromIndex = 0;
  let toIndex = logical.length;
  while (fromIndex < toIndex && /\s/u.test(logical[fromIndex].value)) {
    fromIndex++;
  }
  while (toIndex > fromIndex && /\s/u.test(logical[toIndex - 1].value)) {
    toIndex--;
  }
  const visible = logical.slice(fromIndex, toIndex);
  const name = visible.map((character) => character.value).join("");
  const last = visible.at(-1);
  if (name && name !== "*" && last) {
    result.push({
      name,
      from: visible[0].offset,
      to: last.offset + 1,
    });
  }
}

function precedingBackslashCount(
  source: string,
  cursor: number,
  contentFrom: number,
): number {
  let slashes = 0;
  for (
    let preceding = cursor - 1;
    preceding >= contentFrom && source[preceding] === "\\";
    preceding--
  ) {
    slashes++;
  }
  return slashes;
}

function skipLatexGroupComment(
  source: string,
  cursor: number,
  contentTo: number,
): number {
  let next = cursor + 1;
  while (
    next < contentTo &&
    source[next] !== "\n" &&
    source[next] !== "\r"
  ) {
    next++;
  }
  if (next < contentTo && source[next] === "\r" && source[next + 1] === "\n") {
    return next + 2;
  }
  if (next < contentTo) return next + 1;
  return next;
}

function latexLogicalGroupTokens(
  source: string,
  group: DelimitedGroup,
  split = true,
): readonly LogicalGroupToken[] {
  if (!group.complete) return [];
  const result: LogicalGroupToken[] = [];
  let logical: LogicalCharacter[] = [];

  let cursor = group.contentFrom;
  while (cursor < group.contentTo) {
    const character = source[cursor];
    if (
      character === "%" &&
      precedingBackslashCount(source, cursor, group.contentFrom) % 2 === 0
    ) {
      cursor = skipLatexGroupComment(source, cursor, group.contentTo);
      continue;
    }
    if (split && (character === "," || character === ";")) {
      flushLogicalToken(logical, result);
      logical = [];
      cursor++;
      continue;
    }
    logical.push({ value: character, offset: cursor });
    cursor++;
  }
  flushLogicalToken(logical, result);
  return result;
}

const LATEX_CITATION_COMMANDS = new Set([
  "cite",
  "cites",
  "citep",
  "citet",
  "citealp",
  "citealt",
  "citeauthor",
  "citeauthor*",
  "citeyear",
  "citeyearpar",
  "parencite",
  "parencites",
  "textcite",
  "textcites",
  "autocite",
  "autocites",
  "footcite",
  "footcites",
  "smartcite",
  "smartcites",
  "supercite",
  "fullcite",
  "notecite",
  "nocite",
  "volcite",
  "volcites",
  "pvolcite",
  "pvolcites",
  "tvolcite",
  "tvolcites",
  "fvolcite",
  "fvolcites",
]);

function isLatexCitationCommand(command: string): boolean {
  return LATEX_CITATION_COMMANDS.has(
    command.toLocaleLowerCase("en-US"),
  );
}

export interface LatexCommandKeyToken {
  readonly command: string;
  readonly kind: "reference" | "citation";
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

function latexCommandKeyTokensFromMasked(
  source: string,
  masked: string,
  closingByOpening: CommandGroupIndex,
): readonly LatexCommandKeyToken[] {
  const tokens: LatexCommandKeyToken[] = [];
  collectReferenceKeyTokens(source, masked, closingByOpening, tokens);
  collectHyperrefKeyTokens(source, masked, closingByOpening, tokens);
  collectCitationKeyTokens(source, masked, closingByOpening, tokens);
  return tokens.sort((left, right) => left.from - right.from);
}

function pushKeyTokens(
  source: string,
  groups: readonly DelimitedGroup[],
  command: string,
  kind: "reference" | "citation",
  tokens: LatexCommandKeyToken[],
  split = true,
): void {
  for (const group of groups) {
    for (const token of latexLogicalGroupTokens(source, group, split)) {
      tokens.push({ command, kind, ...token });
    }
  }
}

function collectReferenceKeyTokens(
  source: string,
  masked: string,
  closingByOpening: CommandGroupIndex,
  tokens: LatexCommandKeyToken[],
): void {
  const referenceCommands =
    /\\(crefrange|Crefrange|cpagerefrange|vpagerefrange|hyperlink|ref|eqref|pageref|autoref|cref|Cref|cpageref|vref|Vref|labelcref|nameref|namecref|fref|sref|labelref)\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(referenceCommands)) {
    const braced = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    ).filter((group) => group.open === "{");
    const selected = /range$/i.test(match[1])
      ? braced.slice(0, 2)
      : braced.slice(0, 1);
    pushKeyTokens(source, selected, match[1], "reference", tokens);
  }
}

function collectHyperrefKeyTokens(
  source: string,
  masked: string,
  closingByOpening: CommandGroupIndex,
  tokens: LatexCommandKeyToken[],
): void {
  const hyperref = /\\hyperref\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(hyperref)) {
    const group = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    ).find((candidate) => candidate.open === "[");
    if (!group) continue;
    pushKeyTokens(source, [group], "hyperref", "reference", tokens, false);
  }
}

function citationKeyGroups(
  command: string,
  braced: readonly DelimitedGroup[],
): readonly DelimitedGroup[] {
  const allCites = command.endsWith("cites");
  if (command.includes("volcite")) {
    return allCites
      ? braced.filter((_group, index) => index % 2 === 1)
      : braced.slice(-1);
  }
  return allCites ? braced : braced.slice(0, 1);
}

function collectCitationKeyTokens(
  source: string,
  masked: string,
  closingByOpening: CommandGroupIndex,
  tokens: LatexCommandKeyToken[],
): void {
  const commands = /\\([A-Za-z@]+)\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(commands)) {
    if (!isLatexCitationCommand(match[1])) continue;
    const braced = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    ).filter((group) => group.open === "{");
    if (braced.length === 0) continue;
    const command = match[1].toLocaleLowerCase("en-US");
    pushKeyTokens(
      source,
      citationKeyGroups(command, braced),
      match[1],
      "citation",
      tokens,
    );
  }
}

export function latexCommandKeyTokens(
  source: string,
): readonly LatexCommandKeyToken[] {
  const masked = maskLatexIgnoredRegions(source);
  return latexCommandKeyTokensFromMasked(
    source,
    masked,
    buildCommandGroupIndex(masked),
  );
}

function definitionKind(
  symbol: Sym,
): ProjectDefinitionKind | null {
  switch (symbol.kind) {
    case "section":
    case "label":
    case "macro":
    case "environment":
    case "bibentry":
      return symbol.kind;
    case "theorem":
      return "environment";
    case "glossary":
      return "label";
    default:
      return null;
  }
}

function projectUseKind(
  symbol: Sym,
  source: string,
): ProjectUseKind | null {
  switch (symbol.kind) {
    case "ref":
    case "atuse":
      return "reference";
    case "cite":
      return "citation";
    case "macrouse":
      return "macro";
    case "envuse":
      return "environment";
    case "inputedge":
      return source.slice(symbol.from, symbol.to).includes("import")
        ? "import"
        : "include";
    default:
      return null;
  }
}

function uniqueById<T extends { readonly id: string }>(
  values: readonly T[],
): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

interface DelimiterScanState {
  readonly pairs: Record<string, string>;
  readonly closers: ReadonlySet<string>;
  readonly stack: { char: string; offset: number }[];
  quote: boolean;
}

function delimiterStepReportsClosing(
  masked: string,
  offset: number,
  engine: ProjectIntelligenceEngine,
  state: DelimiterScanState,
): boolean {
  const char = masked[offset];
  if (engine === "typst" && char === '"' && masked[offset - 1] !== "\\") {
    state.quote = !state.quote;
    return false;
  }
  if (state.quote) return false;
  if (
    engine === "latex" &&
    precedingBackslashCount(masked, offset, 0) % 2 === 1
  ) {
    return false;
  }
  if (char in state.pairs) {
    state.stack.push({ char, offset });
    return false;
  }
  if (!state.closers.has(char)) return false;
  const expected = state.stack.at(-1);
  if (expected && state.pairs[expected.char] === char) {
    state.stack.pop();
    return false;
  }
  return true;
}

function pushUnexpectedDelimiter(
  file: string,
  starts: readonly number[],
  offset: number,
  char: string,
  diagnostics: ProjectDiagnostic[],
): void {
  diagnostics.push({
    id: stableId("diag", file, offset, "unexpected-delimiter", char),
    source: "project-intelligence",
    severity: "error",
    code: "malformed-source",
    message: { key: "unexpectedClosingDelimiter", params: { char } },
    location: location(file, starts, offset, offset + 1),
    related: [],
  });
}

function pushUnclosedDelimiters(
  file: string,
  starts: readonly number[],
  state: DelimiterScanState,
  diagnostics: ProjectDiagnostic[],
): void {
  for (const unmatched of state.stack.slice(-32)) {
    const expected = state.pairs[unmatched.char];
    diagnostics.push({
      id: stableId(
        "diag",
        file,
        unmatched.offset,
        "unclosed-delimiter",
        unmatched.char,
      ),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: {
        key: "unclosedDelimiter",
        params: { char: unmatched.char, expected: expected ?? "" },
      },
      location: location(
        file,
        starts,
        unmatched.offset,
        unmatched.offset + 1,
      ),
      related: [],
    });
  }
}

function pushUnclosedString(
  file: string,
  source: string,
  starts: readonly number[],
  diagnostics: ProjectDiagnostic[],
): void {
  const offset = Math.max(0, source.lastIndexOf('"'));
  diagnostics.push({
    id: stableId("diag", file, offset, "unclosed-string"),
    source: "project-intelligence",
    severity: "error",
    code: "malformed-source",
    message: { key: "unclosedString" },
    location: location(file, starts, offset, offset + 1),
    related: [],
  });
}

function addDelimiterDiagnostics(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  engine: ProjectIntelligenceEngine,
  diagnostics: ProjectDiagnostic[],
): boolean {
  const nonLatexPairs: Record<string, string> =
    engine === "typst" ? { "{": "}", "[": "]", "(": ")" } : {};
  const pairs: Record<string, string> =
    engine === "latex" ? { "{": "}" } : nonLatexPairs;
  const state: DelimiterScanState = {
    pairs,
    closers: new Set(Object.values(pairs)),
    stack: [],
    quote: false,
  };
  let partial = false;
  for (let offset = 0; offset < masked.length; offset++) {
    if (!delimiterStepReportsClosing(masked, offset, engine, state)) continue;
    partial = true;
    pushUnexpectedDelimiter(
      file,
      starts,
      offset,
      masked[offset],
      diagnostics,
    );
  }
  if (state.stack.length > 0) {
    partial = true;
    pushUnclosedDelimiters(file, starts, state, diagnostics);
  }
  if (engine === "typst" && state.quote) {
    partial = true;
    pushUnclosedString(file, source, starts, diagnostics);
  }
  return partial;
}

function maskQuotedStep(
  chars: string[],
  index: number,
): { next: number; quoted: boolean } {
  if (chars[index] === "\\") {
    chars[index] = " ";
    if (index + 1 < chars.length) {
      const escaped = index + 1;
      if (chars[escaped] !== "\n") chars[escaped] = " ";
      return { next: escaped, quoted: true };
    }
    return { next: index, quoted: true };
  }
  if (chars[index] === '"') return { next: index, quoted: false };
  if (chars[index] !== "\n") chars[index] = " ";
  return { next: index, quoted: true };
}

function maskQuotedContents(source: string): string {
  const chars = source.split("");
  let quoted = false;
  let index = 0;
  while (index < chars.length) {
    if (!quoted) {
      if (chars[index] === '"') quoted = true;
      index++;
      continue;
    }
    const step = maskQuotedStep(chars, index);
    quoted = step.quoted;
    index = step.next + 1;
  }
  return chars.join("");
}

interface TypstCommentState {
  readonly stack: number[];
  quoted: boolean;
}

function typstBlockCommentStep(
  source: string,
  offset: number,
  stack: number[],
): number {
  if (source.startsWith("/*", offset)) {
    stack.push(offset);
    return offset + 2;
  }
  if (source.startsWith("*/", offset)) {
    stack.pop();
    return offset + 2;
  }
  return offset + 1;
}

function typstQuotedStep(
  source: string,
  offset: number,
  state: TypstCommentState,
): number {
  if (source[offset] === "\\") return offset + 2;
  if (source[offset] === '"') state.quoted = false;
  return offset + 1;
}

function typstCommentStep(
  source: string,
  offset: number,
  state: TypstCommentState,
): number {
  if (state.stack.length > 0) {
    return typstBlockCommentStep(source, offset, state.stack);
  }
  if (state.quoted) return typstQuotedStep(source, offset, state);
  if (source[offset] === '"') {
    state.quoted = true;
    return offset + 1;
  }
  if (source.startsWith("//", offset)) {
    const newline = source.indexOf("\n", offset + 2);
    return newline < 0 ? -1 : newline + 1;
  }
  if (source.startsWith("/*", offset)) {
    state.stack.push(offset);
    return offset + 2;
  }
  return offset + 1;
}

function typstCommentDiagnostics(
  file: string,
  source: string,
  starts: readonly number[],
  diagnostics: ProjectDiagnostic[],
): boolean {
  const state: TypstCommentState = { stack: [], quoted: false };
  let offset = 0;
  while (offset < source.length) {
    const next = typstCommentStep(source, offset, state);
    if (next < 0) break;
    offset = next;
  }
  for (const commentOffset of state.stack.slice(-32)) {
    diagnostics.push({
      id: stableId("diag", file, commentOffset, "typst-comment"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: { key: "unclosedTypstComment" },
      location: location(
        file,
        starts,
        commentOffset,
        Math.min(source.length, commentOffset + 2),
      ),
      related: [],
    });
  }
  return state.stack.length > 0;
}

function latexEnvironmentDiagnostics(
  file: string,
  masked: string,
  starts: readonly number[],
  diagnostics: ProjectDiagnostic[],
): boolean {
  const stack: { name: string; from: number; to: number }[] = [];
  let partial = false;
  const expression = /\\(begin|end)\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(expression)) {
    const name = match[2].trim();
    if (!name) continue;
    if (match[1] === "begin") {
      stack.push({
        name,
        from: match.index,
        to: match.index + match[0].length,
      });
      continue;
    }
    const open = stack.at(-1);
    if (open?.name === name) {
      stack.pop();
      continue;
    }
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, match.index, "environment-end", name),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: open
        ? {
            key: "expectedEndBefore" as const,
            params: {
              expected: String.raw`\end{${open.name}}`,
              found: String.raw`\end{${name}}`,
            },
          }
        : {
            key: "endWithoutBegin" as const,
            params: { command: String.raw`\end{${name}}` },
          },
      location: location(
        file,
        starts,
        match.index,
        match.index + match[0].length,
      ),
      related: open
        ? [
            {
              message: {
                key: "beginIsHere" as const,
                params: { command: String.raw`\begin{${open.name}}` },
              },
              location: location(file, starts, open.from, open.to),
            },
          ]
        : [],
    });
  }
  for (const open of stack.slice(-32)) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, open.from, "environment-open", open.name),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: {
        key: "beginWithoutEnd" as const,
        params: { command: String.raw`\begin{${open.name}}` },
      },
      location: location(file, starts, open.from, open.to),
      related: [],
    });
  }
  return partial;
}

function addUse(
  list: ProjectUse[],
  engine: ProjectIntelligenceEngine,
  file: string,
  starts: readonly number[],
  kind: ProjectUseKind,
  name: string,
  from: number,
  to: number,
  target?: string,
  syntax?: ProjectUse["syntax"],
): ProjectUse {
  const use: ProjectUse = {
    id: stableId("use", "local", file, from, kind, name),
    source: "local",
    engine,
    kind,
    name,
    location: location(file, starts, from, to),
    ...(target ? { target } : {}),
    ...(syntax ? { syntax } : {}),
    resolution: "unresolved",
    definitionIds: [],
  };
  list.push(use);
  return use;
}

function addDefinition(
  list: ProjectDefinition[],
  engine: ProjectIntelligenceEngine,
  file: string,
  starts: readonly number[],
  kind: ProjectDefinitionKind,
  name: string,
  from: number,
  to: number,
  detail?: string,
  level?: number,
  latexArguments?: LatexDefinitionArguments,
): ProjectDefinition {
  const definition: ProjectDefinition = {
    id: stableId("def", "local", file, from, kind, name),
    source: "local",
    engine,
    kind,
    name,
    location: location(file, starts, from, to),
    ...(detail ? { detail } : {}),
    ...(level === undefined ? {} : { level }),
    ...(latexArguments ? { latexArguments } : {}),
  };
  list.push(definition);
  return definition;
}

function edgeForUse(
  use: ProjectUse,
  targetFile: string | null,
  bibliographyEngine?: BibliographyEngine,
): ProjectEdge {
  const kind =
    use.kind === "include" ||
    use.kind === "import" ||
    use.kind === "link" ||
    use.kind === "asset" ||
    use.kind === "bibliography"
      ? use.kind
      : "link";
  return {
    id: stableId("edge", use.location.file, use.location.range.from, kind),
    kind,
    fromFile: use.location.file,
    location: use.location,
    rawTarget: use.name,
    targetFile,
    resolution: targetFile ? "unresolved" : "external",
    candidateFiles: [],
    ...(bibliographyEngine ? { bibliographyEngine } : {}),
  };
}

function outlineForDefinitions(
  file: string,
  definitions: readonly ProjectDefinition[],
  fullRanges: ReadonlyMap<string, SourceRange>,
): OutlineNode[] {
  const ordered = definitions
    .filter((definition) =>
      [
        "section",
        "label",
        "macro",
        "environment",
        "bibentry",
      ].includes(definition.kind),
    )
    .sort(
      (left, right) =>
        left.location.range.from - right.location.range.from ||
        left.id.localeCompare(right.id),
    );
  const outline: OutlineNode[] = [];
  const sectionStack: { level: number; id: string }[] = [];
  for (const definition of ordered) {
    const isSection = definition.kind === "section";
    const enclosingLevel =
      sectionStack.length > 0 ? sectionStack.at(-1)?.level ?? 0 : 0;
    const level = isSection
      ? Math.max(0, definition.level ?? 0)
      : enclosingLevel;
    if (isSection) {
      while (
        sectionStack.length > 0 &&
        (sectionStack.at(-1)?.level ?? 0) >= level
      ) {
        sectionStack.pop();
      }
    }
    const id = stableId(
      "outline",
      file,
      definition.location.range.from,
      definition.kind,
    );
    outline.push({
      id,
      file,
      title: definition.name,
      kind: definition.kind,
      level,
      parentId: sectionStack.at(-1)?.id ?? null,
      range: fullRanges.get(definition.id) ?? definition.location.range,
      definitionId: definition.id,
    });
    if (isSection) sectionStack.push({ level, id });
  }
  return outline;
}

interface LatexGroup {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
}

function skipLatexWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function latexGroup(
  source: string,
  start: number,
  opening = "{",
  closing = "}",
): LatexGroup | null {
  const from = skipLatexWhitespace(source, start);
  const to = latexBalancedGroupEnd(
    source,
    from,
    opening,
    closing,
  );
  if (to === null) return null;
  return {
    from,
    to,
    contentFrom: from + 1,
    contentTo: to - 1,
  };
}

interface LatexDefinitionName {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly next: number;
}

function latexDefinitionName(
  source: string,
  start: number,
  requireBraces: boolean,
): LatexDefinitionName | null {
  const cursor = skipLatexWhitespace(source, start);
  if (source[cursor] === "{") {
    const group = latexGroup(source, cursor);
    if (!group) return null;
    const content = source.slice(
      group.contentFrom,
      group.contentTo,
    );
    const match = /\\([A-Za-z@]+|.)/u.exec(content.trim());
    if (match?.[0] !== content.trim()) return null;
    const slash = source.indexOf("\\", group.contentFrom);
    return {
      name: match[1],
      from: slash + 1,
      to: slash + 1 + match[1].length,
      next: group.to,
    };
  }
  if (requireBraces || source[cursor] !== "\\") return null;
  const match = /^\\([A-Za-z@]+|.)/u.exec(source.slice(cursor));
  if (!match) return null;
  return {
    name: match[1],
    from: cursor + 1,
    to: cursor + 1 + match[1].length,
    next: cursor + match[0].length,
  };
}

function snippetPlaceholder(
  index: number,
  defaultValue?: string,
): string {
  const escaped = defaultValue
    ?.trim()
    .replace(/[\\$}]/gu, String.raw`\$&`);
  return escaped
    ? `\${${index}:${escaped}}`
    : `\${${index}}`;
}

function classicLatexArguments(
  source: string,
  masked: string,
  start: number,
): { readonly arguments: LatexDefinitionArguments; readonly next: number } {
  let cursor = start;
  let argumentCount = 0;
  let optionalDefault: string | undefined;
  const count = latexGroup(masked, cursor, "[", "]");
  if (
    count &&
    /^\d$/u.test(
      source.slice(count.contentFrom, count.contentTo).trim(),
    )
  ) {
    argumentCount = Number(
      source.slice(count.contentFrom, count.contentTo).trim(),
    );
    cursor = count.to;
    const defaultValue = latexGroup(masked, cursor, "[", "]");
    if (defaultValue) {
      optionalDefault = source.slice(
        defaultValue.contentFrom,
        defaultValue.contentTo,
      );
      cursor = defaultValue.to;
    }
  }

  let completionSnippet = "";
  for (let index = 1; index <= argumentCount; index += 1) {
    completionSnippet +=
      index === 1 && optionalDefault !== undefined
        ? `[${snippetPlaceholder(index, optionalDefault)}]`
        : `{${snippetPlaceholder(index)}}`;
  }
  return {
    arguments: {
      syntax: "classic",
      requiredCount:
        argumentCount - (optionalDefault === undefined ? 0 : 1),
      optionalCount: optionalDefault === undefined ? 0 : 1,
      ...(optionalDefault === undefined ? {} : { optionalDefault }),
      completionSnippet,
    },
    next: cursor,
  };
}

function xparseDelimiterToken(
  source: string,
  start: number,
): { readonly value: string; readonly next: number } {
  const cursor = skipLatexWhitespace(source, start);
  if (source[cursor] === "{") {
    const group = latexGroup(source, cursor);
    if (group) {
      return {
        value: source.slice(group.contentFrom, group.contentTo),
        next: group.to,
      };
    }
  }
  if (source[cursor] === "\\") {
    const match = /^\\(?:[A-Za-z@]+|.)/u.exec(
      source.slice(cursor),
    );
    if (match) {
      return { value: match[0], next: cursor + match[0].length };
    }
  }
  return {
    value: source[cursor] ?? "",
    next: Math.min(source.length, cursor + 1),
  };
}

interface XparseState {
  completionSnippet: string;
  requiredCount: number;
  optionalCount: number;
  placeholder: number;
  cursor: number;
}

function skipXparseModifiers(
  specification: string,
  cursor: number,
): number {
  let next = skipLatexWhitespace(specification, cursor);
  while (
    specification[next] === "+" ||
    specification[next] === "!"
  ) {
    next = skipLatexWhitespace(specification, next + 1);
  }
  while (specification[next] === ">") {
    const processor = latexGroup(specification, next + 1);
    next = skipLatexWhitespace(
      specification,
      processor?.to ?? specification.length,
    );
  }
  return next;
}

function xparseSimpleArgument(type: string, state: XparseState): boolean {
  if (type === "m" || type === "b" || type === "v") {
    state.completionSnippet += `{${snippetPlaceholder(state.placeholder)}}`;
    state.placeholder += 1;
    state.requiredCount += 1;
    return true;
  }
  if (type === "o") {
    state.completionSnippet += `[${snippetPlaceholder(state.placeholder)}]`;
    state.placeholder += 1;
    state.optionalCount += 1;
    return true;
  }
  return false;
}

function xparseOptionalDefault(
  specification: string,
  state: XparseState,
): void {
  const defaultValue = latexGroup(specification, state.cursor);
  const value = defaultValue
    ? specification.slice(
        defaultValue.contentFrom,
        defaultValue.contentTo,
      )
    : undefined;
  state.cursor = defaultValue?.to ?? state.cursor;
  state.completionSnippet += `[${snippetPlaceholder(state.placeholder, value)}]`;
  state.placeholder += 1;
  state.optionalCount += 1;
}

function xparseSwitch(
  type: string,
  specification: string,
  state: XparseState,
): void {
  if (type === "t") {
    state.cursor = xparseDelimiterToken(
      specification,
      state.cursor,
    ).next;
  }
  state.completionSnippet += snippetPlaceholder(state.placeholder);
  state.placeholder += 1;
  state.optionalCount += 1;
}

function xparseDelimited(
  type: string,
  specification: string,
  state: XparseState,
): void {
  const left = xparseDelimiterToken(specification, state.cursor);
  const right = xparseDelimiterToken(specification, left.next);
  state.cursor = right.next;
  if (type === "R" || type === "D") {
    state.cursor = latexGroup(specification, state.cursor)?.to ?? state.cursor;
  }
  state.completionSnippet += `${left.value}${snippetPlaceholder(state.placeholder)}${right.value}`;
  state.placeholder += 1;
  if (type === "r" || type === "R") state.requiredCount += 1;
  else state.optionalCount += 1;
}

function xparseEmbellishment(
  type: string,
  specification: string,
  state: XparseState,
): void {
  state.cursor = latexGroup(specification, state.cursor)?.to ?? state.cursor;
  if (type === "E") {
    state.cursor = latexGroup(specification, state.cursor)?.to ?? state.cursor;
  }
  state.completionSnippet += snippetPlaceholder(state.placeholder);
  state.placeholder += 1;
  state.optionalCount += 1;
}

function xparseArgument(
  type: string,
  specification: string,
  state: XparseState,
): void {
  if (xparseSimpleArgument(type, state)) return;
  if (type === "O") {
    xparseOptionalDefault(specification, state);
    return;
  }
  if (type === "s" || type === "t") {
    xparseSwitch(type, specification, state);
    return;
  }
  if (type === "r" || type === "R" || type === "d" || type === "D") {
    xparseDelimited(type, specification, state);
    return;
  }
  if (type === "e" || type === "E") {
    xparseEmbellishment(type, specification, state);
  }
}

function xparseLatexArguments(
  specification: string,
): LatexDefinitionArguments {
  const state: XparseState = {
    completionSnippet: "",
    requiredCount: 0,
    optionalCount: 0,
    placeholder: 1,
    cursor: 0,
  };

  while (state.cursor < specification.length) {
    state.cursor = skipXparseModifiers(specification, state.cursor);
    const type = specification[state.cursor];
    if (!type) break;
    state.cursor += 1;
    xparseArgument(type, specification, state);
  }

  return {
    syntax: "xparse",
    requiredCount: state.requiredCount,
    optionalCount: state.optionalCount,
    xparseSpecification: specification,
    completionSnippet: state.completionSnippet,
  };
}

function addLatexDefinitions(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  addClassicMacroDefinitions(file, source, masked, starts, definitions);
  addXparseMacroDefinitions(file, source, masked, starts, definitions);
  addTexDefDefinitions(file, masked, starts, definitions);
  addMathOperatorDefinitions(file, masked, starts, definitions);
  addClassicEnvironmentDefinitions(file, source, masked, starts, definitions);
  addXparseEnvironmentDefinitions(file, source, masked, starts, definitions);
  addTheoremDefinitions(file, masked, starts, definitions);
}

function addClassicMacroDefinitions(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  for (const match of masked.matchAll(
    /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?/gu,
  )) {
    const name = latexDefinitionName(
      masked,
      match.index + match[0].length,
      false,
    );
    if (!name) continue;
    const parsed = classicLatexArguments(
      source,
      masked,
      name.next,
    );
    if (!latexGroup(masked, parsed.next)) continue;
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "macro",
      name.name,
      name.from,
      name.to,
      `classic · ${parsed.arguments.requiredCount} required · ${parsed.arguments.optionalCount} optional`,
      undefined,
      parsed.arguments,
    );
  }

}

function addXparseMacroDefinitions(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  for (const match of masked.matchAll(
    /\\(?:New|Renew|Provide|Declare)DocumentCommand\*?/gu,
  )) {
    const name = latexDefinitionName(
      masked,
      match.index + match[0].length,
      true,
    );
    if (!name) continue;
    const specification = latexGroup(masked, name.next);
    if (!specification) continue;
    const value = source
      .slice(specification.contentFrom, specification.contentTo)
      .trim();
    if (
      validateXparseArgumentSpecification(value).length > 0 ||
      !latexGroup(masked, specification.to)
    ) {
      continue;
    }
    const argumentsMetadata = xparseLatexArguments(value);
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "macro",
      name.name,
      name.from,
      name.to,
      `xparse · ${value || "no arguments"}`,
      undefined,
      argumentsMetadata,
    );
  }

}

function addTexDefDefinitions(
  file: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  for (const match of masked.matchAll(
    /\\(?:def|gdef|edef|xdef)\s*(\\(?:[A-Za-z@]+|.))((?:\s*#[1-9])*)/gu,
  )) {
    if (!latexGroup(masked, match.index + match[0].length)) continue;
    const name = match[1].slice(1);
    const argumentCount = Math.max(
      0,
      ...[...(match[2] ?? "").matchAll(/#([1-9])/gu)].map(
        (argument) => Number(argument[1]),
      ),
    );
    let completionSnippet = "";
    for (let index = 1; index <= argumentCount; index += 1) {
      completionSnippet += `{${snippetPlaceholder(index)}}`;
    }
    const nameFrom = match.index + match[0].indexOf(match[1]) + 1;
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "macro",
      name,
      nameFrom,
      nameFrom + name.length,
      `TeX definition · ${argumentCount} required`,
      undefined,
      {
        syntax: "tex-def",
        requiredCount: argumentCount,
        optionalCount: 0,
        completionSnippet,
      },
    );
  }

}

function addMathOperatorDefinitions(
  file: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  for (const match of masked.matchAll(
    /\\DeclareMathOperator\*?\s*\{\s*\\([A-Za-z@]+)\s*\}\s*\{/gu,
  )) {
    const nameFrom =
      match.index + match[0].lastIndexOf(`\\${match[1]}`) + 1;
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "macro",
      match[1],
      nameFrom,
      nameFrom + match[1].length,
      "math operator",
      undefined,
      {
        syntax: "classic",
        requiredCount: 0,
        optionalCount: 0,
        completionSnippet: "",
      },
    );
  }

}

function addClassicEnvironmentDefinitions(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  for (const match of masked.matchAll(
    /\\(?:newenvironment|renewenvironment)\*?/gu,
  )) {
    const nameGroup = latexGroup(
      masked,
      match.index + match[0].length,
    );
    if (!nameGroup) continue;
    const name = source
      .slice(nameGroup.contentFrom, nameGroup.contentTo)
      .trim();
    if (!name || /[{}\\\s]/u.test(name)) continue;
    const parsed = classicLatexArguments(
      source,
      masked,
      nameGroup.to,
    );
    const beginBody = latexGroup(masked, parsed.next);
    if (!beginBody || !latexGroup(masked, beginBody.to)) continue;
    const nameFrom =
      nameGroup.contentFrom +
      source
        .slice(nameGroup.contentFrom, nameGroup.contentTo)
        .indexOf(name);
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "environment",
      name,
      nameFrom,
      nameFrom + name.length,
      `classic · ${parsed.arguments.requiredCount} required · ${parsed.arguments.optionalCount} optional`,
      undefined,
      parsed.arguments,
    );
  }

}

function addXparseEnvironmentDefinitions(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  for (const match of masked.matchAll(
    /\\(?:New|Renew|Provide|Declare)DocumentEnvironment\*?/gu,
  )) {
    const nameGroup = latexGroup(
      masked,
      match.index + match[0].length,
    );
    if (!nameGroup) continue;
    const name = source
      .slice(nameGroup.contentFrom, nameGroup.contentTo)
      .trim();
    const specification = latexGroup(masked, nameGroup.to);
    if (!name || !specification) continue;
    const value = source
      .slice(specification.contentFrom, specification.contentTo)
      .trim();
    const beginBody = latexGroup(masked, specification.to);
    if (
      validateXparseArgumentSpecification(value).length > 0 ||
      !beginBody ||
      !latexGroup(masked, beginBody.to)
    ) {
      continue;
    }
    const nameFrom =
      nameGroup.contentFrom +
      source
        .slice(nameGroup.contentFrom, nameGroup.contentTo)
        .indexOf(name);
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "environment",
      name,
      nameFrom,
      nameFrom + name.length,
      `xparse · ${value || "no arguments"}`,
      undefined,
      xparseLatexArguments(value),
    );
  }

}

function addTheoremDefinitions(
  file: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  for (const match of masked.matchAll(
    /\\newtheorem\*?\s*\{\s*([^{}\s]+)\s*\}\s*\{/gu,
  )) {
    const nameFrom =
      match.index + match[0].indexOf(match[1]);
    addDefinition(
      definitions,
      "latex",
      file,
      starts,
      "environment",
      match[1],
      nameFrom,
      nameFrom + match[1].length,
      "theorem environment",
      undefined,
      {
        syntax: "classic",
        requiredCount: 0,
        optionalCount: 0,
        completionSnippet: "",
      },
    );
  }
}

function latexPackageReferences(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  closingByOpening: CommandGroupIndex,
): PackageReference[] {
  const refs: PackageReference[] = [];
  const packageCommands =
    /\\(usepackage|RequirePackage|RequirePackageWithOptions|documentclass|LoadClass|LoadClassWithOptions)\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(packageCommands)) {
    const kind = match[1].toLowerCase().includes("class")
      ? "class"
      : "package";
    const group = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    ).find((candidate) => candidate.open === "{");
    if (!group) continue;
    for (const token of latexLogicalGroupTokens(source, group, true)) {
      refs.push({
        name: token.name,
        kind,
        location: location(file, starts, token.from, token.to),
      });
    }
  }
  return refs;
}

function latexAdditionalSyntax(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  addDefinition(
    definitions,
    "latex",
    file,
    starts,
    "file",
    file,
    0,
    0,
    "Project source file",
  );

  addLatexDefinitions(
    file,
    source,
    masked,
    starts,
    definitions,
  );

  const closingByOpening = buildCommandGroupIndex(masked);
  addLatexKeyedDefinitions(
    file,
    source,
    masked,
    starts,
    definitions,
    closingByOpening,
  );
  addLatexKeyUses(file, source, masked, starts, uses, closingByOpening);
  addLatexGlossaryUses(file, source, masked, starts, uses, closingByOpening);
  addLatexInputEdges(file, masked, starts, uses, edges);
  addLatexImportEdges(file, masked, starts, uses, edges);
  addLatexAssetEdges(file, masked, starts, uses, edges);
  addLatexLinkEdges(file, masked, starts, uses, edges);
  addLatexBibliographyEdges(file, masked, starts, uses, edges);
  addLatexCommandCandidates(file, masked, starts, uses);
}

function addLatexKeyedDefinitions(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
  closingByOpening: CommandGroupIndex,
): void {
  const keyedDefinitions = /\\(label|hypertarget)\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(keyedDefinitions)) {
    const group = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    ).find((candidate) => candidate.open === "{");
    if (!group) continue;
    for (const token of latexLogicalGroupTokens(source, group, false)) {
      addDefinition(
        definitions,
        "latex",
        file,
        starts,
        match[1] === "label" ? "label" : "anchor",
        token.name,
        token.from,
        token.to,
      );
    }
  }

}

function addLatexKeyUses(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
  closingByOpening: CommandGroupIndex,
): void {
  for (const token of latexCommandKeyTokensFromMasked(
    source,
    masked,
    closingByOpening,
  )) {
    addUse(
      uses,
      "latex",
      file,
      starts,
      token.kind,
      token.name,
      token.from,
      token.to,
      undefined,
      "explicit",
    );
  }

}

function addLatexGlossaryUses(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
  closingByOpening: CommandGroupIndex,
): void {
  const glossaryUses =
    /\\(glssymbol|glsdesc|glslink|glspl|Glspl|GLSpl|gls|Gls|GLS|acrshort|acrlong|acrfull|acs|acl|acf|Acs|Acl|Acf|ac|Ac)\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(glossaryUses)) {
    const group = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    ).find((candidate) => candidate.open === "{");
    if (!group) continue;
    for (const token of latexLogicalGroupTokens(source, group, false)) {
      addUse(
        uses,
        "latex",
        file,
        starts,
        "glossary",
        token.name,
        token.from,
        token.to,
        undefined,
        "explicit",
      );
    }
  }

}

function addLatexInputEdges(
  file: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const inputCommands =
    /\\(input|include|subfile|InputIfFileExists)\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(inputCommands)) {
    if (match[1] === "input" || match[1] === "include") continue;
    const raw = match[2].trim();
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "include",
      raw,
      nameOffset,
      nameOffset + match[2].length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

}

function addLatexImportEdges(
  file: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const imports =
    /\\(import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)\*?\s*\{([^}]*)\}\s*\{([^}]*)\}/gi;
  for (const match of masked.matchAll(imports)) {
    const raw = `${match[2].trim().replace(/(?<!\/)\/+$/, "")}/${match[3].trim()}`;
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "import",
      raw,
      nameOffset,
      nameOffset + match[3].length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

}

function addLatexAssetEdges(
  file: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const assets =
    /\\(?:includegraphics|includesvg|includepdf|lstinputlisting|verbatiminput)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(assets)) {
    const raw = match[1].trim();
    const nameOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "asset",
      raw,
      nameOffset,
      nameOffset + match[1].length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

  const mintedAssets =
    /\\inputminted\*?(?:\s*\[[^\]]*\])?\s*\{[^}]*\}\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(mintedAssets)) {
    const raw = match[1].trim();
    const nameOffset = match.index + match[0].lastIndexOf("{") + 1;
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "asset",
      raw,
      nameOffset,
      nameOffset + match[1].length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

}

function addLatexLinkEdges(
  file: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const links = /\\(?:href|url)\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(links)) {
    const raw = match[1].trim();
    if (!raw) continue;
    const nameOffset = match.index + match[0].lastIndexOf("{") + 1;
    const hash = raw.indexOf("#");
    const rawPath = hash >= 0 ? raw.slice(0, hash) : raw;
    const anchorName = hash >= 0 ? raw.slice(hash + 1) : "";
    if (anchorName) {
      addUse(
        uses,
        "latex",
        file,
        starts,
        "reference",
        anchorName,
        nameOffset + hash + 1,
        nameOffset + raw.length,
        rawPath
          ? `${resolveProjectPath(file, rawPath) ?? rawPath}#${anchorName}`
          : undefined,
        "explicit",
      );
    }
    if (!rawPath) continue;
    const target = resolveProjectPath(file, rawPath);
    const use = addUse(
      uses,
      "latex",
      file,
      starts,
      "link",
      raw,
      nameOffset,
      nameOffset + raw.length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

}

function addLatexBibliographyEdges(
  file: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const bibliographies =
    /\\(bibliography|addbibresource)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(bibliographies)) {
    const bibliographyEngine: BibliographyEngine =
      match[1] === "addbibresource" ? "biblatex" : "latex";
    const valueOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    for (const keyMatch of match[2].matchAll(/[^,]+/g)) {
      const rawSegment = keyMatch[0];
      const raw = rawSegment.trim();
      if (!raw) continue;
      const leading = rawSegment.length - rawSegment.trimStart().length;
      const nameOffset = valueOffset + keyMatch.index + leading;
      const target =
        bibliographyCandidatePaths(raw, file, bibliographyEngine)[0] ?? null;
      const use = addUse(
        uses,
        "latex",
        file,
        starts,
        "bibliography",
        raw,
        nameOffset,
        nameOffset + raw.length,
        target ?? undefined,
      );
      edges.push(
        edgeForUse(
          use,
          target,
          bibliographyEngine === "biblatex" ? bibliographyEngine : undefined,
        ),
      );
    }
  }

}

// Keep command candidates in the per-file cache. Project assembly retains
// only names actually defined by this project, avoiding false "unknown
// command" findings for the LaTeX/package command universe.
function addLatexCommandCandidates(
  file: string,
  masked: string,
  starts: readonly number[],
  uses: ProjectUse[],
): void {
  const commandUse = /\\([A-Za-z@]+)/g;
  for (const match of masked.matchAll(commandUse)) {
    const nameOffset = match.index + 1;
    addUse(
      uses,
      "latex",
      file,
      starts,
      "macro",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
      undefined,
      "candidate",
    );
  }
}

function markdownTextWithoutHtmlTags(title: string): string {
  let result = "";
  let insideTag = false;
  for (const character of title) {
    if (character === "<") {
      insideTag = true;
    } else if (character === ">" && insideTag) {
      insideTag = false;
    } else if (!insideTag) {
      result += character;
    }
  }
  return result;
}

function markdownSlug(title: string): string {
  return markdownTextWithoutHtmlTags(title)
    .replace(/[`*_~[\]()]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function isExternalMarkdownTarget(target: string): boolean {
  return (
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target) ||
    target.startsWith("\\\\")
  );
}

function offsetIsWithin(
  offset: number,
  ranges: readonly { readonly from: number; readonly to: number }[],
): boolean {
  return ranges.some(
    (range) => offset >= range.from && offset < range.to,
  );
}

interface MarkdownContext {
  readonly file: string;
  readonly starts: readonly number[];
  readonly definitions: ProjectDefinition[];
  readonly uses: ProjectUse[];
  readonly edges: ProjectEdge[];
}

interface MarkdownMaskState {
  readonly chars: string[];
  offset: number;
  fence: { char: "`" | "~"; length: number; offset: number } | null;
  yaml: boolean;
  yamlBibliographyList: boolean;
}

const MARKDOWN_LINK =
  /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;

function addMarkdownBibliography(
  context: MarkdownContext,
  raw: string,
  nameOffset: number,
): void {
  const { file, starts, uses, edges } = context;
  const target =
    bibliographyCandidatePaths(raw, file, "markdown")[0] ?? null;
  const use = addUse(
    uses,
    "markdown",
    file,
    starts,
    "bibliography",
    raw,
    nameOffset,
    nameOffset + raw.length,
    target ?? undefined,
  );
  edges.push(edgeForUse(use, target));
}

function addYamlBibliographyDeclaration(
  context: MarkdownContext,
  line: string,
  offset: number,
  declaration: RegExpExecArray,
): void {
  const rawValue = declaration[1].trim();
  const singleValue = rawValue ? [rawValue] : [];
  const values =
    rawValue.startsWith("[") && rawValue.endsWith("]")
      ? rawValue.slice(1, -1).split(",")
      : singleValue;
  for (const value of values) {
    const raw = value.trim().replace(/^["']|["']$/g, "");
    if (!raw) continue;
    const nameOffset =
      offset + line.indexOf(value) + value.indexOf(raw);
    addMarkdownBibliography(context, raw, nameOffset);
  }
}

function markdownYamlLine(
  context: MarkdownContext,
  state: MarkdownMaskState,
  line: string,
  lineIndex: number,
): boolean {
  if (lineIndex > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) {
    state.yaml = false;
    state.yamlBibliographyList = false;
    return false;
  }
  const declaration = /^bibliography\s*:\s*(.*)\s*$/i.exec(line);
  if (declaration) {
    state.yamlBibliographyList = declaration[1].trim().length === 0;
    addYamlBibliographyDeclaration(context, line, state.offset, declaration);
    return true;
  }
  if (!state.yamlBibliographyList) return true;
  const item = /^\s*-\s*(.+?)\s*$/.exec(line);
  if (item) {
    const raw = item[1].trim().replace(/^["']|["']$/g, "");
    const nameOffset =
      state.offset + line.lastIndexOf(item[1]) + item[1].indexOf(raw);
    addMarkdownBibliography(context, raw, nameOffset);
    return true;
  }
  if (/^\S/.test(line)) state.yamlBibliographyList = false;
  return true;
}

function maskLineRange(
  chars: string[],
  offset: number,
  length: number,
): void {
  for (let index = offset; index < offset + length; index++) {
    chars[index] = " ";
  }
}

function maskMarkdownLine(
  context: MarkdownContext,
  state: MarkdownMaskState,
  line: string,
  lineIndex: number,
): void {
  if (state.yaml) {
    if (markdownYamlLine(context, state, line, lineIndex)) {
      maskLineRange(state.chars, state.offset, line.length);
    }
    return;
  }

  const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
  if (marker) {
    const char = marker[0] as "`" | "~";
    if (!state.fence) {
      state.fence = { char, length: marker.length, offset: state.offset };
    } else if (
      char === state.fence.char &&
      marker.length >= state.fence.length
    ) {
      state.fence = null;
    }
    maskLineRange(state.chars, state.offset, line.length);
    return;
  }
  if (state.fence) {
    maskLineRange(state.chars, state.offset, line.length);
    return;
  }
  for (const inline of line.matchAll(/(`+)([\s\S]*?)\1/g)) {
    maskLineRange(
      state.chars,
      state.offset + inline.index,
      inline[0].length,
    );
  }
}

function maskMarkdownSource(
  context: MarkdownContext,
  source: string,
  lines: readonly string[],
): MarkdownMaskState {
  const state: MarkdownMaskState = {
    chars: source.split(""),
    offset: 0,
    fence: null,
    yaml: source.startsWith("---\n"),
    yamlBibliographyList: false,
  };
  for (const [lineIndex, line] of lines.entries()) {
    maskMarkdownLine(context, state, line, lineIndex);
    state.offset += line.length + 1;
  }
  return state;
}

function markdownMaskDiagnostics(
  context: MarkdownContext,
  source: string,
  state: MarkdownMaskState,
  diagnostics: ProjectDiagnostic[],
): boolean {
  const { file, starts } = context;
  let partial = false;
  if (state.fence) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, state.fence.offset, "markdown-fence"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: { key: "unclosedFence" },
      location: location(
        file,
        starts,
        state.fence.offset,
        Math.min(source.length, state.fence.offset + state.fence.length),
      ),
      related: [],
    });
  }
  if (state.yaml) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, 0, "markdown-frontmatter"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: { key: "unclosedFrontMatter" },
      location: location(file, starts, 0, Math.min(source.length, 3)),
      related: [],
    });
  }
  return partial;
}

function markdownUrlRanges(
  visible: string,
): Array<{ from: number; to: number }> {
  const urlRanges: Array<{ from: number; to: number }> = [];
  for (const match of visible.matchAll(MARKDOWN_LINK)) {
    const target = match[3];
    const from = match.index + match[0].indexOf(target);
    urlRanges.push({ from, to: from + target.length });
  }
  for (const match of visible.matchAll(
    /\b(?:https?|ftp|mailto):[^\s<>()\]]+/giu,
  )) {
    urlRanges.push({
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return urlRanges;
}

function addMarkdownCitations(
  context: MarkdownContext,
  visible: string,
  urlRanges: readonly { from: number; to: number }[],
): void {
  const { file, starts, uses } = context;
  const pandocCitation =
    /(?:^|[^\p{Letter}\p{Number}_\\])(-?@)([\p{Letter}\p{Number}_:.#$%&+?~/-]+)/gu;
  for (const match of visible.matchAll(pandocCitation)) {
    const key = match[2].replace(/(?<![.,;!?])[.,;!?]+$/u, "");
    if (!key) continue;
    const keyOffset =
      match.index + match[0].lastIndexOf(match[1]) + match[1].length;
    const atOffset = keyOffset - 1;
    if (
      offsetIsWithin(atOffset, urlRanges) ||
      visible[atOffset - 1] === "/" ||
      visible[atOffset - 1] === "\\"
    ) {
      continue;
    }
    addUse(
      uses,
      "markdown",
      file,
      starts,
      "citation",
      key,
      keyOffset,
      keyOffset + key.length,
      undefined,
      "explicit",
    );
  }
}

function addMarkdownExplicitAnchors(
  context: MarkdownContext,
  visible: string,
  urlRanges: readonly { from: number; to: number }[],
): void {
  const { file, starts, definitions } = context;
  const explicitAnchor = /\{#([A-Za-z][A-Za-z0-9_.:-]*)\}/g;
  for (const match of visible.matchAll(explicitAnchor)) {
    if (offsetIsWithin(match.index, urlRanges)) continue;
    const nameOffset = match.index + 2;
    addDefinition(
      definitions,
      "markdown",
      file,
      starts,
      "anchor",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
    );
  }
}

function addMarkdownHeadingAnchors(
  context: MarkdownContext,
  lines: readonly string[],
): void {
  const { file, starts, definitions } = context;
  for (const heading of definitions.filter(
    (definition) => definition.kind === "section",
  )) {
    const lineText =
      lines[heading.location.range.startLine - 1] ?? heading.name;
    const explicit = /\{#([A-Za-z][A-Za-z0-9_.:-]*)\}\s*(?:#+\s*)?$/.exec(
      lineText,
    )?.[1];
    const name = explicit ?? markdownSlug(heading.name);
    if (!name) continue;
    const existing = definitions.some(
      (definition) =>
        definition.kind === "anchor" &&
        definition.name === name &&
        definition.location.range.startLine ===
          heading.location.range.startLine,
    );
    if (existing) continue;
    addDefinition(
      definitions,
      "markdown",
      file,
      starts,
      "anchor",
      name,
      heading.location.range.from,
      heading.location.range.to,
      explicit ? "Explicit Pandoc identifier" : "Pandoc auto identifier",
    );
  }
}

interface MarkdownLinkTarget {
  readonly target: string;
  readonly targetOffset: number;
  readonly hash: number;
  readonly targetPath: string;
  readonly anchor: string;
  readonly image: boolean;
}

function addMarkdownLinkTarget(
  context: MarkdownContext,
  link: MarkdownLinkTarget,
): void {
  const { file, starts, uses, edges } = context;
  const resolved = resolveProjectPath(file, link.targetPath);
  const kind: ProjectUseKind = link.image ? "asset" : "link";
  const use = addUse(
    uses,
    "markdown",
    file,
    starts,
    kind,
    link.target,
    link.targetOffset,
    link.targetOffset + link.target.length,
    resolved ?? undefined,
  );
  edges.push(edgeForUse(use, resolved));
  if (link.anchor) {
    addUse(
      uses,
      "markdown",
      file,
      starts,
      "reference",
      link.anchor,
      link.targetOffset + link.hash + 1,
      link.targetOffset + link.target.length,
      resolved ? `${resolved}#${link.anchor}` : undefined,
    );
  }
}

function addMarkdownLinks(
  context: MarkdownContext,
  visible: string,
): void {
  const { file, starts, uses } = context;
  for (const match of visible.matchAll(MARKDOWN_LINK)) {
    const target = match[3];
    const targetOffset = match.index + match[0].indexOf(target);
    const hash = target.indexOf("#");
    const targetPath = hash >= 0 ? target.slice(0, hash) : target;
    const anchor = hash >= 0 ? target.slice(hash + 1) : "";
    if (!targetPath && anchor) {
      addUse(
        uses,
        "markdown",
        file,
        starts,
        "reference",
        anchor,
        targetOffset + 1,
        targetOffset + target.length,
      );
      continue;
    }
    if (isExternalMarkdownTarget(targetPath)) continue;
    addMarkdownLinkTarget(context, {
      target,
      targetOffset,
      hash,
      targetPath,
      anchor,
      image: match[1] === "!",
    });
  }
}

function addMarkdownReferenceDefinitions(
  context: MarkdownContext,
  visible: string,
): void {
  const { file, starts, definitions, uses, edges } = context;
  const referenceDefinition =
    /^\s{0,3}\[([^\]\n]+)\]:\s*<?([^>\s]+)>?/gm;
  for (const match of visible.matchAll(referenceDefinition)) {
    const nameOffset = match.index + match[0].indexOf(match[1]);
    addDefinition(
      definitions,
      "markdown",
      file,
      starts,
      "anchor",
      match[1].toLocaleLowerCase("en-US"),
      nameOffset,
      nameOffset + match[1].length,
      "Markdown link definition",
    );
    const targetOffset = match.index + match[0].indexOf(match[2]);
    if (isExternalMarkdownTarget(match[2])) continue;
    const resolved = resolveProjectPath(file, match[2]);
    const use = addUse(
      uses,
      "markdown",
      file,
      starts,
      "link",
      match[2],
      targetOffset,
      targetOffset + match[2].length,
      resolved ?? undefined,
    );
    edges.push(edgeForUse(use, resolved));
  }
}

function addMarkdownReferenceUses(
  context: MarkdownContext,
  visible: string,
): void {
  const { file, starts, uses } = context;
  const referenceUse = /(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
  for (const match of visible.matchAll(referenceUse)) {
    const name = (match[2] || match[1]).toLocaleLowerCase("en-US");
    const sourceName = match[2] || match[1];
    const nameOffset = match.index + match[0].lastIndexOf(sourceName);
    addUse(
      uses,
      "markdown",
      file,
      starts,
      "reference",
      name,
      nameOffset,
      nameOffset + sourceName.length,
    );
  }
}

function addMarkdownShortcutReferences(
  context: MarkdownContext,
  visible: string,
): void {
  const { file, starts, definitions, uses } = context;
  const shortcutReference = /(?<!!)\[([^\]\n]+)\](?![[(])/g;
  const shortcutDefinitions = new Set(
    definitions
      .filter(
        (definition) =>
          definition.engine === "markdown" &&
          definition.kind === "anchor" &&
          definition.detail === "Markdown link definition",
      )
      .map((definition) =>
        definition.name.toLocaleLowerCase("en-US"),
      ),
  );
  for (const match of visible.matchAll(shortcutReference)) {
    const following = visible[match.index + match[0].length];
    const sourceName = match[1].trim();
    if (
      following === ":" ||
      !sourceName ||
      sourceName.startsWith("@") ||
      sourceName.includes("; @") ||
      !shortcutDefinitions.has(
        sourceName.toLocaleLowerCase("en-US"),
      )
    ) {
      continue;
    }
    const nameOffset =
      match.index + match[0].indexOf(match[1]) +
      match[1].indexOf(sourceName);
    addUse(
      uses,
      "markdown",
      file,
      starts,
      "reference",
      sourceName.toLocaleLowerCase("en-US"),
      nameOffset,
      nameOffset + sourceName.length,
      undefined,
      "explicit",
    );
  }
}

function addMarkdownIncludes(
  context: MarkdownContext,
  visible: string,
): void {
  const { file, starts, uses, edges } = context;
  const include =
    /^(?:\s*!include\s+|\s*\{\{<?\s*include\s+|\s*\{%\s*include\s+)(["']?)([^"'\s}%>]+)\1/gm;
  for (const match of visible.matchAll(include)) {
    const raw = match[2];
    const nameOffset = match.index + match[0].lastIndexOf(raw);
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "markdown",
      file,
      starts,
      "include",
      raw,
      nameOffset,
      nameOffset + raw.length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }
}

function markdownAdditionalSyntax(
  file: string,
  source: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
  diagnostics: ProjectDiagnostic[],
): boolean {
  addDefinition(
    definitions,
    "markdown",
    file,
    starts,
    "file",
    file,
    0,
    0,
    "Project source file",
  );
  const context: MarkdownContext = {
    file,
    starts,
    definitions,
    uses,
    edges,
  };
  const lines = source.split("\n");
  const state = maskMarkdownSource(context, source, lines);
  const partial = markdownMaskDiagnostics(
    context,
    source,
    state,
    diagnostics,
  );

  const visible = state.chars.join("");
  const urlRanges = markdownUrlRanges(visible);
  addMarkdownCitations(context, visible, urlRanges);
  addMarkdownExplicitAnchors(context, visible, urlRanges);
  addMarkdownHeadingAnchors(context, lines);
  addMarkdownLinks(context, visible);
  addMarkdownReferenceDefinitions(context, visible);
  addMarkdownReferenceUses(context, visible);
  addMarkdownShortcutReferences(context, visible);
  addMarkdownIncludes(context, visible);
  return partial;
}

function typstAdditionalSyntax(
  file: string,
  masked: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  addDefinition(
    definitions,
    "typst",
    file,
    starts,
    "file",
    file,
    0,
    0,
    "Project source file",
  );
  const codeMask = maskQuotedContents(masked);
  addTypstLetDefinitions(file, codeMask, starts, definitions);
  addTypstBibliographyEdges(file, masked, codeMask, starts, uses, edges);
  addTypstAssetEdges(file, masked, codeMask, starts, uses, edges);
  addTypstExplicitReferences(file, codeMask, starts, uses);
  addTypstCitations(file, masked, codeMask, starts, uses);
  addTypstLinkEdges(file, masked, codeMask, starts, uses, edges);
}

function addTypstLetDefinitions(
  file: string,
  codeMask: string,
  starts: readonly number[],
  definitions: ProjectDefinition[],
): void {
  const letDefinition = /#let\s+([A-Za-z_][A-Za-z0-9_-]*)/g;
  for (const match of codeMask.matchAll(letDefinition)) {
    const nameOffset = match.index + match[0].lastIndexOf(match[1]);
    addDefinition(
      definitions,
      "typst",
      file,
      starts,
      "macro",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
      "Typst binding",
    );
  }

}

function addTypstBibliographyEdges(
  file: string,
  masked: string,
  codeMask: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const bibliography = /#bibliography\s*\(([^)]*)\)/g;
  for (const match of masked.matchAll(bibliography)) {
    if (!codeMask.startsWith("#bibliography", match.index)) continue;
    const argumentsOffset = match.index + match[0].indexOf(match[1]);
    for (const pathMatch of match[1].matchAll(/"([^"]+)"/g)) {
      const raw = pathMatch[1];
      const nameOffset =
        argumentsOffset + pathMatch.index + pathMatch[0].indexOf(raw);
      const target = bibliographyCandidatePaths(raw, file, "typst")[0] ?? null;
      const use = addUse(
        uses,
        "typst",
        file,
        starts,
        "bibliography",
        raw,
        nameOffset,
        nameOffset + raw.length,
        target ?? undefined,
      );
      edges.push(edgeForUse(use, target));
    }
  }

}

function addTypstAssetEdges(
  file: string,
  masked: string,
  codeMask: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const assets =
    /#(?:image|read|csv|json|yaml|xml)\s*\(\s*"([^"]+)"/g;
  for (const match of masked.matchAll(assets)) {
    if (!codeMask.startsWith("#", match.index)) continue;
    const raw = match[1];
    const nameOffset = match.index + match[0].lastIndexOf(raw);
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "typst",
      file,
      starts,
      "asset",
      raw,
      nameOffset,
      nameOffset + raw.length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }

}

function addTypstExplicitReferences(
  file: string,
  codeMask: string,
  starts: readonly number[],
  uses: ProjectUse[],
): void {
  const explicitReference =
    /#(?:ref|link)\s*\(\s*<([A-Za-z_][A-Za-z0-9_:-]*)>/g;
  for (const match of codeMask.matchAll(explicitReference)) {
    const nameOffset = match.index + match[0].lastIndexOf(match[1]);
    addUse(
      uses,
      "typst",
      file,
      starts,
      "reference",
      match[1],
      nameOffset,
      nameOffset + match[1].length,
    );
  }

}

function typstCitationArgumentEnd(
  codeMask: string,
  from: number,
): { contentTo: number } {
  let cursor = from;
  let depth = 1;
  while (cursor < codeMask.length && depth > 0) {
    // String contents (including escaped quotes) are blanked in codeMask,
    // while structural parentheses and offsets are preserved.
    if (codeMask[cursor] === "(") depth++;
    else if (codeMask[cursor] === ")") depth--;
    cursor++;
  }
  return { contentTo: depth === 0 ? cursor - 1 : cursor };
}

function typstCitationKeys(
  argumentsSource: string,
  contentFrom: number,
): Array<{ name: string; from: number }> {
  const keys: Array<{ name: string; from: number }> = [];
  for (const keyMatch of argumentsSource.matchAll(
    /<([A-Za-z_][A-Za-z0-9_:.#$%&+?~/-]*)>|(?:^|[[(,]\s*|label\s*\(\s*)"([A-Za-z_][A-Za-z0-9_:.#$%&+?~/-]*)"/g,
  )) {
    const name = keyMatch[1] ?? keyMatch[2];
    if (!name) continue;
    keys.push({
      name,
      from: contentFrom + keyMatch.index + keyMatch[0].indexOf(name),
    });
  }
  return keys;
}

function addTypstCitations(
  file: string,
  masked: string,
  codeMask: string,
  starts: readonly number[],
  uses: ProjectUse[],
): void {
  const explicitCitation = /#cite\s*\(/g;
  for (const match of codeMask.matchAll(explicitCitation)) {
    // commandGroups intentionally handles []/{} command arguments. Typst uses
    // parentheses, so balance that argument explicitly while preserving exact
    // offsets for every label or string key inside arrays/tuples.
    const contentFrom = match.index + match[0].length;
    const { contentTo } = typstCitationArgumentEnd(codeMask, contentFrom);
    const argumentsSource = masked.slice(contentFrom, contentTo);
    for (const key of typstCitationKeys(argumentsSource, contentFrom)) {
      addUse(
        uses,
        "typst",
        file,
        starts,
        "citation",
        key.name,
        key.from,
        key.from + key.name.length,
        undefined,
        "explicit",
      );
    }
  }
}

function addTypstLinkEdges(
  file: string,
  masked: string,
  codeMask: string,
  starts: readonly number[],
  uses: ProjectUse[],
  edges: ProjectEdge[],
): void {
  const links = /#link\s*\(\s*"([^"]+)"/g;
  for (const match of masked.matchAll(links)) {
    if (!codeMask.startsWith("#link", match.index)) continue;
    const raw = match[1];
    const nameOffset = match.index + match[0].lastIndexOf(raw);
    const target = resolveProjectPath(file, raw);
    const use = addUse(
      uses,
      "typst",
      file,
      starts,
      "link",
      raw,
      nameOffset,
      nameOffset + raw.length,
      target ?? undefined,
    );
    edges.push(edgeForUse(use, target));
  }
}

interface LegacyContext {
  readonly engine: ProjectIntelligenceEngine;
  readonly file: string;
  readonly source: string;
  readonly starts: readonly number[];
  readonly definitions: ProjectDefinition[];
  readonly uses: ProjectUse[];
  readonly edges: ProjectEdge[];
  readonly fullRanges: Map<string, SourceRange>;
}

const EDGE_USE_KINDS = new Set<ProjectUseKind>([
  "include",
  "import",
  "link",
  "asset",
  "bibliography",
]);

function legacyDefinitionSkipped(
  engine: ProjectIntelligenceEngine,
  symbol: Sym,
  source: string,
): boolean {
  // Re-extracted below with TeX comment-splicing and source mapping.
  if (engine === "latex" && symbol.kind === "label") return true;
  return (
    engine === "typst" &&
    symbol.kind === "label" &&
    /#(?:ref|link|cite)\s*\([^)]*$/.test(
      source.slice(Math.max(0, symbol.from - 80), symbol.from),
    )
  );
}

function addLegacyDefinitions(
  context: LegacyContext,
  symbols: readonly Sym[],
): void {
  const { engine, file, source, starts, definitions, fullRanges } = context;
  for (const symbol of symbols) {
    if (legacyDefinitionSkipped(engine, symbol, source)) continue;
    const kind = definitionKind(symbol);
    if (!kind) continue;
    if (
      engine === "latex" &&
      (kind === "macro" || kind === "environment")
    ) {
      // Re-extracted below with complete argument metadata and ignored-region
      // masking so project completion never revives commented/code examples.
      continue;
    }
    const definition = addDefinition(
      definitions,
      engine,
      file,
      starts,
      kind,
      symbol.name,
      symbol.nameFrom,
      symbol.nameTo,
      undefined,
      symbol.level,
    );
    fullRanges.set(
      definition.id,
      rangeFromOffsets(starts, symbol.from, symbol.to),
    );
  }
}

function legacyUseSkipped(
  engine: ProjectIntelligenceEngine,
  kind: ProjectUseKind,
): boolean {
  // The engine-aware extractors below understand multiline/comment-spliced
  // TeX groups and Markdown URL/code masking. Retaining the legacy regex
  // copy would reintroduce false or incorrectly ranged duplicate uses.
  if (engine === "latex") {
    return kind === "reference" || kind === "citation";
  }
  return engine === "markdown" && kind === "citation";
}

function legacyUseTarget(
  engine: ProjectIntelligenceEngine,
  file: string,
  symbol: Sym,
): string | undefined {
  if (symbol.kind === "inputedge" && engine === "latex") {
    return resolveProjectPath(file, symbol.name) ?? undefined;
  }
  return symbol.target;
}

function addLegacyUses(
  context: LegacyContext,
  symbols: readonly Sym[],
): void {
  const { engine, file, source, starts, uses, edges } = context;
  for (const symbol of symbols) {
    const kind = projectUseKind(symbol, source);
    if (!kind) continue;
    if (legacyUseSkipped(engine, kind)) continue;
    const target = legacyUseTarget(engine, file, symbol);
    const use = addUse(
      uses,
      engine,
      file,
      starts,
      kind,
      symbol.name,
      symbol.nameFrom,
      symbol.nameTo,
      target,
      symbol.kind === "atuse" && engine === "typst"
        ? "typst-at"
        : "explicit",
    );
    if (EDGE_USE_KINDS.has(kind)) {
      edges.push(edgeForUse(use, target ?? null));
    }
  }
}

function analyzeLatexBody(
  context: LegacyContext,
  diagnostics: ProjectDiagnostic[],
): { partial: boolean; packageRefs: PackageReference[] } {
  const { engine, file, source, starts, definitions, uses, edges } = context;
  const masked = maskLatexIgnoredRegions(source);
  latexAdditionalSyntax(
    file,
    source,
    masked,
    starts,
    definitions,
    uses,
    edges,
  );
  const packageRefs = latexPackageReferences(
    file,
    source,
    masked,
    starts,
    buildCommandGroupIndex(masked),
  );
  const ast = astAugmentLatexFile(file, source, starts);
  if (ast) definitions.push(...ast.definitions);
  const delimiterPartial = addDelimiterDiagnostics(
    file,
    source,
    masked,
    starts,
    engine,
    diagnostics,
  );
  const environmentPartial = latexEnvironmentDiagnostics(
    file,
    masked,
    starts,
    diagnostics,
  );
  return {
    partial: delimiterPartial || environmentPartial,
    packageRefs,
  };
}

function analyzeTypstBody(
  context: LegacyContext,
  diagnostics: ProjectDiagnostic[],
): boolean {
  const { engine, file, source, starts, definitions, uses, edges } = context;
  const masked = maskTypstComments(source);
  typstAdditionalSyntax(
    file,
    masked,
    starts,
    definitions,
    uses,
    edges,
  );
  const delimiterPartial = addDelimiterDiagnostics(
    file,
    source,
    masked,
    starts,
    engine,
    diagnostics,
  );
  const commentPartial = typstCommentDiagnostics(
    file,
    source,
    starts,
    diagnostics,
  );
  return delimiterPartial || commentPartial;
}

function bibitemEntries(
  definitions: readonly ProjectDefinition[],
  fullRanges: ReadonlyMap<string, SourceRange>,
) {
  return definitions
    .filter((definition) => definition.kind === "bibentry")
    .map((definition) => ({
      id: stableId(
        "bib",
        definition.location.file,
        definition.location.range.from,
        definition.name,
      ),
      key: definition.name,
      type: "bibitem",
      file: definition.location.file,
      range:
        fullRanges.get(definition.id) ?? definition.location.range,
      keyRange: definition.location.range,
      typeRange: definition.location.range,
      fields: [],
      complete: true,
      duplicate: false,
      duplicateIndex: 0,
      duplicateCount: 1,
      ...bibliographyEntrySummary(
        "bibitem",
        definition.location.file,
        [],
      ),
    }));
}

export function analyzeProjectFile(
  file: string,
  source: string,
  sourceRevision: number,
): FileAnalysis {
  const engine = engineForPath(file);
  if (!engine) {
    throw new Error(`Unsupported project-intelligence file: ${file}`);
  }
  if (engine === "bibtex") {
    return parseBibtexIntelligence(file, source, sourceRevision);
  }

  const starts = lineStarts(source);
  const legacy = parseFile(file, source);
  const diagnostics: ProjectDiagnostic[] = [];
  const context: LegacyContext = {
    engine,
    file,
    source,
    starts,
    definitions: [],
    uses: [],
    edges: [],
    fullRanges: new Map<string, SourceRange>(),
  };

  addLegacyDefinitions(context, legacy.defs);
  addLegacyUses(context, legacy.uses);

  let partial = false;
  let packageRefs: PackageReference[] = [];
  if (engine === "latex") {
    const latex = analyzeLatexBody(context, diagnostics);
    partial = latex.partial;
    packageRefs = latex.packageRefs;
  } else if (engine === "markdown") {
    partial = markdownAdditionalSyntax(
      file,
      source,
      starts,
      context.definitions,
      context.uses,
      context.edges,
      diagnostics,
    );
  } else {
    partial = analyzeTypstBody(context, diagnostics);
  }

  const uniqueDefinitions = uniqueById(context.definitions);
  const uniqueUses = uniqueById(context.uses);
  const uniqueEdges = uniqueById(context.edges);
  const bibliographyEntries =
    engine === "latex"
      ? bibitemEntries(uniqueDefinitions, context.fullRanges)
      : [];
  return {
    file,
    engine,
    sourceRevision,
    contentHash: sourceHash(source),
    status: partial ? "partial" : "success",
    ...(partial
      ? {
          statusReason:
            "Recovery retained structure around malformed source.",
        }
      : {}),
    outline: outlineForDefinitions(
      file,
      uniqueDefinitions,
      context.fullRanges,
    ),
    definitions: uniqueDefinitions,
    uses: uniqueUses,
    edges: uniqueEdges,
    diagnostics,
    bibliographyEntries,
    ...(packageRefs.length ? { packageRefs } : {}),
  };
}
