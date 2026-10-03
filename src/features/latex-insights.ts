import {
  bibliographyCandidatePaths,
  bibliographyDeclarations,
  collectLatexOutlineMacros,
  renderLatexOutlineTitle,
} from "@oleafly/latex";
import {
  bibtexKeys,
  citationList,
  emptyInsights,
  emptyMetadata,
  lineLocator,
  TODO_MARKER,
  todoText,
  type DocumentInsightsBase,
  type InsightEntry,
  type InsightEntryKind,
  type LabelEntry,
  type SourceLocation,
  type SubmissionMetadata,
  type TodoEntry,
} from "./document-insights";

export interface LatexLabelNumber {
  number: string;
  page: string;
}

export interface LatexInsightsInput {
  mainDoc: string;
  texts: Readonly<Record<string, string>>;
  numberFor?: ((label: string) => LatexLabelNumber | null) | null;
}

type Macros = ReadonlyMap<string, string>;
type LabelKind = LabelEntry["kind"];

interface EnvRange {
  name: string;
  from: number;
  bodyFrom: number;
  bodyTo: number;
  to: number;
  parent: EnvRange | null;
}

interface ScannedFile {
  path: string;
  text: string;
  plain: string;
  masked: string;
  envs: EnvRange[];
  bodyFrom: number;
  bodyTo: number;
  locate: (offset: number) => { line: number; column: number };
}

interface HeadingEvent {
  type: "heading";
  at: number;
  end: number;
  base: number;
  starred: boolean;
  title: string;
  label: string | null;
}

interface CaptionedEvent {
  type: "figure" | "table";
  at: number;
  text: string;
  label: string | null;
  numbered: boolean;
}

interface EquationEvent {
  type: "equation";
  at: number;
  text: string;
  label: string | null;
  numbered: boolean;
}

interface LabelEvent {
  type: "label";
  at: number;
  name: string;
  kind: LabelKind | null;
}

interface CiteEvent {
  type: "cite";
  at: number;
  keys: string[];
}

interface TodoEvent {
  type: "todo";
  at: number;
  text: string;
}

interface IncludeEvent {
  type: "include";
  at: number;
  candidates: string[];
  structure: boolean;
}

type FileEvent = HeadingEvent | CaptionedEvent | EquationEvent | LabelEvent | CiteEvent | TodoEvent;
type LocatedEvent = FileEvent & { file: ScannedFile };

interface WalkContext {
  texts: Readonly<Record<string, string>>;
  mainDoc: string;
  theorems: ReadonlySet<string>;
  visited: Set<string>;
  files: ScannedFile[];
  events: LocatedEvent[];
  missing: string[][];
  declarations: { raw: string; file: string; command: "bibliography" | "addbibresource" }[];
  bibitems: string[];
}

