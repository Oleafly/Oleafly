import {
  escapeLatexText,
  insideLatexDefinition,
  isBackslashEscaped,
  matchingBrace,
  scanLatexDefinitions,
} from "@oleafly/latex";
import {
  applyTextEdits,
  type FileReferenceEdit,
  type LatexSearchPaths,
  latexSearchPaths,
  type PathReference,
  type PathReferenceKind,
  type ProjectFiles,
  resolvePathReference,
  scanPathReferences,
} from "./file-references";
import { directoryOf, extensionOf, isWithin, withoutExtension } from "./file-references/paths";
import { withoutOverlaps } from "./file-references/plan";
import { REFERENCE_COMPLETION_COMMANDS } from "./latex";
import { maskLatexIgnoredRegions } from "./latex-lexical";
import { escapeRegExp } from "./regexp";

export interface ChapterSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface ChapterWrite extends ChapterSourceFile {
  readonly from: string | null;
}

export type ChapterClashChoice = "rename" | "keep";

export type ChapterDefinitionKind = "command" | "environment";

export type ChapterImportBlocker = "slug" | "exists" | "paperDocument" | "thesisDocument";

export interface ChapterImportInput {
  readonly thesis: {
    readonly main: string;
    readonly files: readonly ChapterSourceFile[];
    readonly paths: readonly string[];
  };
  readonly paper: {
    readonly name: string;
    readonly main: string;
    readonly files: readonly ChapterSourceFile[];
    readonly assets: readonly string[];
  };
  readonly slug: string;
  readonly prefixLabels?: boolean;
  readonly clashes?: Readonly<Record<string, ChapterClashChoice>>;
}

export interface ChapterClash {
  readonly name: string;
  readonly kind: ChapterDefinitionKind;
  readonly paper: string;
  readonly thesis: string | null;
  readonly renamed: string;
  readonly choice: ChapterClashChoice;
}

export interface ChapterAsset {
  readonly from: string;
  readonly to: string;
}

export interface ChapterPackage {
  readonly name: string;
  readonly line: string;
}

export interface ChapterImportPlan {
  readonly root: string;
  readonly blockers: readonly ChapterImportBlocker[];
  readonly title: string;
  readonly files: readonly ChapterWrite[];
  readonly assets: readonly ChapterAsset[];
  readonly definitions: number;
  readonly clashes: readonly ChapterClash[];
  readonly labels: {
    readonly count: number;
    readonly duplicates: readonly string[];
    readonly prefix: boolean;
  };
  readonly packages: readonly ChapterPackage[];
  readonly bibliographies: readonly string[];
  readonly unresolved: readonly string[];
  readonly mainEdits: readonly FileReferenceEdit[];
  readonly lines: readonly string[];
}

interface DocumentBounds {
  readonly begin: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
}

interface PaperWorld {
  readonly main: string;
  readonly texts: ReadonlyMap<string, string>;
  readonly project: ProjectFiles;
  readonly searchPaths: LatexSearchPaths;
  readonly base: string;
}

interface Reach {
  readonly preamble: readonly string[];
  readonly body: readonly string[];
  readonly assets: readonly string[];
  readonly bibliographies: readonly string[];
  readonly packages: ReadonlyMap<string, string>;
  readonly unresolved: readonly string[];
}

interface Definition {
  readonly key: string;
  readonly kind: ChapterDefinitionKind;
  readonly name: string;
  readonly text: string;
  readonly shape: string;
  readonly renew: boolean;
  readonly source: string;
}

interface Rename {
  readonly kind: ChapterDefinitionKind;
  readonly from: string;
  readonly to: string;
}

interface Rewrite {
  readonly world: PaperWorld;
  readonly targets: ReadonlyMap<string, string>;
  readonly latexRoot: string;
  readonly renames: readonly Rename[];
  readonly labels: ReadonlySet<string> | null;
  readonly slug: string;
}

