import { parseFile } from "@/lib/index/parse-file";
import type { Sym } from "@/lib/index/types";
import {
  latexBalancedGroupEnd,
  maskLatexIgnoredRegions,
  validateXparseArgumentSpecification,
} from "@oleafly/editor/latex-analysis";
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
  FileIntelligence,
  OutlineNode,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectDiagnostic,
  ProjectEdge,
  ProjectIntelligenceEngine,
  ProjectUse,
  ProjectUseKind,
  LatexDefinitionArguments,
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

function latexLogicalGroupTokens(
  source: string,
  group: DelimitedGroup,
  split = true,
): readonly LogicalGroupToken[] {
  if (!group.complete) return [];
  const result: LogicalGroupToken[] = [];
  let logical: Array<{ readonly value: string; readonly offset: number }> = [];
  const flush = () => {
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
    logical = [];
  };

  let cursor = group.contentFrom;
  while (cursor < group.contentTo) {
    const character = source[cursor];
    if (character === "%") {
      let slashes = 0;
      for (
        let preceding = cursor - 1;
        preceding >= group.contentFrom &&
        source[preceding] === "\\";
        preceding--
      ) {
        slashes++;
      }
      if (slashes % 2 === 0) {
        cursor++;
        while (
          cursor < group.contentTo &&
          source[cursor] !== "\n" &&
          source[cursor] !== "\r"
        ) {
          cursor++;
        }
        if (
          cursor < group.contentTo &&
          source[cursor] === "\r" &&
          source[cursor + 1] === "\n"
        ) {
          cursor += 2;
        } else if (cursor < group.contentTo) {
          cursor++;
        }
        continue;
      }
    }
    if (split && (character === "," || character === ";")) {
      flush();
      cursor++;
      continue;
    }
    logical.push({ value: character, offset: cursor });
    cursor++;
  }
  flush();
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
  const referenceCommands =
    /\\(crefrange|Crefrange|cpagerefrange|vpagerefrange|hyperlink|ref|eqref|pageref|autoref|cref|Cref|cpageref|vref|Vref|labelcref|nameref|namecref|fref|sref|labelref)\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(referenceCommands)) {
    const groups = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    );
    const braced = groups.filter((group) => group.open === "{");
    const selected = /range$/i.test(match[1])
      ? braced.slice(0, 2)
      : braced.slice(0, 1);
    for (const group of selected) {
      for (const token of latexLogicalGroupTokens(source, group)) {
        tokens.push({
          command: match[1],
          kind: "reference",
          ...token,
        });
      }
    }
  }

  const hyperref = /\\hyperref\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(hyperref)) {
    const group = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    ).find((candidate) => candidate.open === "[");
    if (!group) continue;
    for (const token of latexLogicalGroupTokens(source, group, false)) {
      tokens.push({
        command: "hyperref",
        kind: "reference",
        ...token,
      });
    }
  }

  const commands = /\\([A-Za-z@]+)\*?(?![A-Za-z@])/g;
  for (const match of masked.matchAll(commands)) {
    if (!isLatexCitationCommand(match[1])) continue;
    const groups = commandGroups(
      masked,
      match.index + match[0].length,
      closingByOpening,
    );
    const braced = groups.filter((group) => group.open === "{");
    if (braced.length === 0) continue;
    const command = match[1].toLocaleLowerCase("en-US");
    const selected =
      command.includes("volcite")
        ? command.endsWith("cites")
          ? braced.filter((_group, index) => index % 2 === 1)
          : braced.slice(-1)
        : command.endsWith("cites")
          ? braced
          : braced.slice(0, 1);
    for (const group of selected) {
      for (const token of latexLogicalGroupTokens(source, group)) {
        tokens.push({
          command: match[1],
          kind: "citation",
          ...token,
        });
      }
    }
  }
  return tokens.sort((left, right) => left.from - right.from);
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