const SECTION_BASE: Readonly<Record<string, number>> = {
  part: 0,
  chapter: 1,
  addchap: 1,
  section: 2,
  addsec: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const UNNUMBERED_SECTIONS = new Set(["addchap", "addsec"]);
const HEADING_COMMAND = /\\(part|chapter|addchap|section|addsec|subsection|subsubsection|paragraph|subparagraph)(?![A-Za-z@])(\*?)/gu;
const FIGURE_ENVS = new Set(["figure", "wrapfigure", "SCfigure", "subfigure", "sidewaysfigure", "marginfigure", "wrapfloat"]);
const TABLE_ENVS = new Set(["table", "wraptable", "longtable", "sidewaystable", "subtable", "margintable", "SCtable", "xltabular", "longtabu"]);
const SUB_FLOATS = new Set(["subfigure", "subtable"]);
const EQUATION_ENVS = new Set([
  "equation",
  "align",
  "gather",
  "multline",
  "flalign",
  "alignat",
  "eqnarray",
  "displaymath",
  "subequations",
  "IEEEeqnarray",
  "dmath",
  "dgroup",
]);
const OTHER_STEPPING_ENVS = new Set(["enumerate", "algorithm", "listing", "lstlisting", "minted"]);
const DEFAULT_THEOREMS = [
  "theorem",
  "lemma",
  "proposition",
  "corollary",
  "definition",
  "example",
  "remark",
  "conjecture",
  "claim",
  "assumption",
  "hypothesis",
  "problem",
  "exercise",
  "fact",
  "observation",
];
const VERBATIM_ENVS = ["verbatim", "Verbatim", "BVerbatim", "LVerbatim", "lstlisting", "minted", "comment", "filecontents"];
const CITE_COMMANDS = [
  "cite",
  "Cite",
  "citep",
  "Citep",
  "citet",
  "Citet",
  "citealt",
  "Citealt",
  "citealp",
  "Citealp",
  "citeauthor",
  "Citeauthor",
  "citeyear",
  "citeyearpar",
  "citenum",
  "citetitle",
  "citedate",
  "citeurl",
  "citeA",
  "citeNP",
  "shortcite",
  "shortciteNP",
  "parencite",
  "Parencite",
  "textcite",
  "Textcite",
  "autocite",
  "Autocite",
  "footcite",
  "footcitetext",
  "smartcite",
  "Smartcite",
  "supercite",
  "fullcite",
  "footfullcite",
];
const MULTI_CITE_COMMANDS = ["cites", "Cites", "parencites", "Parencites", "textcites", "Textcites", "autocites", "Autocites", "footcites", "smartcites"];
const CITE_COMMAND = new RegExp(
  String.raw`\\(${[...MULTI_CITE_COMMANDS, ...CITE_COMMANDS].sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z@])\*?`,
  "gu",
);
const MULTI_CITE = new Set(MULTI_CITE_COMMANDS);
const TODO_COMMAND = /\\(todo|missingfigure|fixme|fxnote|fxwarning|fxerror|fxfatal|TODO|FIXME)(?![A-Za-z@])\*?/gu;
const INCLUDE_COMMAND = /\\(input|include|subfile|import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)(?![A-Za-z@])\*?/gu;
const DROPPED_COMMANDS = new Set([
  "thanks",
  "footnote",
  "footnotemark",
  "inst",
  "orcidlink",
  "orcidID",
  "orcid",
  "textsuperscript",
  "IEEEauthorrefmark",
  "IEEEauthorblockA",
  "IEEEmembership",
  "corref",
  "fnref",
  "tnoteref",
  "label",
  "vspace",
  "hspace",
  "affiliation",
  "affil",
  "email",
  "ead",
  "address",
  "institution",
  "authornote",
]);
const LAYOUT_ARGUMENTS: Readonly<Record<string, number>> = {
  parbox: 1,
  resizebox: 2,
  scalebox: 1,
  raisebox: 1,
  rotatebox: 1,
  textcolor: 1,
  colorbox: 1,
  color: 1,
  fontsize: 2,
  rule: 2,
};
const AUTHOR_SEPARATOR = /\\(?:and|And|AND|quad|qquad|hfill)(?![A-Za-z@])|\\hspace\*?\s*\{[^{}]*\}/gu;
const DECLARATIVES =
  /\\(?:bfseries|itshape|slshape|scshape|upshape|mdseries|rmfamily|sffamily|ttfamily|normalfont|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|centering|raggedright|raggedleft|noindent|indent|par|maketitle|selectfont|newline|linebreak|smallskip|medskip|bigskip|hfill|vfill|quad|qquad|nonumber|notag)(?![A-Za-z@])/gu;
const MATH_SEGMENT = /(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])+\$|\\\([\s\S]*?\\\))/u;
const KEYWORD_SEPARATOR = /\s*(?:,|;|\\and(?![A-Za-z@])|\\sep(?![A-Za-z@])|\\textbullet(?![A-Za-z@])|·)\s*/u;

function blank(text: string): string {
  return text.replaceAll(/[^\n]/gu, " ");
}

function escaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function maskComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let index = line.indexOf("%"); index >= 0; index = line.indexOf("%", index + 1)) {
        if (!escaped(line, index)) return `${line.slice(0, index)}${" ".repeat(line.length - index)}`;
      }
      return line;
    })
    .join("\n");
}

function maskVerbatim(text: string): string {
  let result = text;
  for (const name of VERBATIM_ENVS) {
    const pattern = new RegExp(String.raw`\\begin\s*\{${name}\*?\}[\s\S]*?(?:\\end\s*\{${name}\*?\}|$)`, "gu");
    result = result.replace(pattern, blank);
  }
  return result.replace(/\\(?:verb|lstinline)\*?([^A-Za-z\s{])[^\n]*?\1/gu, blank);
}

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipSpace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
  return cursor;
}

function skipOptional(text: string, index: number): number {
  let cursor = skipSpace(text, index);
  while (text[cursor] === "[") {
    let depth = 0;
    let end = -1;
    for (let scan = cursor; scan < text.length; scan += 1) {
      const char = text[scan];
      if (char === "\\") {
        scan += 1;
        continue;
      }
      if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0 && char === "]") {
          end = scan;
          break;
        }
      }
    }
    if (end < 0) return cursor;
    cursor = skipSpace(text, end + 1);
  }
  return cursor;
}

