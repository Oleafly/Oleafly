import { dirname } from "@/lib/path-utils";
import { parseTexMagicComments } from "@/lib/tex-magic-comments";
import { pathFoldKey } from "./source";
import type {
  LatexUnitFacts,
  LatexUnitInclude,
  LatexUnits,
} from "./types";

/**
 * Compilation units: which LaTeX files are typeset together.
 *
 * A folder can hold several documents side by side, such as `manuscript.tex`
 * next to `manuscript_v1.tex`. Their labels, environments, glossary entries
 * and macros must not collide, and a `\ref` must not reach into a document it
 * is never compiled with. A unit is an independent root (a document that no
 * other root reaches) plus everything it pulls in. A file no root reaches is
 * an orphan and keeps seeing the whole project, so a fragment that is not
 * included anywhere yet gets no false "undefined reference".
 *
 * Units only exist with two or more independent roots. One document always
 * gets `undefined`, which means every caller runs the same code it ran before
 * units existed. `crates/oleafly-core/src/context/units.rs` is the Rust twin;
 * `crates/oleafly-core/tests/fixtures/latex-units.json` holds both to the same
 * answers.
 */

const LATEX_SOURCE = /\.(?:tex|ltx|latex)$/i;
const LATEXDIFF_BANNER = "%DIF LATEXDIFF DIFFERENCE FILE";
const CONDITIONAL_BRANCH_ENDS = [String.raw`\fi`, String.raw`\else`, String.raw`\or`];
const ARGUMENT_WINDOW = 1024;
// Below this many owners per viewer unit, testing every owner beats walking
// one unit's owners.
const OWNER_SCAN_RATIO = 8;
// A deep chain of imports asks about folder pairs no file sits in.
const MAX_FOLDED_PATHS = 1 << 18;
// `\@input` is the kernel's quiet input, the classic way to read another
// document's .aux. `\input@path` is a macro, not a command of this kind, but
// `\if@twoside` is a conditional like any other.
const COMMAND = /\\(@input|if[A-Za-z@]*|[A-Za-z]+)(?![A-Za-z@])/g;

export const MAX_LATEX_UNIT_STEPS = 16_000_000;

const ONE_ARGUMENT_INCLUDES: ReadonlySet<string> = new Set([
  "input",
  "@input",
  "include",
  "subfile",
  "subfileinclude",
  "InputIfFileExists",
  "includestandalone",
  "loadglsentries",
]);

// `subfiles.sty` builds these on `\subimport` and `\subincludefrom`.
const SUBFILE_INCLUDES: ReadonlySet<string> = new Set([
  "subfile",
  "subfileinclude",
]);

// The value says whether the path starts from the enclosing import path.
const TWO_ARGUMENT_INCLUDES: ReadonlyMap<string, boolean> = new Map([
  ["import", false],
  ["inputfrom", false],
  ["includefrom", false],
  ["subimport", true],
  ["subinputfrom", true],
  ["subincludefrom", true],
]);

const PACKAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["usepackage", ".sty"],
  ["RequirePackage", ".sty"],
  ["RequirePackageWithOptions", ".sty"],
  ["documentclass", ".cls"],
  ["LoadClass", ".cls"],
  ["LoadClassWithOptions", ".cls"],
]);

/** Code point order, which is how Rust sorts the same strings. */
export function byCodePoint(left: string, right: string): number {
  const shared = Math.min(left.length, right.length);
  for (let at = 0; at < shared; at += 1) {
    const a = left.codePointAt(at) as number;
    const b = right.codePointAt(at) as number;
    if (a !== b) return a - b;
  }
  return left.length - right.length;
}

function skipBlanks(text: string, from: number, limit: number): number {
  let at = from;
  while (
    at < limit &&
    (text[at] === " " ||
      text[at] === "\t" ||
      text[at] === "\n" ||
      text[at] === "\r")
  ) {
    at += 1;
  }
  return at;
}

function indexWithin(
  text: string,
  character: string,
  from: number,
  limit: number,
): number {
  for (let at = from; at < limit; at += 1) {
    if (text[at] === character) return at;
  }
  return -1;
}

function isEscaped(text: string, at: number): boolean {
  let backslashes = 0;
  while (text[at - backslashes - 1] === "\\") backslashes += 1;
  return backslashes % 2 === 1;
}

interface Argument {
  /** Null when the group holds another group, so its value is unknown. */
  readonly value: string | null;
  readonly end: number;
}

function bracedArgument(text: string, from: number): Argument | null {
  const limit = Math.min(text.length, from + ARGUMENT_WINDOW);
  let at = skipBlanks(text, from, limit);
  if (text[at] === "*") at = skipBlanks(text, at + 1, limit);
  while (at < limit && text[at] === "[") {
    const close = indexWithin(text, "]", at, limit);
    if (close < 0) return null;
    at = skipBlanks(text, close + 1, limit);
  }
  if (at >= limit || text[at] !== "{") return null;
  for (let cursor = at + 1; cursor < limit; cursor += 1) {
    if (text[cursor] === "{") return { value: null, end: cursor };
    if (text[cursor] === "}") {
      return { value: text.slice(at + 1, cursor).trim(), end: cursor + 1 };
    }
  }
  return null;
}

