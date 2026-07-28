import {
  DEFAULT_POSITION_ENCODING,
  TextPositionIndex,
  type JsonValue,
  type Position,
  type PositionEncoding,
} from "@/lib/language-service";
import {
  lineStarts,
  rangeFromOffsets,
  stableId,
} from "./source";
import type {
  ExternalProjectIntelligence,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectIntelligenceEngine,
  ProjectIntelligenceIdentity,
} from "./types";

interface LanguageServiceSymbol {
  readonly name: string;
  readonly kind: number;
  readonly uri: string;
  readonly start: Position;
  readonly end: Position;
}

interface ContributionOptions {
  readonly identity: ProjectIntelligenceIdentity;
  readonly provider: "texlab" | "tinymist";
  readonly workspaceRoot: string;
  readonly texts: ReadonlyMap<string, string>;
  readonly positionEncoding?: PositionEncoding;
  readonly symbols: JsonValue;
}

const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === "number" &&
    Number.isSafeInteger(value.character) &&
    value.character >= 0
  );
}

function symbolFromValue(
  value: unknown,
): LanguageServiceSymbol | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    typeof value.kind !== "number" ||
    !Number.isSafeInteger(value.kind)
  ) {
    return null;
  }
  const location = isRecord(value.location)
    ? value.location
    : null;
  const range = location && isRecord(location.range)
    ? location.range
    : null;
  if (
    !location ||
    typeof location.uri !== "string" ||
    !range ||
    !isPosition(range.start) ||
    !isPosition(range.end)
  ) {
    return null;
  }
  return {
    name: value.name.trim(),
    kind: value.kind,
    uri: location.uri,
    start: range.start,
    end: range.end,
  };
}

function symbolsFromValue(value: JsonValue): LanguageServiceSymbol[] {
  if (!Array.isArray(value)) return [];
  const symbols: LanguageServiceSymbol[] = [];
  for (const candidate of value) {
    const symbol = symbolFromValue(candidate);
    if (symbol) symbols.push(symbol);
  }
  return symbols;
}

function uriForProjectPath(
  workspaceRoot: string,
  path: string,
): string {
  const root = workspaceRoot
    .replaceAll("\\", "/")
    .replace(/\/+$/u, "");
  const relative = path
    .replaceAll("\\", "/")
    .replace(/^\/+/u, "");
  const absolute = `${root}/${relative}`;
  const encoded = absolute
    .split("/")
    .map((segment, index) =>
      index === 0 && /^[A-Za-z]:$/u.test(segment)
        ? segment
        : encodeURIComponent(segment),
    )
    .join("/");
  return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

function pathByUri(
  workspaceRoot: string,
  texts: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const path of texts.keys()) {
    result.set(uriForProjectPath(workspaceRoot, path), path);
  }
  return result;
}

function lineAtOffset(text: string, offset: number): string {
  const from = text.lastIndexOf("\n", offset - 1) + 1;
  const next = text.indexOf("\n", offset);
  return text.slice(from, next < 0 ? text.length : next);
}

function latexDefinition(
  symbol: LanguageServiceSymbol,
  source: string,
  from: number,
  to: number,
): {
  kind: ProjectDefinitionKind;
  name: string;
  level?: number;
} | null {
  const excerpt = source.slice(from, to);
  const line = lineAtOffset(source, from);
  const section = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/u.exec(
    line,
  );
  if (section || symbol.kind === 2) {
    const levels: Readonly<Record<string, number>> = {
      part: 1,
      chapter: 1,
      section: 1,
      subsection: 2,
      subsubsection: 3,
      paragraph: 4,
      subparagraph: 5,
    };
    return {
      kind: "section",
      name: symbol.name,
      level: section ? levels[section[1]] : 1,
    };
  }
  const label = /\\label\s*\{([^}]+)\}/u.exec(excerpt);
  if (label) {
    return { kind: "label", name: label[1].trim() };
  }
  const macro =
    /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*\{?\\([A-Za-z@]+)\}?/u.exec(
      excerpt,
    ) ??
    /\\(?:def|gdef|edef|xdef)\s*\\([A-Za-z@]+)/u.exec(excerpt);
  if (macro) {
    return { kind: "macro", name: macro[1] };
  }
  const namedMacro = /^define\s+\\([A-Za-z@]+)$/iu.exec(symbol.name);
  if (namedMacro) {
    return { kind: "macro", name: namedMacro[1] };
  }
  const environment = /\\begin\s*\{([^}]+)\}/u.exec(excerpt);
  if (environment) {
    return {
      kind: "environment",
      name: environment[1].trim(),
    };
  }
  return null;
}