function addDelimiterDiagnostics(
  file: string,
  source: string,
  masked: string,
  starts: readonly number[],
  engine: ProjectIntelligenceEngine,
  diagnostics: ProjectDiagnostic[],
): boolean {
  const pairs: Record<string, string> =
    engine === "latex"
      ? { "{": "}" }
      : engine === "typst"
        ? { "{": "}", "[": "]", "(": ")" }
        : {};
  const closers = new Set(Object.values(pairs));
  const stack: { char: string; offset: number }[] = [];
  let quote = false;
  let partial = false;
  for (let offset = 0; offset < masked.length; offset++) {
    const char = masked[offset];
    if (engine === "typst" && char === '"' && masked[offset - 1] !== "\\") {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (engine === "latex") {
      let escapes = 0;
      for (
        let cursor = offset - 1;
        cursor >= 0 && masked[cursor] === "\\";
        cursor--
      ) {
        escapes++;
      }
      if (escapes % 2 === 1) continue;
    }
    if (char in pairs) {
      stack.push({ char, offset });
      continue;
    }
    if (!closers.has(char)) continue;
    const expected = stack.at(-1);
    if (expected && pairs[expected.char] === char) {
      stack.pop();
      continue;
    }
    partial = true;
    const diagnosticLocation = location(
      file,
      starts,
      offset,
      offset + 1,
    );
    diagnostics.push({
      id: stableId("diag", file, offset, "unexpected-delimiter", char),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: `Unexpected closing delimiter "${char}".`,
      location: diagnosticLocation,
      related: [],
    });
  }
  for (const unmatched of stack.slice(-32)) {
    partial = true;
    const expected = pairs[unmatched.char];
    const diagnosticLocation = location(
      file,
      starts,
      unmatched.offset,
      unmatched.offset + 1,
    );
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
      message: `Delimiter "${unmatched.char}" is not closed with "${expected}".`,
      location: diagnosticLocation,
      related: [],
    });
  }
  if (engine === "typst" && quote) {
    partial = true;
    const offset = Math.max(0, source.lastIndexOf('"'));
    diagnostics.push({
      id: stableId("diag", file, offset, "unclosed-string"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: "String literal is not closed.",
      location: location(file, starts, offset, offset + 1),
      related: [],
    });
  }
  return partial;
}

function maskQuotedContents(source: string): string {
  const chars = source.split("");
  let quoted = false;
  for (let index = 0; index < chars.length; index++) {
    if (!quoted) {
      if (chars[index] === '"') quoted = true;
      continue;
    }
    if (chars[index] === "\\") {
      if (chars[index] !== "\n") chars[index] = " ";
      if (index + 1 < chars.length) {
        index++;
        if (chars[index] !== "\n") chars[index] = " ";
      }
      continue;
    }
    if (chars[index] === '"') {
      quoted = false;
    } else if (chars[index] !== "\n") {
      chars[index] = " ";
    }
  }
  return chars.join("");
}