function bareArgument(text: string, from: number): string | null {
  const limit = Math.min(text.length, from + ARGUMENT_WINDOW);
  const start = skipBlanks(text, from, limit);
  let end = start;
  let quoted = false;
  while (end < limit && (quoted || !/[\s}\\%{]/.test(text[end]))) {
    if (text[end] === '"') quoted = !quoted;
    end += 1;
  }
  if (quoted || text.slice(start, end) === '""') return null;
  // A surrogate pair that does not fit in the window stays out.
  if (end === limit && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  return end > start ? text.slice(start, end) : null;
}

/**
 * A command whose path is computed at compile time: `\input\chapter`, or the
 * output of `\input|"script"` under shell escape.
 */
function startsWithDynamicToken(text: string, from: number): boolean {
  const at = skipBlanks(text, from, Math.min(text.length, from + ARGUMENT_WINDOW));
  return text[at] === "\\" || text[at] === "#" || text[at] === "|";
}

function isDynamicTarget(value: string): boolean {
  return value.includes("\\") || value.includes("#") || /^["']?\|/.test(value);
}

interface DocumentClass {
  readonly option: string;
  readonly name: string;
}

function classArguments(text: string, from: number): DocumentClass | null {
  const limit = Math.min(text.length, from + ARGUMENT_WINDOW);
  let at = skipBlanks(text, from, limit);
  let option = "";
  if (text[at] === "[") {
    const close = indexWithin(text, "]", at, limit);
    if (close < 0) return null;
    option = text.slice(at + 1, close).trim();
    at = skipBlanks(text, close + 1, limit);
  }
  if (at >= limit || text[at] !== "{") return null;
  const close = indexWithin(text, "}", at, limit);
  if (close < 0) return null;
  const name = text.slice(at + 1, close).trim();
  return name ? { option, name } : null;
}

function packageFiles(value: string, extension: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !isDynamicTarget(name))
    .map((name) => `${name}${extension}`);
}

interface FactScan {
  readonly includes: LatexUnitInclude[];
  readonly packages: Set<string>;
  open: boolean;
  /** A path computed at compile time. A class or package keeps those to itself. */
  dynamic: boolean;
  beginsDocument: boolean;
  /** Brace depth at `depthFrom`, counted only when a stop asks. */
  depth: number;
  depthFrom: number;
  /** `\if...` seen and not yet closed. `\newif\ifdraft` counts, towards more files. */
  conditionals: number;
  /** Where the last braced include closed. */
  includeEnd: number;
  documentClass: DocumentClass | null;
}

type IncludeKind = Pick<LatexUnitInclude, "local" | "folder">;

function subfileKind(value: string | null): IncludeKind {
  const folder = value === null ? "" : value.slice(0, value.lastIndexOf("/") + 1);
  return { local: true, folder };
}

function addTarget(
  scan: FactScan,
  value: string | null,
  kind?: IncludeKind,
): void {
  if (value === null || isDynamicTarget(value)) {
    scan.dynamic = true;
  } else if (/\.aux["']?$/i.test(value)) {
    scan.open = true;
  } else if (value) {
    scan.includes.push({ raw: value, ...kind });
  }
}

function scanOneArgumentInclude(
  scan: FactScan,
  masked: string,
  name: string,
  after: number,
): void {
  const argument = bracedArgument(masked, after);
  if (argument) {
    scan.includeEnd = argument.end;
    addTarget(
      scan,
      argument.value,
      SUBFILE_INCLUDES.has(name) ? subfileKind(argument.value) : undefined,
    );
  } else if (startsWithDynamicToken(masked, after)) {
    scan.dynamic = true;
  } else if (name === "input") {
    const bare = bareArgument(masked, after);
    if (bare) addTarget(scan, bare);
  }
}

// TeX drops every double quote from a file name, wherever it sits.
function unquoted(value: string): string {
  return value.trim().replaceAll('"', "");
}

function scanTwoArgumentInclude(
  scan: FactScan,
  masked: string,
  after: number,
  local: boolean,
): void {
  const directory = bracedArgument(masked, after);
  const target = directory && bracedArgument(masked, directory.end);
  if (target) scan.includeEnd = target.end;
  if (!directory || !target) {
    if (startsWithDynamicToken(masked, after)) scan.dynamic = true;
  } else if (directory.value === null || target.value === null) {
    scan.dynamic = true;
  } else {
    const folder = unquoted(directory.value).replace(/\/+$/, "");
    const file = unquoted(target.value);
    addTarget(
      scan,
      folder ? `${folder}/${file}` : file,
      local ? { local: true, folder } : { folder },
    );
  }
}

function namesDocument(text: string, after: number): boolean {
  return text.startsWith("{document}", skipBlanks(text, after, text.length));
}

function isCommandAt(text: string, at: number, command: string): boolean {
  return (
    text.startsWith(command, at) &&
    !/[A-Za-z]/.test(text[at + command.length] ?? "")
  );
}

function braceDepth(text: string, from: number, to: number, start: number): number {
  let depth = start;
  let at = from;
  while (at < to) {
    if (text[at] === "\\") at += 1;
    else if (text[at] === "{") depth += 1;
    else if (text[at] === "}") depth -= 1;
    at += 1;
  }
  return depth;
}

/**
 * TeX stops here, unless a conditional skips this branch. The scan cannot tell
 * a taken branch from a skipped one, so a close on the same line keeps it
 * reading, as does a close within the window once a conditional is open. Both
 * err towards more files.
 */
function endsDocument(text: string, after: number, inConditional: boolean): boolean {
  if (!namesDocument(text, after)) return false;
  const close = text.indexOf("}", after) + 1;
  const next = skipBlanks(text, close, text.length);
  const limit = Math.min(text.length, next + ARGUMENT_WINDOW);
  for (let at = next; at < limit && (inConditional || text[at] !== "\n"); at += 1) {
    if (text[at] !== "\\") continue;
    if (CONDITIONAL_BRANCH_ENDS.some((command) => isCommandAt(text, at, command))) {
      return false;
    }
    at += 1;
  }
  return true;
}

function scanDocumentClass(
  scan: FactScan,
  masked: string,
  name: string,
  after: number,
): void {
  if (scan.documentClass) return;
  scan.documentClass = classArguments(masked, after);
  if (name !== "documentstyle" || !scan.documentClass) return;
  // LaTeX 2.09 loads every option as a style file, and the style itself as a
  // class, or as a style file if there is no such class. Keeping both spellings
  // errs towards more files.
  const { option, name: style } = scan.documentClass;
  for (const file of [
    ...packageFiles(`${option},${style}`, ".sty"),
    ...packageFiles(style, ".cls"),
  ]) {
    scan.packages.add(file);
  }
}

function scanCommand(
  scan: FactScan,
  masked: string,
  name: string,
  after: number,
): void {
  if (name === "externaldocument") {
    scan.open = true;
    return;
  }
  if (name === "documentclass" || name === "documentstyle") {
    scanDocumentClass(scan, masked, name, after);
  }
  const extension = PACKAGE_EXTENSIONS.get(name);
  const local = TWO_ARGUMENT_INCLUDES.get(name);
  if (extension) {
    const value = bracedArgument(masked, after)?.value ?? "";
    for (const file of packageFiles(value, extension)) scan.packages.add(file);
  } else if (ONE_ARGUMENT_INCLUDES.has(name)) {
    scanOneArgumentInclude(scan, masked, name, after);
  } else if (local !== undefined) {
    scanTwoArgumentInclude(scan, masked, after, local);
  }
}

/** Whether the document ends at this `\end`: outside any braces, as TeX sees. */
function closesDocument(
  scan: FactScan,
  masked: string,
  at: number,
  after: number,
): boolean {
  if (!endsDocument(masked, after, scan.conditionals > 0)) return false;
  return outsideBraces(scan, masked, at);
}

function outsideBraces(scan: FactScan, masked: string, at: number): boolean {
  scan.depth = braceDepth(masked, scan.depthFrom, at, scan.depth);
  scan.depthFrom = at;
  return scan.depth <= 0;
}

/**
 * `\let\stop\endinput` and `\newcommand{\stop}\endinput` only name the command,
 * so neither stops anything. The closing brace of an include is the one brace
 * that is known to end a statement.
 */
function startsStatement(text: string, at: number, includeEnd: number): boolean {
  let before = at - 1;
  while (text[before] === " " || text[before] === "\t") before -= 1;
  return before < 0 || text[before] === "\n" || before + 1 === includeEnd;
}

function endsLine(text: string, from: number): boolean {
  let at = from;
  while (text[at] === " " || text[at] === "\t" || text[at] === "\r") at += 1;
  return at >= text.length || text[at] === "\n";
}

/**
 * Whether TeX stops reading the file here. Inside a conditional or braces it may
 * never run, and an `\input` later on its line takes the stop with it, so the
 * scan keeps reading, which errs towards more files.
 */
function endsInput(scan: FactScan, masked: string, at: number, after: number): boolean {
  return (
    scan.conditionals === 0 &&
    startsStatement(masked, at, scan.includeEnd) &&
    endsLine(masked, after) &&
    outsideBraces(scan, masked, at)
  );
}

function scanCommands(scan: FactScan, masked: string): void {
  for (const match of masked.matchAll(COMMAND)) {
    if (isEscaped(masked, match.index)) continue;
    const name = match[1];
    const after = match.index + match[0].length;
    if (name === "fi") scan.conditionals = Math.max(scan.conditionals - 1, 0);
    else if (name.startsWith("if")) scan.conditionals += 1;
    if (name === "endinput") {
      if (endsInput(scan, masked, match.index, after)) return;
    } else if (name === "begin") {
      scan.beginsDocument ||= namesDocument(masked, after);
    } else if (name !== "end" || !scan.beginsDocument) {
      scanCommand(scan, masked, name, after);
    } else if (closesDocument(scan, masked, match.index, after)) {
      return;
    }
  }
}

/**
 * What one LaTeX file contributes to the unit graph. `masked` has comments and
 * verbatim text blanked out; the magic comment and the latexdiff banner are
 * comments, so those two read `source`.
 */
export function latexUnitFacts(
  file: string,
  source: string,
  masked: string,
): LatexUnitFacts | undefined {
  const scan: FactScan = {
    includes: [],
    packages: new Set(),
    open: source.includes(LATEXDIFF_BANNER),
    dynamic: false,
    beginsDocument: false,
    depth: 0,
    depthFrom: 0,
    conditionals: 0,
    includeEnd: -1,
    documentClass: null,
  };
  scanCommands(scan, masked);

  const { documentClass, includes, packages } = scan;
  const subfiles = documentClass?.name === "subfiles";
  const latexSource = LATEX_SOURCE.test(file);
  const document = latexSource && (documentClass ? !subfiles : scan.beginsDocument);
  // A class settles it. A bare `\begin{document}` can be a mention in prose,
  // so a file that names its root keeps the fact and the walk decides.
  const magicRoot =
    subfiles || (latexSource && documentClass)
      ? null
      : parseTexMagicComments(source).root;
  const open = scan.open || (scan.dynamic && latexSource);

  const facts: LatexUnitFacts = {
    ...(document ? { document: true as const } : {}),
    ...(subfiles ? { subfilesParent: documentClass?.option ?? "" } : {}),
    ...(magicRoot ? { magicRoot } : {}),
    ...(includes.length > 0 ? { includes } : {}),
    ...(packages.size > 0 ? { packages: [...packages] } : {}),
    ...(open ? { open: true as const } : {}),
  };
  return Object.keys(facts).length > 0 ? facts : undefined;
}

/** A relative path. `rest` is empty when it names a folder above. */
interface ParsedTarget {
  readonly ups: number;
  readonly rest: string;
}

const HERE: ParsedTarget = { ups: 0, rest: "" };

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function parsePath(raw: string): ParsedTarget | null {
  const value = unquoted(raw).replace(/^'|'$/g, "");
  if (
    /^[#/]/.test(value) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /^[a-z]:[\\/]/i.test(value) ||
    hasControlCharacter(value)
  ) {
    return null;
  }
  const parts: string[] = [];
  let ups = 0;
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length > 0) parts.pop();
    else ups += 1;
  }
  return { ups, rest: parts.join("/") };
}

function parseTarget(raw: string): ParsedTarget | null {
  const path = parsePath(raw);
  return path?.rest ? path : null;
}

function joinPaths(base: ParsedTarget, path: ParsedTarget): ParsedTarget {
  let { ups, rest } = base;
  for (let up = 0; up < path.ups; up += 1) {
    if (rest) rest = rest.slice(0, Math.max(0, rest.lastIndexOf("/")));
    else ups += 1;
  }
  if (!path.rest) return { ups, rest };
  return { ups, rest: rest ? `${rest}/${path.rest}` : path.rest };
}

/** `folder` as a path from `root`, both from the project root. */
function pathWithin(root: string, folder: string): ParsedTarget {
  const from = root ? root.split("/") : [];
  const to = folder ? folder.split("/") : [];
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  return { ups: from.length - shared, rest: to.slice(shared).join("/") };
}

/** The folder `path` names from `root`. Null above the project. */
function folderAt(root: string, path: ParsedTarget): string | null {
  let folder = root;
  for (let up = 0; up < path.ups; up += 1) {
    if (!folder) return null;
    folder = dirname(folder);
  }
  if (!path.rest) return folder;
  return folder ? `${folder}/${path.rest}` : path.rest;
}

function inputSpellings(rest: string): readonly string[] {
  // kpathsea takes a name with one of these suffixes as written.
  if (/\.(?:tex|sty|cls|def|fd|bbl|clo|ldf|aux)$/i.test(rest)) {
    return [rest, `${rest}.tex`];
  }
  // TeX opens name.tex, then name. The editor also lists .ltx and .latex files
  // as sources, which TeX only finds under their full name.
  return /\.[a-z0-9]+$/i.test(rest)
    ? [`${rest}.tex`, rest]
    : [`${rest}.tex`, rest, `${rest}.ltx`, `${rest}.latex`];
}

/** One `\\import` or `\\subfile` around a file, the newest first. */
interface ImportFrame {
  /** The import path, from the root's folder. */
  readonly path: ParsedTarget;
  readonly outer: ImportFrame | null;
}

function folderAbove(path: string, depth: number): string {
  let folder = path;
  for (let step = 0; step < depth; step += 1) folder = dirname(folder);
  return folder;
}

/** The best file for a path, per folder. */
class FolderChoice {
  private readonly best = new Map<string, { path: string; rank: number }>();

  get size(): number {
    return this.best.size;
  }

  offer(folder: string, path: string, rank: number, spelling: string): void {
    const best = this.best.get(folder);
    if (best && (best.rank < rank || !prefersSpelling(path, best.path, spelling))) {
      return;
    }
    this.best.set(folder, { path, rank });
  }

  get(folder: string): string | undefined {
    return this.best.get(folder)?.path;
  }
}

interface FolderTable {
  /** By the folder as spelled on disk, which tells `Paper/` from `paper/`. */
  readonly exact: FolderChoice;
  readonly folded: FolderChoice;
}

/**
 * Include lookup for one project. A target's folder depends on the root that
 * reaches it, so a walk asks "does this path exist under that folder" once per
 * root. Each answer is one Map read here: the first question about a path
 * finds every folder that holds it, and the rest look the folder up.
 */
class IncludeResolver {
  private readonly byLeaf = new Map<string, string[]>();
  private readonly tables = new Map<string, FolderTable>();
  private readonly parsed = new Map<string, ParsedTarget | null>();
  private readonly folded = new Map<string, string>();
  /** What the lookups cost, which the walk's step budget counts. */
  work = 0;

  constructor(known: Iterable<string>) {
    for (const path of known) {
      const fold = this.fold(path);
      const leaf = fold.slice(fold.lastIndexOf("/") + 1);
      const paths = this.byLeaf.get(leaf);
      if (paths) paths.push(path);
      else this.byLeaf.set(leaf, [path]);
    }
  }

  private fold(path: string): string {
    let fold = this.folded.get(path);
    if (fold === undefined) {
      fold = pathFoldKey(path);
      if (this.folded.size < MAX_FOLDED_PATHS) this.folded.set(path, fold);
    }
    return fold;
  }

  private table(rest: string): FolderTable {
    const cached = this.tables.get(rest);
    if (cached) return cached;
    const table = { exact: new FolderChoice(), folded: new FolderChoice() };
    const depth = rest.split("/").length;
    inputSpellings(rest).forEach((spelling, rank) => {
      const fold = this.fold(spelling);
      const leaf = fold.slice(fold.lastIndexOf("/") + 1);
      const paths = this.byLeaf.get(leaf) ?? [];
      this.work += paths.length;
      for (const path of paths) {
        const candidate = this.fold(path);
        if (candidate !== fold && !candidate.endsWith(`/${fold}`)) continue;
        const folder = candidate.slice(0, Math.max(0, candidate.length - fold.length - 1));
        table.folded.offer(folder, path, rank, spelling);
        table.exact.offer(folderAbove(path, depth), path, rank, spelling);
      }
    });
    this.tables.set(rest, table);
    return table;
  }

  private target(raw: string): ParsedTarget | null {
    if (this.parsed.has(raw)) return this.parsed.get(raw) ?? null;
    const target = parseTarget(raw);
    this.parsed.set(raw, target);
    return target;
  }

  private lookup(folder: string, target: ParsedTarget): string | null {
    this.work += 1 + target.ups;
    let base = folder;
    for (let up = 0; up < target.ups; up += 1) {
      if (!base) return null;
      base = dirname(base);
    }
    const table = this.table(target.rest);
    const found = table.exact.get(base);
    if (found !== undefined || table.folded.size === 0) return found ?? null;
    return table.folded.get(this.fold(base)) ?? null;
  }

  private lookupAt(
    rootFolder: string,
    path: ParsedTarget,
    target: ParsedTarget,
  ): string | null {
    this.work += 1;
    const folder = folderAt(rootFolder, path);
    return folder === null ? null : this.lookup(folder, target);
  }

  /**
   * The import path inside this include. `import.sty` keeps every enclosing
   * path on TeX's search path, and `\\import` starts a new one where
   * `\\subimport` and `\\subfile` extend the current one.
   */
  importsInside(
    include: LatexUnitInclude,
    imports: ImportFrame | null,
  ): ImportFrame | null {
    const folder = include.folder === undefined ? null : parsePath(include.folder);
    if (!folder) return imports;
    const start = include.local ? (imports?.path ?? HERE) : HERE;
    return { path: joinPaths(start, folder), outer: imports };
  }

  /**
   * What TeX opens, which pdflatex settles because the search runs twice. The
   * first finds the name from the root's folder or an import path, and the
   * second searches the import paths again for the name it found.
   */
  private onSearchPath(
    rootFolder: string,
    start: ParsedTarget,
    target: ParsedTarget,
    imports: ImportFrame | null,
  ): string | null {
    let written = start;
    let found = this.lookupAt(rootFolder, written, target);
    for (let frame = imports; found === null && frame !== null; frame = frame.outer) {
      written = joinPaths(frame.path, start);
      found = this.lookupAt(rootFolder, written, target);
    }
    if (found === null) return null;
    for (let frame = imports; frame !== null; frame = frame.outer) {
      const deeper = this.lookupAt(rootFolder, joinPaths(frame.path, written), target);
      if (deeper !== null) return deeper;
    }
    return found;
  }

  /**
   * The file an include opens when TeX compiles from `folders.compile`, then,
   * for a project TeX cannot compile yet, the project root, the root's own
   * folder and the including file's folder.
   */
  resolve(
    include: LatexUnitInclude,
    folders: RootFolders,
    fromFolder: string,
    imports: ImportFrame | null,
  ): string | null {
    const target = this.target(include.raw);
    if (!target) return null;
    const start = include.local ? (imports?.path ?? HERE) : HERE;
    const inside = this.importsInside(include, imports);
    const found = this.onSearchPath(folders.compile, start, target, inside);
    if (found !== null) return found;
    const fallbacks = include.local
      ? [fromFolder, folders.compile, "", folders.own]
      : ["", folders.own, fromFolder];
    for (const folder of fallbacks) {
      const fallback = this.lookup(folder, target);
      if (fallback !== null) return fallback;
    }
    return null;
  }

  /** The file a subfiles option or magic comment names. */
  resolveParent(raw: string, fromFolder: string): string | null {
    const target = this.target(raw);
    if (!target) return null;
    return this.lookup(fromFolder, target) ?? this.lookup("", target);
  }

  /** Whether the path exists in some other folder of the project. */
  existsElsewhere(raw: string): boolean {
    const target = this.target(raw);
    return target !== null && this.table(target.rest).folded.size > 0;
  }
}

function prefersSpelling(path: string, best: string, spelling: string): boolean {
  const exact = path === spelling || path.endsWith(`/${spelling}`);
  const bestExact = best === spelling || best.endsWith(`/${spelling}`);
  if (exact !== bestExact) return exact;
  return byCodePoint(path, best) < 0;
}

export interface LatexUnitsInput {
  /** Facts by project path; a file with no entry contributes nothing. */
  readonly facts: ReadonlyMap<string, LatexUnitFacts>;
  /** Files whose text was analysed. */
  readonly read: ReadonlySet<string>;
  /** Every path in the project, read or not. */
  readonly known: Iterable<string>;
  readonly mainDocument?: string;
  /** The folder TeX runs in when it is not the project root. */
  readonly compileFolder?: string;
  readonly maxSteps?: number;
}

interface Walked {
  readonly files: readonly string[];
  readonly open: boolean;
}

function declaredParent(facts: LatexUnitFacts | undefined): string | undefined {
  return facts?.subfilesParent ?? facts?.magicRoot;
}

interface RootCandidates {
  readonly candidates: ReadonlySet<string>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly resolver: IncludeResolver;
}

function isReadSource(input: LatexUnitsInput, file: string): boolean {
  return input.read.has(file) && LATEX_SOURCE.test(file);
}

function collectRoots(input: LatexUnitsInput): {
  candidates: Set<string>;
  declared: [string, string][];
} {
  const { facts, read, mainDocument } = input;
  const candidates = new Set<string>();
  const declared: [string, string][] = [];
  for (const [file, fileFacts] of facts) {
    if (!read.has(file)) continue;
    const parent = declaredParent(fileFacts);
    if (parent !== undefined) declared.push([file, parent]);
    else if (fileFacts.document) candidates.add(file);
  }
  if (
    mainDocument &&
    isReadSource(input, mainDocument) &&
    facts.get(mainDocument)?.subfilesParent === undefined
  ) {
    candidates.add(mainDocument);
  }
  declared.sort(([left], [right]) => byCodePoint(left, right));
  return { candidates, declared };
}

/** Hangs each declaring file off its parent, and returns the parents' children. */
function attachDeclared(
  input: LatexUnitsInput,
  declared: readonly (readonly [string, string])[],
  candidates: Set<string>,
  resolver: IncludeResolver,
): Map<string, string[]> {
  const { facts } = input;
  const children = new Map<string, string[]>();
  for (const [file, raw] of declared) {
    const parent = resolver.resolveParent(raw, dirname(file));
    if (parent === null || parent === file || !isReadSource(input, parent)) {
      if (facts.get(file)?.document) candidates.add(file);
      continue;
    }
    addTo(children, parent, file);
    if (declaredParent(facts.get(parent)) === undefined) candidates.add(parent);
  }
  return children;
}

function rootCandidates(input: LatexUnitsInput): RootCandidates | null {
  const { candidates, declared } = collectRoots(input);
  if (candidates.size < 2 && declared.length === 0) return null;
  const resolver = new IncludeResolver(input.known);
  const children = attachDeclared(input, declared, candidates, resolver);
  return candidates.size < 2 ? null : { candidates, children, resolver };
}

/** Where TeX compiles a root, and the root's own folder. */
interface RootFolders {
  readonly compile: string;
  readonly own: string;
}

/**
 * The project's compile folder holds only the documents inside it. Any other
 * document compiles from the project root.
 */
function rootFolders(root: string, compileFolder: string): RootFolders {
  const inside = compileFolder !== "" && root.startsWith(`${compileFolder}/`);
  return { compile: inside ? compileFolder : "", own: dirname(root) };
}

/**
 * Where an `\\input` or a figure in `file` is looked for, in order. TeX searches
 * the folder it compiles in and then the project root. The main document's
 * folder and the including file's folder are for a project TeX cannot compile
 * yet, so a link still opens the file the author meant.
 */
export function latexSearchFolders(
  compileFolder: string,
  mainDocument: string,
  file: string,
): string[] {
  return [...new Set([compileFolder, "", dirname(mainDocument), dirname(file)])];
}

interface WalkStep {
  readonly file: string;
  readonly imports: ImportFrame | null;
}

class UnitWalker {
  private readonly lastWalk = new Map<string, number>();
  private walkId = 0;
  private steps = 0;

  constructor(
    private readonly input: LatexUnitsInput,
    private readonly graph: RootCandidates,
    private readonly maxSteps: number,
  ) {}

  /** Null once the project has used up the step budget. */
  walk(root: string): Walked | null {
    this.walkId += 1;
    const folders = rootFolders(root, this.input.compileFolder ?? "");
    const files: string[] = [];
    const stack: WalkStep[] = [];
    const declared: WalkStep[] = [];
    this.enter(root, null, stack);
    let open = false;
    for (
      let step = this.next(stack, declared);
      step !== undefined;
      step = this.next(stack, declared)
    ) {
      files.push(step.file);
      if (this.visit(step, folders, stack, declared)) open = true;
      this.steps += 1;
      if (this.exhausted()) return null;
    }
    return { files, open };
  }

  /**
   * A file reached by an include takes the search path of that include, as TeX
   * sees it. A declared link only counts for a file no include reaches.
   */
  private next(stack: WalkStep[], declared: WalkStep[]): WalkStep | undefined {
    while (stack.length === 0 && declared.length > 0) {
      const step = declared.pop() as WalkStep;
      this.enter(step.file, step.imports, stack);
    }
    return stack.pop();
  }

  private exhausted(): boolean {
    return this.steps + this.graph.resolver.work > this.maxSteps;
  }

  private enter(
    file: string,
    imports: ImportFrame | null,
    stack: WalkStep[],
  ): void {
    if (this.lastWalk.get(file) === this.walkId) return;
    this.lastWalk.set(file, this.walkId);
    stack.push({ file, imports });
  }

  private declareChildren(
    file: string,
    imports: ImportFrame | null,
    folders: RootFolders,
    declared: WalkStep[],
  ): void {
    for (const child of this.graph.children.get(file) ?? []) {
      const subfile = this.input.facts.get(child)?.subfilesParent !== undefined;
      const frame = { path: pathWithin(folders.compile, dirname(child)), outer: imports };
      declared.push({ file: child, imports: subfile ? frame : imports });
    }
  }

  /** Queues what a file pulls in, and says whether it opens the unit. */
  private visit(
    { file, imports }: WalkStep,
    folders: RootFolders,
    stack: WalkStep[],
    declared: WalkStep[],
  ): boolean {
    const { read } = this.input;
    const { resolver } = this.graph;
    const facts = this.input.facts.get(file);
    const fromFolder = dirname(file);
    let open = facts?.open === true;
    this.declareChildren(file, imports, folders, declared);
    for (const include of facts?.includes ?? []) {
      this.steps += 1;
      if (this.exhausted()) return open;
      const target = resolver.resolve(include, folders, fromFolder, imports);
      if (target === null) {
        open = resolver.existsElsewhere(include.raw) || open;
      } else if (read.has(target)) {
        this.enter(target, resolver.importsInside(include, imports), stack);
      } else {
        open = true;
      }
    }
    for (const raw of facts?.packages ?? []) {
      this.steps += 1;
      if (this.exhausted()) return open;
      const target = resolver.resolve({ raw }, folders, fromFolder, imports);
      if (target !== null && read.has(target)) this.enter(target, imports, stack);
    }
    return open;
  }
}

function independentRoots(
  candidates: ReadonlySet<string>,
  walker: UnitWalker,
): Map<string, Walked> | null {
  const kept = new Map<string, Walked>();
  const covered = new Set<string>();
  for (const root of [...candidates].sort(byCodePoint)) {
    if (covered.has(root)) continue;
    const walked = walker.walk(root);
    if (!walked) return null;
    for (const file of walked.files) {
      if (file === root || !candidates.has(file)) continue;
      covered.add(file);
      kept.delete(file);
    }
    kept.set(root, walked);
  }
  return kept;
}

function unitsFromWalks(kept: ReadonlyMap<string, Walked>): LatexUnits {
  const unitsOf = new Map<string, number[]>();
  const openUnits: number[] = [];
  let unit = 0;
  for (const walked of kept.values()) {
    if (walked.open) openUnits.push(unit);
    for (const file of walked.files) {
      const units = unitsOf.get(file);
      if (units) units.push(unit);
      else unitsOf.set(file, [unit]);
    }
    unit += 1;
  }

  const groups: (readonly number[])[] = [];
  const groupIds = new Map<string, number>();
  const fileGroups: Record<string, number> = {};
  for (const file of [...unitsOf.keys()].sort(byCodePoint)) {
    const units = unitsOf.get(file) ?? [];
    const key = units.join(",");
    let group = groupIds.get(key);
    if (group === undefined) {
      group = groups.length;
      groups.push(units);
      groupIds.set(key, group);
    }
    fileGroups[file] = group;
  }
  return { roots: [...kept.keys()], groups, fileGroups, openUnits };
}

/** Undefined means one document, so the project-wide pool stays right. */
export function buildLatexUnits(input: LatexUnitsInput): LatexUnits | undefined {
  const graph = rootCandidates(input);
  if (!graph) return undefined;
  const walker = new UnitWalker(input, graph, input.maxSteps ?? MAX_LATEX_UNIT_STEPS);
  const kept = independentRoots(graph.candidates, walker);
  return kept && kept.size > 1 ? unitsFromWalks(kept) : undefined;
}

/**
 * Which tier of the fallback chain answered a lookup. `unit`: definitions
 * compiled with the viewer. `orphans`: a fragment nothing includes yet.
 * `open`: the viewer's unit may pull in files the graph cannot see. `all`: the
 * viewer is an orphan. `none`: nothing, a real unresolved name.
 */
export type LatexUnitTier = "unit" | "orphans" | "open" | "all" | "none";

export interface LatexUnitSelection<T> {
  readonly items: readonly T[];
  readonly tier: LatexUnitTier;
}

export interface LatexRenameClosure<D, U> {
  readonly defs: readonly D[];
  readonly uses: readonly U[];
}

export interface LatexRenameInput<D, U> {
  readonly definition: D;
  readonly pool: readonly D[];
  readonly uses: readonly U[];
  readonly definitionFile: (definition: D) => string;
  readonly fileOfUse: (use: U) => string;
  readonly citation?: boolean;
  /** The definition a use sits on, such as the name in `\\renewcommand`. */
  readonly definitionAt?: (use: U) => D | undefined;
  /**
   * Every definition a compile sees is one name, as with an environment and its
   * `\\renewenvironment`. Leaving one behind stops that compile.
   */
  readonly together?: boolean;
}

export interface LatexUnitScope {
  /** Same unit, or both outside every unit. */
  sharesScope(left: string, right: string): boolean;
  /** Same unit, or either file outside every unit. */
  connected(left: string, right: string): boolean;
  /** Whether a completion or link from `viewer` may name `file`. */
  reaches(viewer: string, file: string): boolean;
  select<T>(
    viewer: string,
    pool: readonly T[],
    fileOf: (item: T) => string,
    citation?: boolean,
  ): LatexUnitSelection<T>;
  /** The definitions this one really collides with, itself included. */
  peers<T>(
    file: string,
    pool: readonly T[],
    fileOf: (item: T) => string,
  ): readonly T[];
  /** Whether two candidates of a use collide where the viewer can see them. */
  isAmbiguous<T>(
    viewer: string,
    candidates: readonly T[],
    fileOf: (item: T) => string,
  ): boolean;
  /** One row per unit (then the orphans) holding two or more of `files`. */
  duplicateRows(files: readonly string[]): string[][];
  renameClosure<D, U>(input: LatexRenameInput<D, U>): LatexRenameClosure<D, U>;
}

interface PoolIndex<T> {
  readonly byUnit: ReadonlyMap<number, readonly number[]>;
  /** Definitions in files shared by several units, by the files' group. */
  readonly shared: ReadonlyMap<number, readonly number[]>;
  readonly orphans: readonly T[];
  readonly inGroup: Map<number, readonly T[]>;
  ownersByUnit?: ReadonlyMap<number, readonly number[]>;
}

const NOTHING: readonly never[] = [];

function hasUnit(units: readonly number[], unit: number): boolean {
  let low = 0;
  let high = units.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (units[middle] === unit) return true;
    if (units[middle] < unit) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function appendAll(target: number[], values: readonly number[]): void {
  for (const value of values) target.push(value);
}

function addTo<K, V>(lists: Map<K, V[]>, key: K, value: V): void {
  const list = lists.get(key);
  if (list) list.push(value);
  else lists.set(key, [value]);
}

function unitBitsOf(units: LatexUnits): ReadonlyMap<number, Uint32Array> {
  const words = (units.roots.length >>> 5) + 1;
  const bits = new Map<number, Uint32Array>();
  units.groups.forEach((group, id) => {
    if (group.length < 2) return;
    const row = new Uint32Array(words);
    for (const unit of group) row[unit >>> 5] |= 1 << (unit & 31);
    bits.set(id, row);
  });
  return bits;
}

/**
 * Follows a rename across units until nothing new is reached. Each unit is
 * settled once and covered once, so overlapping units cost what they hold
 * rather than one pass per unit.
 */
class RenameSpread<D> {
  readonly taken = new Set<number>();
  private readonly settled = new Set<number>();
  private readonly covered = new Set<number>();
  private readonly queue: D[];

  constructor(
    private readonly groups: readonly (readonly number[])[],
    private readonly definitions: ReadonlyMap<number, readonly D[]>,
    private readonly waiting: ReadonlyMap<number, readonly number[]>,
    private readonly selected: Set<D>,
    private readonly together: boolean,
  ) {
    this.queue = [...selected];
  }

  run(unitsOf: (item: D) => readonly number[]): void {
    for (let item = this.queue.pop(); item !== undefined; item = this.queue.pop()) {
      for (const unit of unitsOf(item)) this.settle(unit);
    }
  }

  private settle(unit: number): void {
    if (this.settled.has(unit)) return;
    this.settled.add(unit);
    if (this.together) {
      for (const item of this.definitions.get(unit) ?? NOTHING) this.select(item);
    }
    for (const group of this.waiting.get(unit) ?? NOTHING) this.take(group);
  }

  private take(group: number): void {
    if (this.taken.has(group)) return;
    this.taken.add(group);
    for (const unit of this.groups[group]) this.cover(unit);
  }

  /** A unit with a matching definition must rename one, or its uses dangle. */
  private cover(unit: number): void {
    if (this.covered.has(unit)) return;
    this.covered.add(unit);
    const definitions = this.definitions.get(unit);
    if (!definitions || definitions.some((item) => this.selected.has(item))) return;
    this.select(definitions[0]);
  }

  private select(item: D): void {
    if (this.selected.has(item)) return;
    this.selected.add(item);
    this.queue.push(item);
  }
}

/** Another definition sitting in a holder renames with it, or its uses dangle. */
function selectInHolders<D, U>(
  { pool, definitionFile, fileOfUse, definitionAt, together }: LatexRenameInput<D, U>,
  loose: readonly U[],
  holders: ReadonlySet<string>,
  selected: Set<D>,
): void {
  for (const use of loose) {
    const site = holders.has(fileOfUse(use)) ? definitionAt?.(use) : undefined;
    if (site !== undefined) selected.add(site);
  }
  if (!together) return;
  for (const item of pool) {
    if (holders.has(definitionFile(item))) selected.add(item);
  }
}

class UnitScope implements LatexUnitScope {
  private readonly groupOf: ReadonlyMap<string, number>;
  private readonly groups: readonly (readonly number[])[];
  private readonly openGroups: readonly boolean[];
  /** Units as a bit set, for groups of more than one unit. */
  private readonly unitBits: ReadonlyMap<number, Uint32Array>;
  private readonly pools = new WeakMap<object, PoolIndex<unknown>>();

  constructor(units: LatexUnits) {
    this.groupOf = new Map(Object.entries(units.fileGroups));
    this.groups = units.groups;
    const open = new Set(units.openUnits);
    this.openGroups = units.groups.map((group) =>
      group.some((unit) => open.has(unit)),
    );
    this.unitBits = unitBitsOf(units);
  }

  private overlap(left: number, right: number): boolean {
    if (left === right) return true;
    const a = this.unitBits.get(left);
    const b = this.unitBits.get(right);
    if (!a) return hasUnit(this.groups[right], this.groups[left][0]);
    if (!b) return hasUnit(this.groups[left], this.groups[right][0]);
    for (let word = 0; word < a.length; word += 1) {
      if ((a[word] & b[word]) !== 0) return true;
    }
    return false;
  }

  private poolIndex<T>(
    pool: readonly T[],
    fileOf: (item: T) => string,
  ): PoolIndex<T> {
    const cached = this.pools.get(pool);
    if (cached) return cached as PoolIndex<T>;
    const byUnit = new Map<number, number[]>();
    const shared = new Map<number, number[]>();
    const orphans: T[] = [];
    pool.forEach((item, ordinal) => {
      const group = this.groupOf.get(fileOf(item));
      if (group === undefined) orphans.push(item);
      else if (this.groups[group].length > 1) addTo(shared, group, ordinal);
      else addTo(byUnit, this.groups[group][0], ordinal);
    });
    const index: PoolIndex<T> = {
      byUnit,
      shared,
      orphans,
      inGroup: new Map(),
    };
    this.pools.set(pool, index);
    return index;
  }

  private overlappingOwners<T>(group: number, index: PoolIndex<T>): Iterable<number> {
    const units = this.groups[group];
    if (units.length * OWNER_SCAN_RATIO >= index.shared.size) {
      return [...index.shared.keys()].filter((owner) => this.overlap(group, owner));
    }
    index.ownersByUnit ??= this.ownersByUnit(index.shared);
    const owners = new Set<number>();
    for (const unit of units) {
      for (const owner of index.ownersByUnit.get(unit) ?? NOTHING) owners.add(owner);
    }
    return owners;
  }

  private ownersByUnit(
    shared: ReadonlyMap<number, readonly number[]>,
  ): Map<number, number[]> {
    const owners = new Map<number, number[]>();
    for (const owner of shared.keys()) {
      for (const unit of this.groups[owner]) addTo(owners, unit, owner);
    }
    return owners;
  }

  private inUnits<T>(
    group: number,
    pool: readonly T[],
    fileOf: (item: T) => string,
  ): readonly T[] {
    const index = this.poolIndex(pool, fileOf);
    const cached = index.inGroup.get(group);
    if (cached) return cached;
    const units = this.groups[group];
    const ordinals: number[] = [];
    if (index.byUnit.size < units.length) {
      for (const [unit, list] of index.byUnit) {
        if (hasUnit(units, unit)) appendAll(ordinals, list);
      }
    } else {
      for (const unit of units) {
        appendAll(ordinals, index.byUnit.get(unit) ?? NOTHING);
      }
    }
    for (const owner of this.overlappingOwners(group, index)) {
      appendAll(ordinals, index.shared.get(owner) ?? NOTHING);
    }
    ordinals.sort((left, right) => left - right);
    const items = ordinals.map((ordinal) => pool[ordinal]);
    index.inGroup.set(group, items);
    return items;
  }

  sharesScope(left: string, right: string): boolean {
    const a = this.groupOf.get(left);
    const b = this.groupOf.get(right);
    if (a === undefined || b === undefined) return a === b;
    return this.overlap(a, b);
  }

  connected(left: string, right: string): boolean {
    const a = this.groupOf.get(left);
    const b = this.groupOf.get(right);
    return a === undefined || b === undefined || this.overlap(a, b);
  }

  reaches(viewer: string, file: string): boolean {
    const group = this.groupOf.get(viewer);
    return (
      group === undefined ||
      this.openGroups[group] ||
      this.connected(viewer, file)
    );
  }

  select<T>(
    viewer: string,
    pool: readonly T[],
    fileOf: (item: T) => string,
    citation = false,
  ): LatexUnitSelection<T> {
    const group = this.groupOf.get(viewer);
    if (group === undefined) return { items: pool, tier: "all" };
    if (pool.length === 1) {
      const owner = this.groupOf.get(fileOf(pool[0]));
      if (owner === undefined) return { items: pool, tier: "orphans" };
      if (this.overlap(group, owner)) return { items: pool, tier: "unit" };
    } else if (pool.length > 1) {
      const hits = this.inUnits(group, pool, fileOf);
      if (hits.length > 0) return { items: hits, tier: "unit" };
      const { orphans } = this.poolIndex(pool, fileOf);
      if (orphans.length > 0) return { items: orphans, tier: "orphans" };
    }
    if (pool.length > 0 && (this.openGroups[group] || citation)) {
      return { items: pool, tier: "open" };
    }
    return { items: NOTHING, tier: "none" };
  }

  peers<T>(
    file: string,
    pool: readonly T[],
    fileOf: (item: T) => string,
  ): readonly T[] {
    const group = this.groupOf.get(file);
    return group === undefined
      ? this.poolIndex(pool, fileOf).orphans
      : this.inUnits(group, pool, fileOf);
  }

  isAmbiguous<T>(
    viewer: string,
    candidates: readonly T[],
    fileOf: (item: T) => string,
  ): boolean {
    if (candidates.length < 2) return false;
    const group = this.groupOf.get(viewer);
    const owners: number[] = [];
    let orphans = 0;
    for (const candidate of candidates) {
      const owner = this.groupOf.get(fileOf(candidate));
      if (owner === undefined) orphans += 1;
      else owners.push(owner);
    }
    if (group === undefined && orphans > 1) return true;
    return this.unitsCollide(owners, group === undefined ? null : this.groups[group]);
  }

  private unitsCollide(
    owners: readonly number[],
    visible: readonly number[] | null,
  ): boolean {
    const seen = new Set<number>();
    for (const owner of owners) {
      for (const unit of this.groups[owner]) {
        if (visible && !hasUnit(visible, unit)) continue;
        if (seen.has(unit)) return true;
        seen.add(unit);
      }
    }
    return false;
  }

  duplicateRows(files: readonly string[]): string[][] {
    const ordinals = new Map<number, number[]>();
    const orphans: string[] = [];
    files.forEach((file, ordinal) => {
      const group = this.groupOf.get(file);
      if (group === undefined) orphans.push(file);
      else addTo(ordinals, group, ordinal);
    });
    const groupsInUnit = new Map<number, number[]>();
    for (const group of ordinals.keys()) {
      for (const unit of this.groups[group]) addTo(groupsInUnit, unit, group);
    }
    const rows: string[][] = [];
    const seen = new Set<string>();
    for (const unit of [...groupsInUnit.keys()].sort((a, b) => a - b)) {
      const members = groupsInUnit.get(unit) ?? [];
      const key = members.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const row = members.flatMap((group) => ordinals.get(group) ?? []);
      row.sort((a, b) => a - b);
      if (row.length > 1) rows.push(row.map((at) => files[at]));
    }
    if (orphans.length > 1) rows.push(orphans);
    return rows;
  }

  /**
   * What a rename must touch so that no compile is left with a dangling
   * reference. A use compiled with the renamed definition follows it; a shared
   * file's use also drags along the matching definition of each other unit it
   * lies in. Orphan and fallback uses never spread a rename, so one stale
   * fragment cannot chain two revisions together.
   */
  renameClosure<D, U>(input: LatexRenameInput<D, U>): LatexRenameClosure<D, U> {
    const { definition, pool, definitionFile, definitionAt, together } = input;
    const selected = new Set<D>([definition]);
    const { rooted, loose } = this.sortRenameUses(input);

    const taken = this.spreadRename(selected, [...rooted.keys()], pool, definitionFile, together === true);
    const edited = taken.flatMap((group) => rooted.get(group) ?? []);
    for (const use of edited) {
      const site = definitionAt?.(use);
      if (site !== undefined) selected.add(site);
    }
    const holders = new Set(
      [...selected].map(definitionFile).filter((file) => !this.groupOf.has(file)),
    );
    selectInHolders(input, loose, holders, selected);
    return { defs: [...selected], uses: [...edited, ...this.looseFollowers(input, loose, holders, selected)] };
  }

  /** Uses a unit answers, by file group, apart from orphan and fallback uses. */
  private sortRenameUses<D, U>(input: LatexRenameInput<D, U>): {
    rooted: Map<number, U[]>;
    loose: U[];
  } {
    const { pool, uses, definitionFile, fileOfUse, citation } = input;
    const rooted = new Map<number, U[]>();
    const loose: U[] = [];
    for (const use of uses) {
      const file = fileOfUse(use);
      const group = this.groupOf.get(file);
      if (
        group === undefined ||
        this.select(file, pool, definitionFile, citation).tier !== "unit"
      ) {
        loose.push(use);
      } else {
        addTo(rooted, group, use);
      }
    }
    return { rooted, loose };
  }

  private looseFollowers<D, U>(
    input: LatexRenameInput<D, U>,
    loose: readonly U[],
    holders: ReadonlySet<string>,
    selected: ReadonlySet<D>,
  ): U[] {
    const { pool, definitionFile, fileOfUse, citation } = input;
    const allSelected = new Map<readonly D[], boolean>();
    const followsRename = (items: readonly D[]): boolean => {
      let answer = allSelected.get(items);
      if (answer === undefined) {
        answer = items.length > 0 && items.every((item) => selected.has(item));
        allSelected.set(items, answer);
      }
      return answer;
    };
    return loose.filter((use) => {
      const file = fileOfUse(use);
      const { items } = this.select(file, pool, definitionFile, citation);
      return holders.has(file) || followsRename(items);
    });
  }

  /** Adds to `selected`, and returns the use groups that follow the rename. */
  private spreadRename<D>(
    selected: Set<D>,
    useGroups: readonly number[],
    pool: readonly D[],
    fileOf: (item: D) => string,
    together: boolean,
  ): number[] {
    const unitsOf = (item: D): readonly number[] => {
      const owner = this.groupOf.get(fileOf(item));
      return owner === undefined ? NOTHING : this.groups[owner];
    };
    const definitions = new Map<number, D[]>();
    for (const item of pool) {
      for (const unit of unitsOf(item)) addTo(definitions, unit, item);
    }
    const waiting = new Map<number, number[]>();
    for (const group of useGroups) {
      for (const unit of this.groups[group]) addTo(waiting, unit, group);
    }
    const spread = new RenameSpread(this.groups, definitions, waiting, selected, together);
    spread.run(unitsOf);
    return [...spread.taken];
  }
}

const scopes = new WeakMap<LatexUnits, LatexUnitScope>();

export function latexUnitScope(
  units: LatexUnits | undefined,
): LatexUnitScope | undefined {
  if (!units) return undefined;
  let scope = scopes.get(units);
  if (!scope) {
    scope = new UnitScope(units);
    scopes.set(units, scope);
  }
  return scope;
}