const NAME = String.raw`[\p{L}\p{M}@]+`;
const AFTER_NAME = String.raw`(?![\p{L}\p{M}@])`;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const BEGIN_DOCUMENT = /\\begin\s*\{document\}/u;
const END_DOCUMENT = /\\end\s*\{document\}/u;
const GENERATED = ["chapter.tex", "macros.tex"];
const INPUT_KINDS = new Set<PathReferenceKind>(["tex-input", "tex-include", "tex-subfile", "tex-import", "tex-subimport"]);
const BIBLIOGRAPHY_KINDS = new Set<PathReferenceKind>(["tex-bibtex", "tex-biblatex"]);
const UNFOLLOWED_KINDS = new Set<PathReferenceKind>(["tex-class", "tex-graphicspath", "tex-svgpath"]);
const UNMOVED_KINDS = new Set<PathReferenceKind>(["tex-class", "tex-package", "tex-subfile", "tex-subimport"]);
const DIRECTORY_KINDS = new Set<PathReferenceKind>(["tex-graphicspath", "tex-svgpath"]);
const COMMAND_HEAD = new RegExp(
  String.raw`^\\(?:(?:new|renew|provide)command|DeclareRobustCommand|(?:New|Renew|Provide|Declare)DocumentCommand)\*?\s*(?:\{\s*\\(${NAME})\s*\}|\\(${NAME}))`,
  "u",
);
const DEF_HEAD = new RegExp(String.raw`^\\[gex]?def\s*\\(${NAME})`, "u");
const ENVIRONMENT_HEAD =
  /^\\(?:(?:new|renew|provide)environment|(?:New|Renew|Provide|Declare)DocumentEnvironment)\*?\s*\{([^{}]*)\}/u;
const MATH_OPERATOR = new RegExp(
  String.raw`\\DeclareMathOperator${AFTER_NAME}(\*?)\s*(?:\{\s*\\(${NAME})\s*\}|\\(${NAME}))\s*(?=\{)`,
  "gu",
);
const THEOREM = new RegExp(String.raw`\\newtheorem${AFTER_NAME}(\*?)\s*\{([^{}]+)\}`, "gu");
const PACKAGE = new RegExp(
  String.raw`\\(?:usepackage|RequirePackage)${AFTER_NAME}\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}`,
  "gu",
);
const TITLE = new RegExp(String.raw`\\title${AFTER_NAME}\s*(?:\[[^\]]*\]\s*)?(?=\{)`, "gu");
const THANKS = new RegExp(String.raw`\\thanks${AFTER_NAME}\s*(?=\{)`, "gu");
const DROPPED = new RegExp(
  String.raw`\\(maketitle|title|author|date|bibliographystyle|bibliography|printbibliography|appendix)${AFTER_NAME}`,
  "gu",
);
const WITH_ARGUMENT = new Set(["title", "author", "date", "bibliographystyle", "bibliography"]);
const ABSTRACT = /\\(begin|end)\s*\{abstract\}/gu;
const INCLUDE = new RegExp(String.raw`\\include${AFTER_NAME}`, "gu");
const LABEL = /\\label\s*\{([^{}]*)\}/gu;
const REFERENCES = new RegExp(
  String.raw`\\(?:${REFERENCE_COMPLETION_COMMANDS.join("|")})${AFTER_NAME}\*?\s*\{([^{}]*)\}`,
  "gu",
);
const CHAPTER_END = new RegExp(
  String.raw`\\(?:appendix|backmatter|bibliographystyle|bibliography|printbibliography)${AFTER_NAME}|\\end\s*\{document\}`,
  "gu",
);

function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function skipSpace(text: string, from: number): number {
  let at = from;
  while (at < text.length && /\s/u.test(text[at])) at += 1;
  return at;
}

function skipInline(text: string, from: number): number {
  let at = from;
  while (text[at] === " " || text[at] === "\t") at += 1;
  return at;
}

function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1;
}

function documentBounds(masked: string): DocumentBounds | null {
  const begin = BEGIN_DOCUMENT.exec(masked);
  if (!begin) return null;
  const bodyFrom = begin.index + begin[0].length;
  const end = END_DOCUMENT.exec(masked.slice(bodyFrom));
  return { begin: begin.index, bodyFrom, bodyTo: end ? bodyFrom + end.index : masked.length };
}