function readGroup(text: string, index: number): { content: string; from: number; end: number } | null {
  const open = skipSpace(text, index);
  if (text[open] !== "{") return null;
  const close = matchBrace(text, open);
  if (close < 0) return null;
  return { content: text.slice(open + 1, close), from: open + 1, end: close + 1 };
}

function commandArgument(text: string, after: number): { content: string; from: number; end: number } | null {
  return readGroup(text, skipOptional(text, after));
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

function joinPath(...segments: string[]): string | null {
  return normalizePath(segments.filter(Boolean).join("/"));
}

function withTexExtension(path: string): string[] {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? [path, `${path}.tex`] : [`${path}.tex`];
}

function includeCandidates(command: string, args: string[], fromFile: string, mainDoc: string): string[] {
  const target = args.at(-1)?.trim() ?? "";
  if (!target || target.includes("#")) return [];
  const mainDir = dirname(mainDoc);
  const fileDir = dirname(fromFile);
  let bases: (string | null)[];
  if (command === "import" || command === "inputfrom" || command === "includefrom") {
    bases = [joinPath(mainDir, args[0] ?? "", target)];
  } else if (command.startsWith("sub") && command !== "subfile") {
    bases = [joinPath(fileDir, args[0] ?? "", target)];
  } else {
    bases = [joinPath(mainDir, target), joinPath(fileDir, target)];
  }
  const candidates: string[] = [];
  for (const base of bases) {
    if (!base) continue;
    for (const candidate of withTexExtension(base)) if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function scanEnvironments(masked: string): EnvRange[] {
  const ranges: EnvRange[] = [];
  const stack: EnvRange[] = [];
  for (const match of masked.matchAll(/\\(begin|end)\s*\{([^{}]+)\}/gu)) {
    const name = match[2].trim();
    const at = match.index;
    if (match[1] === "begin") {
      const range: EnvRange = {
        name,
        from: at,
        bodyFrom: at + match[0].length,
        bodyTo: masked.length,
        to: masked.length,
        parent: stack.at(-1) ?? null,
      };
      stack.push(range);
      ranges.push(range);
      continue;
    }
    let open = stack.length - 1;
    while (open >= 0 && stack[open].name !== name) open -= 1;
    if (open < 0) continue;
    while (stack.length > open) {
      const range = stack.pop() as EnvRange;
      range.bodyTo = at;
      range.to = at + match[0].length;
    }
  }
  return ranges;
}

function innermost(envs: readonly EnvRange[], offset: number): EnvRange | null {
  let found: EnvRange | null = null;
  for (const range of envs) {
    if (range.bodyFrom <= offset && offset < range.bodyTo && (!found || range.from > found.from)) found = range;
  }
  return found;
}

function baseName(name: string): string {
  return name.endsWith("*") ? name.slice(0, -1) : name;
}

function envKind(name: string, theorems: ReadonlySet<string>): LabelKind | null {
  const base = baseName(name);
  if (FIGURE_ENVS.has(base)) return "figure";
  if (TABLE_ENVS.has(base)) return "table";
  if (EQUATION_ENVS.has(base)) return "equation";
  if (OTHER_STEPPING_ENVS.has(base) || theorems.has(base)) return "other";
  return null;
}

function enclosingKind(envs: readonly EnvRange[], offset: number, theorems: ReadonlySet<string>): LabelKind | null {
  for (let range = innermost(envs, offset); range; range = range.parent) {
    const kind = envKind(range.name, theorems);
    if (kind) return kind;
  }
  return null;
}

function floatKind(name: string): "figure" | "table" | null {
  const base = baseName(name);
  if (FIGURE_ENVS.has(base)) return "figure";
  if (TABLE_ENVS.has(base)) return "table";
  return null;
}

function hasAncestor(range: EnvRange, accept: (range: EnvRange) => boolean): boolean {
  for (let parent = range.parent; parent; parent = parent.parent) if (accept(parent)) return true;
  return false;
}

function insideRange(ranges: readonly EnvRange[], offset: number): boolean {
  return ranges.some((range) => range.from <= offset && offset < range.to);
}

function splitMath(text: string): string[] {
  return text.split(MATH_SEGMENT);
}

function dropCommands(source: string): string {
  let result = "";
  let index = 0;
  const pattern = /\\([A-Za-z@]+)\*?/gu;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const leading = LAYOUT_ARGUMENTS[match[1]];
    if (!DROPPED_COMMANDS.has(match[1]) && leading === undefined) continue;
    result += source.slice(index, match.index);
    let end = pattern.lastIndex;
    for (let count = 0; count < (leading ?? 1); count += 1) {
      const argument = commandArgument(source, end);
      if (!argument) break;
      end = argument.end;
    }
    index = end;
    pattern.lastIndex = index;
  }
  return result + source.slice(index);
}

function plainSegment(segment: string, macros: Macros): string {
  const text = renderLatexOutlineTitle(segment.replace(DECLARATIVES, " "), macros)
    .replaceAll(/\\[A-Za-z@]+\*?/gu, "")
    .replaceAll(/[{}]/gu, "");
  return `${/^\s/u.test(segment) ? " " : ""}${text}${/\s$/u.test(segment) ? " " : ""}`;
}

export function latexPlainText(source: string, macros: Macros = new Map()): string {
  const prepared = dropCommands(source).replaceAll(/\\\\\*?(?:\s*\[[^\]]*\])?/gu, " ");
  return splitMath(prepared)
    .map((segment, index) => (index % 2 === 1 ? segment : plainSegment(segment, macros)))
    .join("")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function scanFile(path: string, text: string): ScannedFile {
  const plain = maskVerbatim(text);
  const masked = maskComments(plain);
  const begin = /\\begin\s*\{document\}/u.exec(masked);
  const bodyFrom = begin ? begin.index + begin[0].length : 0;
  const endMatch = /\\end\s*\{document\}/u.exec(masked.slice(bodyFrom));
  const bodyTo = endMatch ? bodyFrom + endMatch.index : masked.length;
  return { path, text, plain, masked, envs: scanEnvironments(masked), bodyFrom, bodyTo, locate: lineLocator(text) };
}

function headingEvents(file: ScannedFile, inBody: (offset: number) => boolean, macros: Macros): HeadingEvent[] {
  const events: HeadingEvent[] = [];
  const { masked } = file;
  for (const match of masked.matchAll(HEADING_COMMAND)) {
    if (!inBody(match.index)) continue;
    const argument = commandArgument(masked, match.index + match[0].length);
    if (!argument || /#\d/u.test(argument.content)) continue;
    const inner = /\\label\s*\{([^{}]*)\}/u.exec(argument.content);
    const after = /^\s*\\label\s*\{([^{}]*)\}/u.exec(masked.slice(argument.end));
    events.push({
      type: "heading",
      at: match.index,
      end: argument.end,
      base: SECTION_BASE[match[1]],
      starred: match[2] === "*" || UNNUMBERED_SECTIONS.has(match[1]),
      title: latexPlainText(argument.content, macros),
      label: inner?.[1].trim() ?? after?.[1].trim() ?? null,
    });
  }
  return events;
}

function labelEvents(file: ScannedFile, inBody: (offset: number) => boolean, theorems: ReadonlySet<string>): LabelEvent[] {
  const events: LabelEvent[] = [];
  for (const match of file.masked.matchAll(/\\label\s*\{([^{}]*)\}/gu)) {
    const name = match[1].trim();
    if (!name || name.includes("#") || !inBody(match.index)) continue;
    events.push({ type: "label", at: match.index, name, kind: enclosingKind(file.envs, match.index, theorems) });
  }
  return events;
}

function captionsIn(file: ScannedFile, range: EnvRange, nested: readonly EnvRange[]): { at: number; end: number; text: string; star: boolean }[] {
  const captions: { at: number; end: number; text: string; star: boolean }[] = [];
  const body = file.masked.slice(range.bodyFrom, range.bodyTo);
  for (const match of body.matchAll(/\\caption(?![A-Za-z@])(\*?)/gu)) {
    const at = range.bodyFrom + match.index;
    if (insideRange(nested, at)) continue;
    const afterName = at + match[0].length;
    const emptyShort = /^\s*\[\s*\]/u.test(file.masked.slice(afterName));
    const argument = commandArgument(file.masked, afterName);
    if (!argument) continue;
    if (emptyShort && baseName(range.name) === "longtable" && captions.length > 0) continue;
    captions.push({ at, end: argument.end, text: argument.content, star: match[1] === "*" });
  }
  return captions;
}

function labelAfter(labels: readonly LabelEvent[], from: number, to: number): string | null {
  return labels.find((label) => label.at >= from && label.at < to)?.name ?? null;
}

function floatEvents(
  file: ScannedFile,
  inBody: (offset: number) => boolean,
  labels: readonly LabelEvent[],
  macros: Macros,
): CaptionedEvent[] {
  const events: CaptionedEvent[] = [];
  const floats = file.envs.filter((range) => floatKind(range.name) !== null);
  for (const range of floats) {
    const kind = floatKind(range.name) as "figure" | "table";
    if (!inBody(range.from)) continue;
    if (SUB_FLOATS.has(baseName(range.name)) && hasAncestor(range, (parent) => floatKind(parent.name) !== null)) continue;
    const nested = floats.filter((other) => other !== range && other.from > range.from && other.to <= range.to);
    const ownLabels = labels.filter((label) => label.at >= range.bodyFrom && label.at < range.bodyTo && !insideRange(nested, label.at));
    const captions = captionsIn(file, range, nested);
    if (captions.length === 0) {
      events.push({ type: kind, at: range.from, text: "", label: ownLabels[0]?.name ?? null, numbered: false });
      continue;
    }
    captions.forEach((caption, index) => {
      const until = captions[index + 1]?.at ?? range.bodyTo;
      events.push({
        type: kind,
        at: captions.length === 1 ? range.from : caption.at,
        text: latexPlainText(caption.text, macros),
        label: labelAfter(ownLabels, caption.at, until),
        numbered: !caption.star,
      });
    });
  }
  for (const match of file.masked.matchAll(/\\captionof\s*\{\s*(figure|table)\s*\}/gu)) {
    if (!inBody(match.index) || insideRange(floats, match.index)) continue;
    const argument = commandArgument(file.masked, match.index + match[0].length);
    if (!argument) continue;
    const container = innermost(file.envs, match.index);
    const next = /\\caption(?:of)?(?![A-Za-z@])/u.exec(file.masked.slice(argument.end));
    const until = Math.min(container?.bodyTo ?? file.bodyTo, next ? argument.end + next.index : file.bodyTo);
    events.push({
      type: match[1] as "figure" | "table",
      at: match.index,
      text: latexPlainText(argument.content, macros),
      label: labelAfter(labels, argument.end, until),
      numbered: true,
    });
  }
  return events;
}

function equationText(body: string): string {
  return body
    .replaceAll(/\\label\s*\{[^{}]*\}/gu, " ")
    .replaceAll(/\\(?:nonumber|notag)(?![A-Za-z@])/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function equationEvents(file: ScannedFile, inBody: (offset: number) => boolean, labels: readonly LabelEvent[]): EquationEvent[] {
  const events: EquationEvent[] = [];
  const isEquation = (range: EnvRange) => EQUATION_ENVS.has(baseName(range.name)) && baseName(range.name) !== "subequations";
  const equations = file.envs.filter(isEquation);
  for (const range of equations) {
    if (!inBody(range.from) || hasAncestor(range, isEquation)) continue;
    let body = file.masked.slice(range.bodyFrom, range.bodyTo);
    if (baseName(range.name) === "alignat") body = body.replace(/^\s*\{[^{}]*\}/u, "");
    const base = baseName(range.name);
    events.push({
      type: "equation",
      at: range.from,
      text: equationText(body),
      label: labelAfter(labels, range.bodyFrom, range.bodyTo),
      numbered: !range.name.endsWith("*") && base !== "displaymath",
    });
  }
  const { masked } = file;
  for (const match of masked.matchAll(/\\\[/gu)) {
    if (escaped(masked, match.index) || !inBody(match.index) || insideRange(equations, match.index)) continue;
    let close = masked.indexOf(String.raw`\]`, match.index + 2);
    while (close >= 0 && escaped(masked, close)) close = masked.indexOf(String.raw`\]`, close + 2);
    if (close < 0) continue;
    events.push({ type: "equation", at: match.index, text: equationText(masked.slice(match.index + 2, close)), label: null, numbered: false });
  }
  const dollars = [...masked.matchAll(/\$\$/gu)].filter((match) => !escaped(masked, match.index));
  for (let index = 0; index + 1 < dollars.length; index += 2) {
    const open = dollars[index].index;
    if (!inBody(open)) continue;
    events.push({ type: "equation", at: open, text: equationText(masked.slice(open + 2, dollars[index + 1].index)), label: null, numbered: false });
  }
  return events;
}

function citeEvents(file: ScannedFile, inBody: (offset: number) => boolean): CiteEvent[] {
  const events: CiteEvent[] = [];
  const { masked } = file;
  for (const match of masked.matchAll(CITE_COMMAND)) {
    if (!inBody(match.index)) continue;
    const multi = MULTI_CITE.has(match[1]);
    let cursor = match.index + match[0].length;
    if (multi) {
      for (let notes = 0; notes < 2; notes += 1) {
        const at = skipSpace(masked, cursor);
        if (masked[at] !== "(") break;
        const close = masked.indexOf(")", at);
        if (close < 0) break;
        cursor = close + 1;
      }
    }
    const keys: string[] = [];
    for (;;) {
      const argument = commandArgument(masked, cursor);
      if (!argument) break;
      for (const key of argument.content.split(",")) {
        const trimmed = key.trim();
        if (trimmed && trimmed !== "*" && !trimmed.includes("#")) keys.push(trimmed);
      }
      cursor = argument.end;
      if (!multi) break;
    }
    if (keys.length > 0) events.push({ type: "cite", at: match.index, keys });
  }
  return events;
}

function todoEvents(file: ScannedFile): TodoEvent[] {
  const events: TodoEvent[] = [];
  const spans: [number, number][] = [];
  for (const match of file.masked.matchAll(TODO_COMMAND)) {
    const argument = commandArgument(file.masked, match.index + match[0].length);
    if (!argument) continue;
    spans.push([match.index, argument.end]);
    events.push({ type: "todo", at: match.index, text: todoText(file.text.slice(match.index, argument.end)) });
  }
  let offset = 0;
  for (const line of file.plain.split("\n")) {
    const match = TODO_MARKER.exec(line);
    const at = offset + (match?.index ?? 0);
    if (match && line[match.index - 1] !== "\\" && !spans.some(([from, to]) => at >= from && at < to)) {
      events.push({ type: "todo", at, text: todoText(file.text.slice(at, offset + line.length)) });
    }
    offset += line.length + 1;
  }
  return events;
}

function includeEvents(file: ScannedFile, mainDoc: string, inBody: (offset: number) => boolean): IncludeEvent[] {
  const events: IncludeEvent[] = [];
  const { masked } = file;
  for (const match of masked.matchAll(INCLUDE_COMMAND)) {
    const command = match[1];
    const args: string[] = [];
    let cursor = match.index + match[0].length;
    const count = /^(?:sub)?(?:import|inputfrom|includefrom)$/u.test(command) ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const argument = readGroup(masked, cursor);
      if (!argument) break;
      args.push(argument.content.trim());
      cursor = argument.end;
    }
    if (args.length < count) continue;
    const candidates = includeCandidates(command, args, file.path, mainDoc);
    if (candidates.length > 0) events.push({ type: "include", at: match.index, candidates, structure: inBody(match.index) });
  }
  return events;
}

function theoremNames(texts: Readonly<Record<string, string>>): Set<string> {
  const names = new Set(DEFAULT_THEOREMS);
  for (const [path, text] of Object.entries(texts)) {
    if (!/\.(?:tex|ltx|latex|sty|cls)$/iu.test(path)) continue;
    for (const match of text.matchAll(/\\(?:newtheorem\*?|declaretheorem(?:\s*\[[^\]]*\])?|newmdtheoremenv|newtcbtheorem(?:\s*\[[^\]]*\])?)\s*\{([^{}]+)\}/gu)) {
      names.add(match[1].trim());
    }
  }
  return names;
}

function walk(path: string, structure: boolean, context: WalkContext, macros: Macros, depth = 0): void {
  if (depth > 32 || context.visited.has(path)) return;
  const text = context.texts[path];
  if (text === undefined) return;
  context.visited.add(path);
  const file = scanFile(path, text);
  context.files.push(file);
  for (const declaration of bibliographyDeclarations(file.masked)) {
    context.declarations.push({ raw: declaration.raw, file: path, command: declaration.command });
  }
  for (const match of file.masked.matchAll(/\\bibitem\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/gu)) context.bibitems.push(match[1].trim());
  const inBody = (offset: number) => structure && offset >= file.bodyFrom && offset < file.bodyTo;
  const labels = labelEvents(file, inBody, context.theorems);
  const events: (FileEvent | IncludeEvent)[] = [
    ...headingEvents(file, inBody, macros),
    ...labels,
    ...floatEvents(file, inBody, labels, macros),
    ...equationEvents(file, inBody, labels),
    ...citeEvents(file, inBody),
    ...todoEvents(file),
    ...includeEvents(file, context.mainDoc, (offset) => offset >= file.bodyFrom && offset < file.bodyTo),
  ];
  events.sort((left, right) => left.at - right.at);
  for (const event of events) {
    if (event.type !== "include") {
      context.events.push({ ...event, file });
      continue;
    }
    const target = event.candidates.find((candidate) => context.texts[candidate] !== undefined);
    if (target) walk(target, structure && event.structure, context, macros, depth + 1);
    else if (!context.missing.some((known) => known[0] === event.candidates[0])) context.missing.push(event.candidates);
  }
}

function runWalk(mainDoc: string, texts: Readonly<Record<string, string>>, macros: Macros): WalkContext {
  const context: WalkContext = {
    texts,
    mainDoc,
    theorems: theoremNames(texts),
    visited: new Set(),
    files: [],
    events: [],
    missing: [],
    declarations: [],
    bibitems: [],
  };
  walk(mainDoc, true, context, macros);
  return context;
}

function bibliographyTargets(context: WalkContext): { resolved: string[]; missing: string[][] } {
  const resolved: string[] = [];
  const missing: string[][] = [];
  for (const declaration of context.declarations) {
    const candidates = bibliographyCandidatePaths(
      declaration.raw,
      declaration.file,
      declaration.command === "addbibresource" ? "biblatex" : "latex",
    );
    const found = candidates.find((candidate) => context.texts[candidate] !== undefined);
    if (found) {
      if (!resolved.includes(found)) resolved.push(found);
    } else if (candidates.length > 0 && !missing.some((known) => known[0] === candidates[0])) {
      missing.push([...candidates]);
    }
  }
  return { resolved, missing };
}

function bibliographyKeys(context: WalkContext): Set<string> | null {
  const { resolved, missing } = bibliographyTargets(context);
  if (missing.length > 0) return null;
  const keys = new Set(context.bibitems);
  for (const path of resolved) for (const key of bibtexKeys(context.texts[path] ?? "")) keys.add(key);
  return keys;
}

export function missingLatexSources(mainDoc: string, texts: Readonly<Record<string, string>>): string[][] {
  const context = runWalk(mainDoc, texts, new Map());
  return [...context.missing, ...bibliographyTargets(context).missing];
}

function firstArgument(masked: string, command: RegExp): string | null {
  return allArguments(masked, new RegExp(command.source, "gu"))[0] ?? null;
}

function allArguments(masked: string, command: RegExp): string[] {
  const found: string[] = [];
  for (const match of masked.matchAll(command)) {
    const argument = commandArgument(masked, match.index + match[0].length);
    if (argument) found.push(argument.content);
  }
  return found;
}

function environmentBody(masked: string, names: readonly string[]): string | null {
  for (const name of names) {
    const match = new RegExp(String.raw`\\begin\s*\{${name}\}([\s\S]*?)\\end\s*\{${name}\}`, "u").exec(masked);
    if (match) return match[1];
  }
  return null;
}

function authorNames(block: string, macros: Macros): string[] {
  const blockNames = allArguments(block, /\\IEEEauthorblockN(?![A-Za-z@])/gu);
  const parts = blockNames.length > 0 ? blockNames : block.split(AUTHOR_SEPARATOR);
  const names: string[] = [];
  for (const part of parts) {
    const firstLine = dropCommands(part).split(/\\\\/u)[0];
    for (const name of latexPlainText(firstLine, macros).split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*;\s*/u)) {
      const trimmed = name.trim();
      if (trimmed) names.push(trimmed);
    }
  }
  return names;
}

function splitKeywords(source: string, macros: Macros): string[] {
  return source
    .split(KEYWORD_SEPARATOR)
    .map((keyword) => latexPlainText(keyword, macros).replace(/[.;,]+$/u, "").trim())
    .filter(Boolean);
}

function keywordLine(main: ScannedFile): string | null {
  const region = main.masked.slice(main.bodyFrom, main.bodyTo);
  const stop = /\\(?:part|chapter|section|input|include)(?![A-Za-z@])/u.exec(region);
  const front = stop ? region.slice(0, stop.index) : region;
  const marker = /(?:Index\s+Terms|Keywords|Key\s+words)\s*[:.—-]?\s*\}?\s*[:.—-]?/u.exec(front);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  let depth = 0;
  let index = start;
  for (; index < front.length; index += 1) {
    const char = front[index];
    if (char === "\\") {
      if (front[index + 1] === "\\" || /^\\(?:par|end)(?![A-Za-z@])/u.test(front.slice(index))) break;
      index += 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === "\n" && /^\n\s*\n/u.test(front.slice(index))) break;
  }
  return front.slice(start, index);
}

function readKeywords(files: readonly ScannedFile[], main: ScannedFile, macros: Macros): string[] {
  for (const file of files) {
    const command = firstArgument(file.masked, /\\(?:keywords|keyword)(?![A-Za-z@])/u);
    if (command !== null) return splitKeywords(command, macros);
    const body = environmentBody(file.masked, ["IEEEkeywords", "keywords", "keyword"]);
    if (body !== null) {
      const listed = allArguments(body, /\\kwd(?![A-Za-z@])/gu);
      return listed.length > 0 ? listed.map((keyword) => latexPlainText(keyword, macros)).filter(Boolean) : splitKeywords(body, macros);
    }
  }
  const line = keywordLine(main);
  return line === null ? [] : splitKeywords(line, macros);
}

function readAbstract(files: readonly ScannedFile[], macros: Macros): string | null {
  for (const file of files) {
    const body = environmentBody(file.masked, ["abstract"]) ?? firstArgument(file.masked, /\\abstract(?![A-Za-z@])/u);
    if (body === null) continue;
    const paragraphs = body
      .split(/\n\s*\n/u)
      .map((paragraph) => latexPlainText(paragraph, macros))
      .filter(Boolean);
    return paragraphs.length > 0 ? paragraphs.join("\n\n") : null;
  }
  return null;
}

function readMetadata(files: readonly ScannedFile[], macros: Macros): SubmissionMetadata {
  const metadata = emptyMetadata();
  const main = files[0];
  if (!main) return metadata;
  const title = firstArgument(main.masked, /\\title(?![A-Za-z@])/u);
  metadata.title = title === null ? null : latexPlainText(title, macros) || null;
  metadata.authors = allArguments(main.masked, /\\author(?![A-Za-z@])\*?/gu).flatMap((block) => authorNames(block, macros));
  const date = firstArgument(main.masked, /\\date(?![A-Za-z@])/u);
  metadata.date = date === null || /\\today(?![A-Za-z@])/u.test(date) ? null : latexPlainText(date, macros) || null;
  metadata.abstract = readAbstract(files, macros);
  metadata.keywords = readKeywords(files, main, macros);
  return metadata;
}

function locate(event: LocatedEvent): SourceLocation {
  return { path: event.file.path, ...event.file.locate(event.at) };
}

export function buildLatexInsights({ mainDoc, texts, numberFor = null }: LatexInsightsInput): DocumentInsightsBase {
  if (texts[mainDoc] === undefined) return emptyInsights();
  const macros = collectLatexOutlineMacros(texts);
  const context = runWalk(mainDoc, texts, macros);
  const insights = emptyInsights();
  const numbers = (label: string | null) => (label && numberFor ? numberFor(label) : null);
  const minimum = Math.min(
    ...context.events.flatMap((event) => (event.type === "heading" ? [event.base] : [])),
  );
  const labelKinds = new Map<string, InsightEntryKind>();
  const entry = (event: LocatedEvent & { label: string | null; text: string; numbered: boolean }, kind: InsightEntryKind, index: number, level: number | null): InsightEntry => {
    const resolved = numbers(event.label);
    if (event.label && !labelKinds.has(event.label)) labelKinds.set(event.label, kind);
    return {
      id: `${kind}-${index}`,
      kind,
      text: event.text,
      label: event.label,
      level,
      figureKind: kind === "figure" || kind === "table" ? kind : null,
      page: resolved?.page ?? null,
      number: resolved?.number ?? null,
      numbered: event.numbered,
      location: locate(event),
    };
  };
  const labelEvents: (LocatedEvent & LabelEvent)[] = [];
  const cites: { key: string; location: SourceLocation }[] = [];
  const todos: TodoEntry[] = [];
  let seenHeading = false;
  context.events.forEach((event, index) => {
    switch (event.type) {
      case "heading":
        seenHeading = true;
        insights.headings.push(
          entry({ ...event, text: event.title, numbered: !event.starred }, "heading", index, event.base - minimum + 1),
        );
        break;
      case "figure":
        insights.figures.push(entry(event, "figure", index, null));
        break;
      case "table":
        insights.tables.push(entry(event, "table", index, null));
        break;
      case "equation":
        insights.equations.push(entry(event, "equation", index, null));
        break;
      case "label":
        labelEvents.push({ ...event, kind: event.kind ?? (seenHeading ? "heading" : "other") });
        break;
      case "cite":
        for (const key of event.keys) cites.push({ key, location: locate(event) });
        break;
      case "todo":
        todos.push({ text: event.text, location: locate(event) });
        break;
    }
  });
  const seenLabels = new Set<string>();
  for (const label of labelEvents) {
    if (seenLabels.has(label.name)) continue;
    seenLabels.add(label.name);
    insights.labels.push({ name: label.name, kind: labelKinds.get(label.name) ?? label.kind ?? "other", location: locate(label) });
  }
  insights.citations = citationList(cites, bibliographyKeys(context));
  insights.todos = todos;
  insights.metadata = readMetadata(context.files, macros);
  return insights;
}