function typstCommentDiagnostics(
  file: string,
  source: string,
  starts: readonly number[],
  diagnostics: ProjectDiagnostic[],
): boolean {
  const stack: number[] = [];
  let quoted = false;
  for (let offset = 0; offset < source.length; offset++) {
    if (stack.length > 0) {
      if (source.startsWith("/*", offset)) {
        stack.push(offset);
        offset++;
      } else if (source.startsWith("*/", offset)) {
        stack.pop();
        offset++;
      }
      continue;
    }
    if (quoted) {
      if (source[offset] === "\\") {
        offset++;
      } else if (source[offset] === '"') {
        quoted = false;
      }
      continue;
    }
    if (source[offset] === '"') {
      quoted = true;
      continue;
    }
    if (source.startsWith("//", offset)) {
      const newline = source.indexOf("\n", offset + 2);
      if (newline < 0) break;
      offset = newline;
      continue;
    }
    if (source.startsWith("/*", offset)) {
      stack.push(offset);
      offset++;
    }
  }
  for (const offset of stack.slice(-32)) {
    diagnostics.push({
      id: stableId("diag", file, offset, "typst-comment"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: "Typst block comment is not closed.",
      location: location(
        file,
        starts,
        offset,
        Math.min(source.length, offset + 2),
      ),
      related: [],
    });
  }
  return stack.length > 0;
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
        ? `Expected \\end{${open.name}} before \\end{${name}}.`
        : `\\end{${name}} has no matching \\begin.`,
      location: location(
        file,
        starts,
        match.index,
        match.index + match[0].length,
      ),
      related: open
        ? [
            {
              message: `\\begin{${open.name}} is here.`,
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
      message: `\\begin{${open.name}} has no matching \\end.`,
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
    const level = isSection
      ? Math.max(0, definition.level ?? 0)
      : sectionStack.length > 0
        ? sectionStack.at(-1)?.level ?? 0
        : 0;
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
    if (!match || match[0] !== content.trim()) return null;
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
    .replace(/[\\$}]/gu, "\\$&");
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
    /^[0-9]$/u.test(
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

function xparseLatexArguments(
  specification: string,
): LatexDefinitionArguments {
  let completionSnippet = "";
  let requiredCount = 0;
  let optionalCount = 0;
  let placeholder = 1;
  let cursor = 0;

  while (cursor < specification.length) {
    cursor = skipLatexWhitespace(specification, cursor);
    while (
      specification[cursor] === "+" ||
      specification[cursor] === "!"
    ) {
      cursor = skipLatexWhitespace(specification, cursor + 1);
    }
    while (specification[cursor] === ">") {
      const processor = latexGroup(specification, cursor + 1);
      cursor = processor?.to ?? specification.length;
      cursor = skipLatexWhitespace(specification, cursor);
    }
    const type = specification[cursor];
    if (!type) break;
    cursor += 1;

    if (type === "m" || type === "b" || type === "v") {
      completionSnippet += `{${snippetPlaceholder(placeholder)}}`;
      placeholder += 1;
      requiredCount += 1;
      continue;
    }
    if (type === "o") {
      completionSnippet += `[${snippetPlaceholder(placeholder)}]`;
      placeholder += 1;
      optionalCount += 1;
      continue;
    }
    if (type === "O") {
      const defaultValue = latexGroup(specification, cursor);
      const value = defaultValue
        ? specification.slice(
            defaultValue.contentFrom,
            defaultValue.contentTo,
          )
        : undefined;
      cursor = defaultValue?.to ?? cursor;
      completionSnippet += `[${snippetPlaceholder(placeholder, value)}]`;
      placeholder += 1;
      optionalCount += 1;
      continue;
    }
    if (type === "s" || type === "t") {
      if (type === "t") {
        cursor = xparseDelimiterToken(
          specification,
          cursor,
        ).next;
      }
      completionSnippet += snippetPlaceholder(placeholder);
      placeholder += 1;
      optionalCount += 1;
      continue;
    }
    if (
      type === "r" ||
      type === "R" ||
      type === "d" ||
      type === "D"
    ) {
      const left = xparseDelimiterToken(specification, cursor);
      const right = xparseDelimiterToken(
        specification,
        left.next,
      );
      cursor = right.next;
      if (type === "R" || type === "D") {
        cursor = latexGroup(specification, cursor)?.to ?? cursor;
      }
      completionSnippet += `${left.value}${snippetPlaceholder(placeholder)}${right.value}`;
      placeholder += 1;
      if (type === "r" || type === "R") requiredCount += 1;
      else optionalCount += 1;
      continue;
    }
    if (type === "e" || type === "E") {
      cursor = latexGroup(specification, cursor)?.to ?? cursor;
      if (type === "E") {
        cursor = latexGroup(specification, cursor)?.to ?? cursor;
      }
      completionSnippet += snippetPlaceholder(placeholder);
      placeholder += 1;
      optionalCount += 1;
    }
  }

  return {
    syntax: "xparse",
    requiredCount,
    optionalCount,
    xparseSpecification: specification,
    completionSnippet,
  };
}

function addLatexDefinitions(
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

  const imports =
    /\\(import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)\*?\s*\{([^}]*)\}\s*\{([^}]*)\}/gi;
  for (const match of masked.matchAll(imports)) {
    const raw = `${match[2].trim().replace(/\/+$/, "")}/${match[3].trim()}`;
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

  const bibliographies =
    /\\(?:bibliography|addbibresource)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const match of masked.matchAll(bibliographies)) {
    const valueOffset =
      match.index + match[0].lastIndexOf("{") + 1;
    for (const keyMatch of match[1].matchAll(/[^,]+/g)) {
      const rawSegment = keyMatch[0];
      const raw = rawSegment.trim();
      if (!raw) continue;
      const leading = rawSegment.length - rawSegment.trimStart().length;
      const nameOffset = valueOffset + keyMatch.index + leading;
      const target = resolveProjectPath(file, raw, ".bib");
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
      edges.push(edgeForUse(use, target));
    }
  }

  // Keep command candidates in the per-file cache. Project assembly retains
  // only names actually defined by this project, avoiding false "unknown
  // command" findings for the LaTeX/package command universe.
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

function markdownSlug(title: string): string {
  return title
    .replace(/<[^>]+>/g, "")
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
  const chars = source.split("");
  const lines = source.split("\n");
  let offset = 0;
  let fence:
    | { char: "`" | "~"; length: number; offset: number }
    | null = null;
  let yaml = source.startsWith("---\n");
  let yamlBibliographyList = false;
  let partial = false;

  for (const [lineIndex, line] of lines.entries()) {
    if (yaml) {
      if (lineIndex > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) {
        yaml = false;
        yamlBibliographyList = false;
        offset += line.length + 1;
        continue;
      }
      const declaration =
        /^bibliography\s*:\s*(.*)\s*$/i.exec(line);
      if (declaration) {
        yamlBibliographyList = declaration[1].trim().length === 0;
        const rawValue = declaration[1].trim();
        const values = rawValue.startsWith("[") && rawValue.endsWith("]")
          ? rawValue.slice(1, -1).split(",")
          : rawValue
            ? [rawValue]
            : [];
        for (const value of values) {
          const raw = value.trim().replace(/^["']|["']$/g, "");
          if (!raw) continue;
          const nameOffset = offset + line.indexOf(value) +
            value.indexOf(raw);
          const target = resolveProjectPath(file, raw, ".bib");
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
      } else if (yamlBibliographyList) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(line);
        if (item) {
          const raw = item[1].trim().replace(/^["']|["']$/g, "");
          const nameOffset = offset + line.lastIndexOf(item[1]) +
            item[1].indexOf(raw);
          const target = resolveProjectPath(file, raw, ".bib");
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
        } else if (/^\S/.test(line)) {
          yamlBibliographyList = false;
        }
      }
      for (let index = offset; index < offset + line.length; index++) {
        chars[index] = " ";
      }
      offset += line.length + 1;
      continue;
    }

    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      const char = marker[0] as "`" | "~";
      if (!fence) {
        fence = { char, length: marker.length, offset };
      } else if (char === fence.char && marker.length >= fence.length) {
        fence = null;
      }
      for (let index = offset; index < offset + line.length; index++) {
        chars[index] = " ";
      }
      offset += line.length + 1;
      continue;
    }
    if (fence) {
      for (let index = offset; index < offset + line.length; index++) {
        chars[index] = " ";
      }
      offset += line.length + 1;
      continue;
    }
    for (const inline of line.matchAll(/(`+)([\s\S]*?)\1/g)) {
      const from = offset + inline.index;
      for (let index = from; index < from + inline[0].length; index++) {
        chars[index] = " ";
      }
    }
    offset += line.length + 1;
  }

  if (fence) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, fence.offset, "markdown-fence"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: "Fenced code block is not closed.",
      location: location(
        file,
        starts,
        fence.offset,
        Math.min(source.length, fence.offset + fence.length),
      ),
      related: [],
    });
  }
  if (yaml) {
    partial = true;
    diagnostics.push({
      id: stableId("diag", file, 0, "markdown-frontmatter"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-source",
      message: "YAML front matter is not closed.",
      location: location(file, starts, 0, Math.min(source.length, 3)),
      related: [],
    });
  }

  const visible = chars.join("");
  const markdownLink =
    /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  const urlRanges: Array<{ from: number; to: number }> = [];
  for (const match of visible.matchAll(markdownLink)) {
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

  const pandocCitation =
    /(?:^|[^\p{Letter}\p{Number}_\\])(-?@)([\p{Letter}\p{Number}_:.#$%&+?~/-]+)/gu;
  for (const match of visible.matchAll(pandocCitation)) {
    const key = match[2].replace(/[.,;!?]+$/u, "");
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

  const explicitAnchor =
    /\{#([A-Za-z][A-Za-z0-9_.:-]*)\}/g;
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

  for (const heading of definitions.filter(
    (definition) => definition.kind === "section",
  )) {
    const lineText =
      lines[heading.location.range.startLine - 1] ?? heading.name;
    const explicit = /\{#([A-Za-z][A-Za-z0-9_.:-]*)\}\s*#*\s*$/.exec(
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
    if (!existing) {
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

  for (const match of visible.matchAll(markdownLink)) {
    const target = match[3];
    const targetOffset = match.index + match[0].indexOf(target);
    const image = match[1] === "!";
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
    const resolved = resolveProjectPath(file, targetPath);
    const kind: ProjectUseKind = image ? "asset" : "link";
    const use = addUse(
      uses,
      "markdown",
      file,
      starts,
      kind,
      target,
      targetOffset,
      targetOffset + target.length,
      resolved ?? undefined,
    );
    edges.push(edgeForUse(use, resolved));
    if (anchor) {
      addUse(
        uses,
        "markdown",
        file,
        starts,
        "reference",
        anchor,
        targetOffset + hash + 1,
        targetOffset + target.length,
        resolved ? `${resolved}#${anchor}` : undefined,
      );
    }
  }

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

  const referenceUse =
    /(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
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

  const bibliography = /#bibliography\s*\(([^)]*)\)/g;
  for (const match of masked.matchAll(bibliography)) {
    if (!codeMask.startsWith("#bibliography", match.index)) continue;
    const argumentsOffset = match.index + match[0].indexOf(match[1]);
    for (const pathMatch of match[1].matchAll(/"([^"]+)"/g)) {
      const raw = pathMatch[1];
      const nameOffset =
        argumentsOffset + pathMatch.index + pathMatch[0].indexOf(raw);
      const target = resolveProjectPath(file, raw, ".bib");
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

  const explicitCitation = /#cite\s*\(/g;
  for (const match of codeMask.matchAll(explicitCitation)) {
    // commandGroups intentionally handles []/{} command arguments. Typst uses
    // parentheses, so balance that argument explicitly while preserving exact
    // offsets for every label or string key inside arrays/tuples.
    let cursor = match.index + match[0].length;
    let depth = 1;
    while (cursor < codeMask.length && depth > 0) {
      // String contents (including escaped quotes) are blanked in codeMask,
      // while structural parentheses and offsets are preserved.
      if (codeMask[cursor] === "(") depth++;
      else if (codeMask[cursor] === ")") depth--;
      cursor++;
    }
    const contentFrom = match.index + match[0].length;
    const contentTo = depth === 0 ? cursor - 1 : cursor;
    const argumentsSource = masked.slice(contentFrom, contentTo);
    const keys: Array<{ name: string; from: number }> = [];
    for (const keyMatch of argumentsSource.matchAll(
      /<([A-Za-z_][A-Za-z0-9_:.#$%&+?~/-]*)>|(?:^|[[(,]\s*|label\s*\(\s*)"([A-Za-z_][A-Za-z0-9_:.#$%&+?~/-]*)"/g,
    )) {
      const name = keyMatch[1] ?? keyMatch[2];
      if (!name) continue;
      keys.push({
        name,
        from:
          contentFrom +
          keyMatch.index +
          keyMatch[0].indexOf(name),
      });
    }
    for (const key of keys) {
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

export function analyzeProjectFile(
  file: string,
  source: string,
  sourceRevision: number,
): FileIntelligence {
  const engine = engineForPath(file);
  if (!engine) {
    throw new Error(`Unsupported project-intelligence file: ${file}`);
  }
  if (engine === "bibtex") {
    return parseBibtexIntelligence(file, source, sourceRevision);
  }

  const starts = lineStarts(source);
  const legacy = parseFile(file, source);
  const definitions: ProjectDefinition[] = [];
  const uses: ProjectUse[] = [];
  const edges: ProjectEdge[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  const fullRanges = new Map<string, SourceRange>();

  for (const symbol of legacy.defs) {
    if (engine === "latex" && symbol.kind === "label") {
      // Re-extracted below with TeX comment-splicing and source mapping.
      continue;
    }
    if (
      engine === "typst" &&
      symbol.kind === "label" &&
      /#(?:ref|link|cite)\s*\([^)]*$/.test(
        source.slice(Math.max(0, symbol.from - 80), symbol.from),
      )
    ) {
      continue;
    }
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
  for (const symbol of legacy.uses) {
    const kind = projectUseKind(symbol, source);
    if (!kind) continue;
    if (
      (engine === "latex" &&
        (kind === "reference" || kind === "citation")) ||
      (engine === "markdown" && kind === "citation")
    ) {
      // The engine-aware extractors below understand multiline/comment-spliced
      // TeX groups and Markdown URL/code masking. Retaining the legacy regex
      // copy would reintroduce false or incorrectly ranged duplicate uses.
      continue;
    }
    if (
      engine === "markdown" &&
      kind === "citation"
    ) {
      let escapes = 0;
      for (
        let offset = symbol.from - 1;
        offset >= 0 && source[offset] === "\\";
        offset--
      ) {
        escapes++;
      }
      if (escapes % 2 === 1) continue;
    }
    const target =
      symbol.kind === "inputedge" && engine === "latex"
        ? resolveProjectPath(file, symbol.name) ?? undefined
        : symbol.target;
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
    if (
      kind === "include" ||
      kind === "import" ||
      kind === "link" ||
      kind === "asset" ||
      kind === "bibliography"
    ) {
      edges.push(edgeForUse(use, target ?? null));
    }
  }

  let partial = false;
  if (engine === "latex") {
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
    partial = delimiterPartial || environmentPartial;
  } else if (engine === "markdown") {
    partial = markdownAdditionalSyntax(
      file,
      source,
      starts,
      definitions,
      uses,
      edges,
      diagnostics,
    );
  } else {
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
    partial = delimiterPartial || commentPartial;
  }

  const uniqueDefinitions = uniqueById(definitions);
  const uniqueUses = uniqueById(uses);
  const uniqueEdges = uniqueById(edges);
  const bibliographyEntries =
    engine === "latex"
      ? uniqueDefinitions
          .filter(
            (definition) => definition.kind === "bibentry",
          )
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
              fullRanges.get(definition.id) ??
              definition.location.range,
            keyRange: definition.location.range,
            typeRange: definition.location.range,
            fields: [],
            complete: true,
            duplicate: false,
            duplicateIndex: 0,
            duplicateCount: 1,
          }))
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
      fullRanges,
    ),
    definitions: uniqueDefinitions,
    uses: uniqueUses,
    edges: uniqueEdges,
    diagnostics,
    bibliographyEntries,
  };
}