function replaceMatches(
  text: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string | null,
): string {
  const masked = maskLatexIgnoredRegions(text);
  const edits: FileReferenceEdit[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    if (isBackslashEscaped(masked, match.index)) continue;
    const insert = replace(match);
    if (insert !== null) edits.push({ from: match.index, to: match.index + match[0].length, insert });
  }
  return edits.length > 0 ? applyTextEdits(text, edits) : text;
}

function resolveTarget(world: PaperWorld, reference: PathReference, sourcePath: string): string | null {
  return (
    resolvePathReference(reference, { sourcePath, project: world.project, searchPaths: world.searchPaths })?.path ??
    null
  );
}

interface ReachState {
  readonly preamble: Set<string>;
  readonly body: Set<string>;
  readonly assets: Set<string>;
  readonly bibliographies: Set<string>;
  readonly packages: Map<string, string>;
  readonly unresolved: Set<string>;
  readonly queue: { path: string; inBody: boolean }[];
}

function isSkippedReference(reference: PathReference, isMain: boolean, bounds: DocumentBounds): boolean {
  if (UNFOLLOWED_KINDS.has(reference.kind) || reference.command === "includeonly") return true;
  return isMain && reference.from >= bounds.bodyTo;
}

function isReportedUnresolved(reference: PathReference, inBody: boolean): boolean {
  return (inBody && reference.kind !== "tex-package") || BIBLIOGRAPHY_KINDS.has(reference.kind);
}

function followReference(
  world: PaperWorld,
  bounds: DocumentBounds,
  state: ReachState,
  next: { path: string; inBody: boolean },
  reference: PathReference,
): void {
  const isMain = next.path === world.main;
  if (isSkippedReference(reference, isMain, bounds)) return;
  const inBody = isMain ? reference.from >= bounds.bodyFrom : next.inBody;
  const target = resolveTarget(world, reference, next.path);
  if (target === null) {
    if (isReportedUnresolved(reference, inBody)) state.unresolved.add(reference.raw);
    return;
  }
  if (BIBLIOGRAPHY_KINDS.has(reference.kind)) state.bibliographies.add(target);
  if (reference.kind === "tex-package") state.packages.set(reference.raw.trim(), target);
  if (INPUT_KINDS.has(reference.kind) && world.texts.has(target)) {
    if (target === world.main) return;
    (inBody ? state.body : state.preamble).add(target);
    state.queue.push({ path: target, inBody });
    return;
  }
  state.assets.add(target);
}

function reach(world: PaperWorld, bounds: DocumentBounds): Reach {
  const state: ReachState = {
    preamble: new Set<string>(),
    body: new Set<string>(),
    assets: new Set<string>(),
    bibliographies: new Set<string>(),
    packages: new Map<string, string>(),
    unresolved: new Set<string>(),
    queue: [{ path: world.main, inBody: false }],
  };
  const seen = new Set<string>();
  for (let next = state.queue.shift(); next; next = state.queue.shift()) {
    const key = `${next.inBody}\0${next.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const reference of scanPathReferences("latex", world.texts.get(next.path) ?? "")) {
      followReference(world, bounds, state, next, reference);
    }
  }
  const { preamble, body, assets, bibliographies, packages, unresolved } = state;
  return {
    preamble: [...preamble].filter((path) => !body.has(path)),
    body: [...body],
    assets: [...assets].filter((path) => !body.has(path)),
    bibliographies: [...bibliographies],
    packages,
    unresolved: [...unresolved],
  };
}

function copyTargets(paths: readonly string[], base: string): Map<string, string> {
  const taken = new Set(GENERATED);
  const targets = new Map<string, string>();
  for (const path of paths) {
    const relative = base && isWithin(path, base) ? path.slice(base.length + 1) : path;
    let candidate = relative;
    let counter = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${withoutExtension(relative)}-${counter}${extensionOf(relative)}`;
      counter += 1;
    }
    taken.add(candidate.toLowerCase());
    targets.set(path, candidate);
  }
  return targets;
}