function typstDefinition(
  symbol: LanguageServiceSymbol,
  source: string,
  from: number,
  to: number,
): {
  kind: ProjectDefinitionKind;
  name: string;
  level?: number;
} | null {
  const excerpt = source.slice(from, to);
  const line = lineAtOffset(source, from);
  const heading = /^\s*(=+)\s+/u.exec(line);
  if (heading) {
    return {
      kind: "section",
      name: symbol.name,
      level: heading[1].length,
    };
  }
  const label = /<([^>\s]+)>/u.exec(excerpt);
  if (label) return { kind: "label", name: label[1] };
  const binding = /#(?:let|show)\s+([A-Za-z_][\w-]*)/u.exec(
    excerpt,
  );
  if (binding) return { kind: "macro", name: binding[1] };
  return null;
}

function engineForPath(
  path: string,
): ProjectIntelligenceEngine | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".typ")) return "typst";
  if (
    lower.endsWith(".tex") ||
    lower.endsWith(".ltx") ||
    lower.endsWith(".latex") ||
    lower.endsWith(".sty") ||
    lower.endsWith(".cls")
  ) {
    return "latex";
  }
  return null;
}

/**
 * Converts only symbols whose source meaning can be recovered exactly. Server
 * display-only nodes (figures, equations, list items, package internals) stay
 * out of the project graph instead of being guessed into a wrong namespace.
 */
export function languageServiceContribution({
  identity,
  provider,
  workspaceRoot,
  texts,
  positionEncoding = DEFAULT_POSITION_ENCODING,
  symbols: rawSymbols,
}: ContributionOptions): ExternalProjectIntelligence {
  const paths = pathByUri(workspaceRoot, texts);
  const definitions: ProjectDefinition[] = [];
  const startsByPath = new Map<string, readonly number[]>();
  const positionsByPath = new Map<string, TextPositionIndex>();
  for (const symbol of symbolsFromValue(rawSymbols)) {
    const path = paths.get(symbol.uri);
    if (!path) continue;
    const source = texts.get(path);
    const engine = engineForPath(path);
    if (source === undefined || engine === null) continue;
    let positions = positionsByPath.get(path);
    if (!positions) {
      positions = new TextPositionIndex(source);
      positionsByPath.set(path, positions);
    }
    const from = positions.positionToOffset(
      symbol.start,
      positionEncoding,
    );
    const to = Math.max(
      from,
      positions.positionToOffset(symbol.end, positionEncoding),
    );
    const recovered =
      engine === "latex"
        ? latexDefinition(symbol, source, from, to)
        : typstDefinition(symbol, source, from, to);
    if (!recovered || recovered.name.length === 0) continue;
    let starts = startsByPath.get(path);
    if (!starts) {
      starts = lineStarts(source);
      startsByPath.set(path, starts);
    }
    definitions.push({
      id: stableId(
        "def",
        provider,
        path,
        from,
        recovered.kind,
        recovered.name,
      ),
      source: provider,
      engine,
      kind: recovered.kind,
      name: recovered.name,
      location: {
        file: path,
        range: rangeFromOffsets(starts, from, to),
      },
      ...(recovered.level === undefined
        ? {}
        : { level: recovered.level }),
    });
  }
  return { identity, definitions, uses: [] };
}