function definition(
  kind: ChapterDefinitionKind,
  name: string,
  text: string,
  range: readonly [number, number],
  shape: string,
  source: string,
): Definition {
  const full = text.slice(range[0], range[1]);
  return {
    key: `${kind}:${name}`,
    kind,
    name,
    text: full,
    shape: collapse(shape),
    renew: /^\\(?:renew|Renew)/u.test(full),
    source,
  };
}

function spanDefinition(text: string, masked: string, span: readonly [number, number], source: string): Definition | null {
  const head = masked.slice(span[0], span[1]);
  const command = COMMAND_HEAD.exec(head) ?? DEF_HEAD.exec(head);
  if (command) {
    return definition("command", command[1] ?? command[2], text, span, head.slice(command[0].length), source);
  }
  const environment = ENVIRONMENT_HEAD.exec(head);
  if (!environment) return null;
  return definition("environment", environment[1].trim(), text, span, head.slice(environment[0].length), source);
}

function theoremEnd(masked: string, from: number): number {
  let at = skipSpace(masked, from);
  if (masked[at] === "[") {
    const counter = masked.indexOf("]", at);
    if (counter < 0) return -1;
    at = skipSpace(masked, counter + 1);
  }
  if (masked[at] !== "{") return -1;
  const close = matchingBrace(masked, at);
  if (close < 0) return -1;
  const after = skipInline(masked, close + 1);
  const within = masked[after] === "[" ? masked.indexOf("]", after) : -1;
  return within < 0 ? close + 1 : within + 1;
}

function scanDefinitions(text: string, source: string): Definition[] {
  const masked = maskLatexIgnoredRegions(text);
  const { spans } = scanLatexDefinitions(masked);
  const found: { at: number; definition: Definition }[] = [];
  for (const span of spans) {
    const read = spanDefinition(text, masked, span, source);
    if (read) found.push({ at: span[0], definition: read });
  }
  for (const match of masked.matchAll(MATH_OPERATOR)) {
    if (insideLatexDefinition(spans, match.index) || isBackslashEscaped(masked, match.index)) continue;
    const open = match.index + match[0].length;
    const close = matchingBrace(masked, open);
    if (close < 0) continue;
    const shape = `${match[1]}${masked.slice(open, close + 1)}`;
    found.push({
      at: match.index,
      definition: definition("command", match[2] ?? match[3], text, [match.index, close + 1], shape, source),
    });
  }
  for (const match of masked.matchAll(THEOREM)) {
    if (insideLatexDefinition(spans, match.index) || isBackslashEscaped(masked, match.index)) continue;
    const head = match.index + match[0].length;
    const end = theoremEnd(masked, head);
    if (end < 0) continue;
    const shape = `${match[1]}${masked.slice(head, end)}`;
    found.push({
      at: match.index,
      definition: definition("environment", match[2].trim(), text, [match.index, end], shape, source),
    });
  }
  found.sort((left, right) => left.at - right.at);
  return found.map((entry) => entry.definition);
}

function grouped(definitions: readonly Definition[]): Map<string, Definition[]> {
  const groups = new Map<string, Definition[]>();
  for (const entry of definitions) {
    const group = groups.get(entry.key);
    if (group) group.push(entry);
    else groups.set(entry.key, [entry]);
  }
  return groups;
}

function camelSuffix(slug: string): string {
  const parts = slug.split(/[^A-Za-z]+/u).filter(Boolean);
  return parts.map((part) => part[0].toUpperCase() + part.slice(1)).join("") || "Chapter";
}

function displayName(kind: ChapterDefinitionKind, name: string): string {
  return kind === "command" ? `\\${name}` : name;
}

function asNewDefinition(text: string): string {
  return text.replace(/^\\renew/u, String.raw`\new`).replace(/^\\Renew/u, String.raw`\New`);
}

function resolveDefinitions(
  paper: readonly Definition[],
  thesis: readonly Definition[],
  suffix: string,
  choices: Readonly<Record<string, ChapterClashChoice>> | undefined,
): { copied: Definition[]; clashes: ChapterClash[]; renames: Rename[] } {
  const thesisGroups = grouped(thesis);
  const copied: Definition[] = [];
  const clashes: ChapterClash[] = [];
  const renames: Rename[] = [];
  for (const [key, definitions] of grouped(paper)) {
    const existing = thesisGroups.get(key) ?? [];
    const shapes = new Set(existing.map((entry) => entry.shape));
    if (existing.length > 0 && definitions.every((entry) => shapes.has(entry.shape))) continue;
    const [first] = definitions;
    if (existing.length === 0 && !first.renew) {
      copied.push(...definitions);
      continue;
    }
    const name = displayName(first.kind, first.name);
    const choice = choices?.[name] ?? "rename";
    const renamed = `${first.name}${suffix}`;
    clashes.push({
      name,
      kind: first.kind,
      paper: first.text,
      thesis: existing[0]?.text ?? null,
      renamed: displayName(first.kind, renamed),
      choice,
    });
    if (choice === "keep") continue;
    renames.push({ kind: first.kind, from: first.name, to: renamed });
    copied.push(...definitions.map((entry) => ({ ...entry, text: asNewDefinition(entry.text) })));
  }
  return { copied, clashes, renames };
}

function renamePattern(rename: Rename): RegExp {
  const name = escapeRegExp(rename.from);
  if (rename.kind === "command") return new RegExp(String.raw`\\${name}${AFTER_NAME}`, "gu");
  return new RegExp(
    String.raw`(\\(?:begin|end|newtheorem\*?|(?:new|renew|provide)environment\*?|(?:New|Renew|Provide|Declare)DocumentEnvironment)\s*\{\s*)${name}(\s*\})|(\\newtheorem\*?\s*\{[^{}]*\}\s*\[\s*)${name}(\s*\])`,
    "gu",
  );
}

function applyRenames(text: string, renames: readonly Rename[]): string {
  return renames.reduce(
    (current, rename) =>
      replaceMatches(current, renamePattern(rename), (match) =>
        rename.kind === "command"
          ? `\\${rename.to}`
          : `${match[1] ?? match[3]}${rename.to}${match[2] ?? match[4]}`,
      ),
    text,
  );
}

function literalLabels(text: string): string[] {
  const masked = maskLatexIgnoredRegions(text);
  const labels: string[] = [];
  for (const match of masked.matchAll(LABEL)) {
    const name = match[1].trim();
    if (name && !name.includes("#") && !isBackslashEscaped(masked, match.index)) labels.push(name);
  }
  return labels;
}

function prefixedKeys(list: string, labels: ReadonlySet<string>, slug: string): string {
  return list
    .split(",")
    .map((part) => {
      const name = part.trim();
      return labels.has(name) ? part.replace(name, `${slug}:${name}`) : part;
    })
    .join(",");
}

function prefixLabels(text: string, labels: ReadonlySet<string>, slug: string): string {
  const prefix = (match: RegExpExecArray) => {
    const keys = prefixedKeys(match[1], labels, slug);
    return keys === match[1] ? null : `${match[0].slice(0, match[0].length - match[1].length - 1)}${keys}}`;
  };
  return replaceMatches(replaceMatches(text, LABEL, prefix), REFERENCES, prefix);
}

function respelled(reference: PathReference, mapped: string, latexRoot: string): string {
  const name = reference.raw.trim().replaceAll('"', "");
  const extension = extensionOf(mapped);
  const keep =
    extension !== "" && reference.kind !== "tex-include" && name.toLowerCase().endsWith(extension.toLowerCase());
  const spelled = `${latexRoot}/${keep ? mapped : withoutExtension(mapped)}`;
  return reference.raw.includes('"') ? `"${spelled}"` : spelled;
}

function directorySpelling(directory: string, rewrite: Rewrite): string {
  const { base } = rewrite.world;
  const relative = base && isWithin(directory, base) ? directory.slice(base.length).replace(/^\//u, "") : directory;
  return relative ? `${rewrite.latexRoot}/${relative}/` : `${rewrite.latexRoot}/`;
}

function rewritePaths(text: string, sourcePath: string, rewrite: Rewrite): string {
  const edits: FileReferenceEdit[] = [];
  for (const reference of scanPathReferences("latex", text)) {
    if (UNMOVED_KINDS.has(reference.kind) || reference.directory || reference.command === "includeonly") continue;
    const target = resolveTarget(rewrite.world, reference, sourcePath);
    if (target === null) continue;
    if (DIRECTORY_KINDS.has(reference.kind)) {
      edits.push({ from: reference.from, to: reference.to, insert: directorySpelling(target, rewrite) });
      continue;
    }
    const mapped = rewrite.targets.get(target);
    if (mapped !== undefined) {
      edits.push({ from: reference.from, to: reference.to, insert: respelled(reference, mapped, rewrite.latexRoot) });
    }
  }
  return applyTextEdits(text, edits);
}

function transform(text: string, sourcePath: string, rewrite: Rewrite, body: boolean): string {
  const moved = rewritePaths(text, sourcePath, rewrite);
  const inputs = body ? replaceMatches(moved, INCLUDE, () => String.raw`\input`) : moved;
  const renamed = applyRenames(inputs, rewrite.renames);
  return rewrite.labels ? prefixLabels(renamed, rewrite.labels, rewrite.slug) : renamed;
}

function argumentEnd(masked: string, from: number, argument: boolean): number {
  let at = masked[from] === "*" ? from + 1 : from;
  for (let open = skipInline(masked, at); masked[open] === "["; open = skipInline(masked, at)) {
    const close = masked.indexOf("]", open);
    if (close < 0) break;
    at = close + 1;
  }
  if (!argument) return at;
  const open = skipSpace(masked, at);
  const close = masked[open] === "{" ? matchingBrace(masked, open) : -1;
  return close < 0 ? at : close + 1;
}

function removal(masked: string, from: number, to: number): FileReferenceEdit {
  const start = lineStart(masked, from);
  const newline = masked.indexOf("\n", to);
  const end = newline < 0 ? masked.length : newline;
  const blank = masked.slice(start, from).trim() === "" && masked.slice(to, end).trim() === "";
  return blank ? { from: start, to: newline < 0 ? end : newline + 1, insert: "" } : { from, to, insert: "" };
}

function cleanTitle(masked: string): string {
  const edits: FileReferenceEdit[] = [];
  for (const match of masked.matchAll(THANKS)) {
    const open = match.index + match[0].length;
    const close = matchingBrace(masked, open);
    if (close >= 0) edits.push({ from: match.index, to: close + 1, insert: "" });
  }
  return collapse(
    applyTextEdits(masked, withoutOverlaps(edits))
      .replace(/\\\\\*?(?:\[[^\]]*\])?/gu, " ")
      .replace(new RegExp(String.raw`\\(?:newline|and)${AFTER_NAME}`, "gu"), " "),
  );
}

function paperTitle(masked: string, bounds: DocumentBounds, fallback: string): string {
  for (const match of masked.slice(0, bounds.bodyTo).matchAll(TITLE)) {
    const open = match.index + match[0].length;
    const close = matchingBrace(masked, open);
    const title = close < 0 ? "" : cleanTitle(masked.slice(open + 1, close));
    if (title) return title;
  }
  return escapeLatexText(collapse(fallback));
}

function chapterText(text: string, masked: string, bounds: DocumentBounds, title: string): string {
  const body = text.slice(bounds.bodyFrom, bounds.bodyTo);
  const maskedBody = masked.slice(bounds.bodyFrom, bounds.bodyTo);
  const edits: FileReferenceEdit[] = [];
  for (const match of maskedBody.matchAll(DROPPED)) {
    const end = argumentEnd(maskedBody, match.index + match[0].length, WITH_ARGUMENT.has(match[1]));
    edits.push(removal(maskedBody, match.index, end));
  }
  for (const match of maskedBody.matchAll(ABSTRACT)) {
    const end = match.index + match[0].length;
    edits.push(
      match[1] === "begin"
        ? { from: match.index, to: end, insert: String.raw`\section*{Abstract}` }
        : removal(maskedBody, match.index, end),
    );
  }
  const kept = applyTextEdits(body, withoutOverlaps(edits))
    .replace(/^(?:[ \t]*\n)+/u, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd();
  return `\\chapter{${title}}\n\n${kept}\n`;
}

function packageNames(texts: readonly string[]): { name: string; options: string | undefined }[] {
  const names: { name: string; options: string | undefined }[] = [];
  for (const text of texts) {
    for (const match of maskLatexIgnoredRegions(text).matchAll(PACKAGE)) {
      for (const part of match[2].split(",")) {
        const name = part.trim();
        if (name) names.push({ name, options: match[1]?.trim() });
      }
    }
  }
  return names;
}

function missingPackages(
  preambles: readonly string[],
  thesis: readonly ChapterSourceFile[],
  local: ReadonlyMap<string, string>,
  targets: ReadonlyMap<string, string>,
  latexRoot: string,
): ChapterPackage[] {
  const loaded = new Set(packageNames(thesis.map((file) => file.content)).map((entry) => entry.name));
  const missing = new Map<string, ChapterPackage>();
  for (const { name, options } of packageNames(preambles)) {
    if (loaded.has(name) || missing.has(name)) continue;
    const localPath = local.get(name);
    const mapped = localPath === undefined ? undefined : targets.get(localPath);
    const target = mapped === undefined ? name : `${latexRoot}/${withoutExtension(mapped)}`;
    const bracketed = options ? `[${options}]` : "";
    missing.set(name, { name, line: String.raw`\usepackage${bracketed}{${target}}` });
  }
  return [...missing.values()];
}

function wiring(
  main: string,
  latexRoot: string,
  withDefinitions: boolean,
): { edits: FileReferenceEdit[]; lines: string[] } {
  const masked = maskLatexIgnoredRegions(main);
  const begin = BEGIN_DOCUMENT.exec(masked);
  if (!begin) return { edits: [], lines: [] };
  const edits: FileReferenceEdit[] = [];
  const lines: string[] = [];
  if (withDefinitions) {
    const line = String.raw`\input{${latexRoot}/macros}`;
    const at = lineStart(masked, begin.index);
    lines.push(line);
    edits.push({ from: at, to: at, insert: `${line}\n\n` });
  }
  const chapter = String.raw`\include{${latexRoot}/chapter}`;
  const present = new RegExp(
    String.raw`\\(?:include|input)\s*\{\s*${escapeRegExp(latexRoot)}/chapter(?:\.tex)?\s*\}`,
    "u",
  ).test(masked);
  if (!present) {
    CHAPTER_END.lastIndex = begin.index + begin[0].length;
    const end = CHAPTER_END.exec(masked);
    const at = end ? lineStart(masked, end.index) : masked.length;
    lines.push(chapter);
    edits.push({ from: at, to: at, insert: end ? `${chapter}\n\n` : `\n${chapter}\n` });
  }
  return { edits, lines };
}

function folderTaken(thesis: ChapterImportInput["thesis"], root: string): boolean {
  const folder = root.toLowerCase();
  return [...thesis.paths, ...thesis.files.map((file) => file.path)].some((path) => {
    const lower = path.toLowerCase();
    return lower === folder || lower.startsWith(`${folder}/`);
  });
}

function contentOf(files: readonly ChapterSourceFile[], path: string): string {
  return files.find((file) => file.path === path)?.content ?? "";
}

export function planChapterImport(input: ChapterImportInput): ChapterImportPlan {
  const slug = input.slug.trim();
  const latexRoot = `chapters/${slug}`;
  const thesisBase = directoryOf(input.thesis.main);
  const root = thesisBase ? `${thesisBase}/${latexRoot}` : latexRoot;
  const paperMain = contentOf(input.paper.files, input.paper.main);
  const paperMasked = maskLatexIgnoredRegions(paperMain);
  const thesisMain = contentOf(input.thesis.files, input.thesis.main);
  const bounds = documentBounds(paperMasked);
  const blockers: ChapterImportBlocker[] = [];
  if (!SLUG.test(slug)) blockers.push("slug");
  if (folderTaken(input.thesis, root)) blockers.push("exists");
  if (!bounds) blockers.push("paperDocument");
  if (!BEGIN_DOCUMENT.test(maskLatexIgnoredRegions(thesisMain))) blockers.push("thesisDocument");
  if (!bounds) {
    return {
      root,
      blockers,
      title: escapeLatexText(collapse(input.paper.name)),
      files: [],
      assets: [],
      definitions: 0,
      clashes: [],
      labels: { count: 0, duplicates: [], prefix: false },
      packages: [],
      bibliographies: [],
      unresolved: [],
      mainEdits: [],
      lines: [],
    };
  }
  const world: PaperWorld = {
    main: input.paper.main,
    texts: new Map(input.paper.files.map((file) => [file.path, file.content])),
    project: {
      files: [...input.paper.files.map((file) => file.path), ...input.paper.assets],
      mainDoc: input.paper.main,
    },
    searchPaths: latexSearchPaths(input.paper.files.map((file) => ({ path: file.path, text: file.content }))),
    base: directoryOf(input.paper.main),
  };
  const reached = reach(world, bounds);
  const targets = copyTargets([...reached.body, ...reached.assets], world.base);
  const preambles = [
    ...reached.preamble.map((path) => ({ path, content: world.texts.get(path) ?? "" })),
    { path: input.paper.main, content: paperMain.slice(0, bounds.begin) },
  ];
  const resolved = resolveDefinitions(
    preambles.flatMap((file) => scanDefinitions(file.content, file.path)),
    input.thesis.files.flatMap((file) => scanDefinitions(file.content, file.path)),
    camelSuffix(slug),
    input.clashes,
  );
  const title = paperTitle(paperMasked, bounds, input.paper.name);
  const bodies = [
    { path: `${root}/chapter.tex`, source: input.paper.main, content: chapterText(paperMain, paperMasked, bounds, title) },
    ...reached.body.map((path) => ({
      path: `${root}/${targets.get(path)}`,
      source: path,
      content: world.texts.get(path) ?? "",
    })),
  ];
  const copiedLabels = new Set(bodies.flatMap((file) => literalLabels(file.content)));
  const thesisLabels = new Set(input.thesis.files.flatMap((file) => literalLabels(file.content)));
  const duplicates = [...copiedLabels].filter((label) => thesisLabels.has(label));
  const prefix = input.prefixLabels ?? duplicates.length > 0;
  const rewrite: Rewrite = {
    world,
    targets,
    latexRoot,
    renames: resolved.renames,
    labels: prefix ? copiedLabels : null,
    slug,
  };
  const files: ChapterWrite[] = bodies.map((file) => ({
    path: file.path,
    content: transform(file.content, file.source, rewrite, true),
    from: file.source,
  }));
  const macros = resolved.copied.map((entry) => transform(entry.text, entry.source, rewrite, false));
  if (macros.length > 0) files.splice(1, 0, { path: `${root}/macros.tex`, content: `${macros.join("\n")}\n`, from: null });
  const wired = wiring(thesisMain, latexRoot, macros.length > 0);
  return {
    root,
    blockers,
    title,
    files,
    assets: reached.assets.map((path) => ({ from: path, to: `${root}/${targets.get(path)}` })),
    definitions: macros.length,
    clashes: resolved.clashes,
    labels: { count: copiedLabels.size, duplicates, prefix },
    packages: missingPackages(
      preambles.map((file) => file.content),
      input.thesis.files,
      reached.packages,
      targets,
      latexRoot,
    ),
    bibliographies: reached.bibliographies.map((path) => `${root}/${targets.get(path)}`),
    unresolved: reached.unresolved,
    mainEdits: wired.edits,
    lines: wired.lines,
  };
}
