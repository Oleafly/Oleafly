import {
  directoryOf,
  extensionOf,
  isWithin,
  ProjectFileIndex,
  relativePath,
  remapPath,
  withoutExtension,
} from "./paths";
import {
  basesFor,
  type Base,
  decodeName,
  extensionRequiredOmitted,
  impliedExtension,
  isDirectoryKind,
  type Resolution,
  resolveRaw,
  type World,
} from "./resolve";
import { referenceLanguageForPath, scanPathReferences } from "./scan";
import type {
  FileReferenceEdit,
  FileReferenceFileEdits,
  FileReferencePlan,
  LatexSearchPaths,
  PathReference,
  PathReferenceKind,
  PlanInput,
  ReferenceSource,
  ResolveContext,
  ResolvedPathReference,
  TextSpan,
} from "./types";

interface ScannedSource {
  readonly afterPath: string;
  readonly beforePath: string;
  readonly text: string;
  readonly references: readonly PathReference[];
}

interface SourceEdits {
  readonly edits: FileReferenceEdit[];
  references: number;
}

type Pass = (relative: string) => boolean;

const MARKDOWN_ESCAPES: Readonly<Record<string, string>> = {
  " ": "%20",
  "(": "%28",
  ")": "%29",
  "<": "%3C",
  ">": "%3E",
};

function searchPathValue(raw: string): string {
  return raw.trim().replaceAll('"', "");
}

function searchPathsOf(scanned: readonly { readonly references: readonly PathReference[] }[]): LatexSearchPaths {
  const graphics: string[] = [];
  const svg: string[] = [];
  for (const source of scanned) {
    for (const reference of source.references) {
      if (!isDirectoryKind(reference.kind)) continue;
      const list = reference.kind === "tex-svgpath" ? svg : graphics;
      const value = searchPathValue(reference.raw);
      if (!list.includes(value)) list.push(value);
    }
  }
  return { graphics, svg };
}

export function latexSearchPaths(sources: readonly ReferenceSource[]): LatexSearchPaths {
  return searchPathsOf(
    sources
      .filter((source) => referenceLanguageForPath(source.path) === "latex")
      .map((source) => ({ references: scanPathReferences("latex", source.text) })),
  );
}

export function resolvePathReference(
  reference: PathReference,
  context: ResolveContext,
): ResolvedPathReference | null {
  const world: World = {
    index: new ProjectFileIndex(context.project),
    searchPaths: context.searchPaths ?? { graphics: [], svg: [] },
  };
  const resolved = resolveRaw(reference, reference.raw, world, context.sourcePath);
  return resolved ? { path: resolved.target, directory: isDirectoryKind(reference.kind) } : null;
}

export function applyTextEdits(text: string, edits: readonly FileReferenceEdit[]): string {
  let next = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    next = next.slice(0, edit.from) + edit.insert + next.slice(edit.to);
  }
  return next;
}

function orderedBases(bases: readonly Base[], key: string): Base[] {
  return [...bases.filter((base) => base.key === key), ...bases.filter((base) => base.key !== key)];
}

function climbs(path: string): boolean {
  return path.replaceAll("\\", "/").split("/").includes("..");
}

function passes(originalClimbs: boolean): Pass[] {
  if (originalClimbs) return [() => true];
  return [(relative) => !relative.startsWith("../"), (relative) => relative.startsWith("../")];
}

function nameVariants(kind: PathReferenceKind, relative: string, implied: boolean): string[] {
  const implicit = impliedExtension(kind, relative);
  if (extensionRequiredOmitted(kind)) return implicit ? [withoutExtension(relative)] : [];
  if (implied && implicit) return [withoutExtension(relative), relative];
  return [relative];
}

function decorate(name: string, dotSlash: boolean, rooted: boolean): string {
  if (rooted) return `/${name}`;
  return dotSlash && !name.startsWith("../") ? `./${name}` : name;
}

function encodeLatex(original: string, name: string): string {
  if (!original.includes('"')) return name;
  const quotedStem = /^"[^"]*"\.[^"./]+$/.test(original);
  const extension = extensionOf(name);
  return quotedStem && extension ? `"${withoutExtension(name)}"${extension}` : `"${name}"`;
}

function encodeMarkdown(reference: PathReference, name: string): string {
  if (reference.wrapped) return name;
  if (/%[0-9A-Fa-f]{2}/.test(reference.raw)) {
    return name.split("/").map(encodeURIComponent).join("/");
  }
  return name.replace(/[ ()<>]/g, (character) => MARKDOWN_ESCAPES[character]);
}

function encodeName(reference: PathReference, name: string): string {
  if (reference.language === "latex") return encodeLatex(reference.raw, name);
  if (reference.language === "typst") return name.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
  return encodeMarkdown(reference, name);
}

function respellFile(
  reference: PathReference,
  resolved: Resolution,
  world: World,
  source: string,
  target: string,
): string | null {
  const decoded = decodeName(reference, reference.raw);
  if (!decoded) return null;
  const dotSlash = decoded.name.startsWith("./");
  const bases = orderedBases(basesFor(reference.kind, world, source, decoded.rooted), resolved.baseKey);
  for (const pass of passes(climbs(decoded.name))) {
    for (const base of bases) {
      const relative = relativePath(base.directory, target);
      if (!pass(relative)) continue;
      for (const name of nameVariants(reference.kind, relative, resolved.implied)) {
        const raw = encodeName(reference, decorate(name, dotSlash, decoded.rooted));
        if (resolveRaw(reference, raw, world, source)?.target === target) return raw;
      }
    }
  }
  return null;
}

function directorySpelling(original: string, relative: string): string {
  const trimmed = original.trim();
  if (relative === "") return trimmed === "" ? "" : "./";
  const prefixed = trimmed.startsWith("./") && !relative.startsWith("../") ? `./${relative}` : relative;
  return trimmed.endsWith("/") ? `${prefixed}/` : prefixed;
}

function respellDirectory(
  reference: PathReference,
  resolved: Resolution,
  world: World,
  source: string,
  target: string,
): string | null {
  const original = searchPathValue(reference.raw);
  const bases = orderedBases(basesFor(reference.kind, world, source, false), resolved.baseKey);
  for (const pass of passes(climbs(original))) {
    for (const base of bases) {
      const relative = relativePath(base.directory, target);
      if (!pass(relative)) continue;
      const raw = directorySpelling(original, relative);
      if (resolveRaw(reference, raw, world, source)?.target === target) return raw;
    }
  }
  return null;
}

function importEditList(
  reference: PathReference,
  directoryReference: TextSpan,
  directoryRaw: string,
  name: string,
): FileReferenceEdit[] {
  const edits: FileReferenceEdit[] = [];
  if (directoryRaw !== directoryReference.raw) {
    edits.push({ from: directoryReference.from, to: directoryReference.to, insert: directoryRaw });
  }
  if (name !== reference.raw) edits.push({ from: reference.from, to: reference.to, insert: name });
  return edits;
}

function importEdits(
  reference: PathReference,
  resolved: Resolution,
  world: World,
  source: string,
  target: string,
  remap: (path: string) => string,
): FileReferenceEdit[] | null {
  const directoryReference = reference.directory;
  if (!directoryReference || resolved.directory === undefined) return null;
  const moved = remap(resolved.directory);
  const directory = isWithin(target, moved) && world.index.directory(moved) ? moved : directoryOf(target);
  const fileNames = nameVariants(reference.kind, relativePath(directory, target), resolved.implied);
  const bases = orderedBases(basesFor(reference.kind, world, source, false), resolved.baseKey);
  for (const pass of passes(climbs(directoryReference.raw))) {
    for (const base of bases) {
      const relative = relativePath(base.directory, directory);
      if (!pass(relative)) continue;
      const directoryRaw = directorySpelling(directoryReference.raw, relative);
      const name = fileNames.find(
        (candidate) => resolveRaw(reference, candidate, world, source, directoryRaw)?.target === target,
      );
      if (name !== undefined) return importEditList(reference, directoryReference, directoryRaw, name);
    }
  }
  return null;
}

function scanSources(sources: readonly ReferenceSource[], unmap: (path: string) => string): ScannedSource[] {
  const scanned: ScannedSource[] = [];
  for (const source of sources) {
    const language = referenceLanguageForPath(source.path);
    if (!language) continue;
    scanned.push({
      afterPath: source.path,
      beforePath: unmap(source.path),
      text: source.text,
      references: scanPathReferences(language, source.text),
    });
  }
  return scanned;
}

function record(edits: Map<ScannedSource, SourceEdits>, source: ScannedSource, found: FileReferenceEdit[]): void {
  if (found.length === 0) return;
  const entry = edits.get(source) ?? { edits: [], references: 0 };
  entry.edits.push(...found);
  entry.references += 1;
  edits.set(source, entry);
}

function withoutOverlaps(edits: readonly FileReferenceEdit[]): FileReferenceEdit[] {
  const sorted = [...edits].sort((left, right) => left.from - right.from);
  const kept: FileReferenceEdit[] = [];
  for (const edit of sorted) {
    const previous = kept.at(-1);
    if (!previous || edit.from >= previous.to) kept.push(edit);
  }
  return kept;
}

function directoryRespelling(
  reference: PathReference,
  source: ScannedSource,
  before: World,
  after: World,
  remap: (path: string) => string,
): string | null {
  const resolved = resolveRaw(reference, reference.raw, before, source.beforePath);
  if (!resolved) return null;
  const target = remap(resolved.target);
  if (!after.index.directory(target)) return null;
  if (resolveRaw(reference, reference.raw, after, source.afterPath)?.target === target) return null;
  return respellDirectory(reference, resolved, after, source.afterPath, target);
}

function respellSearchPaths(
  scanned: readonly ScannedSource[],
  before: World,
  after: World,
  remap: (path: string) => string,
  edits: Map<ScannedSource, SourceEdits>,
): Map<string, string> {
  const renamed = new Map<string, string>();
  for (const source of scanned) {
    for (const reference of source.references) {
      if (!isDirectoryKind(reference.kind)) continue;
      const spelled = directoryRespelling(reference, source, before, after, remap);
      if (spelled === null) continue;
      renamed.set(`${reference.kind}\0${searchPathValue(reference.raw)}`, spelled);
      record(edits, source, [{ from: reference.from, to: reference.to, insert: spelled }]);
    }
  }
  return renamed;
}

function renamedSearchPaths(search: LatexSearchPaths, renamed: ReadonlyMap<string, string>): LatexSearchPaths {
  return {
    graphics: search.graphics.map((value) => renamed.get(`tex-graphicspath\0${value}`) ?? value),
    svg: search.svg.map((value) => renamed.get(`tex-svgpath\0${value}`) ?? value),
  };
}

function fileReferenceEdits(
  reference: PathReference,
  source: ScannedSource,
  before: World,
  after: World,
  remap: (path: string) => string,
): FileReferenceEdit[] | null {
  const resolved = resolveRaw(reference, reference.raw, before, source.beforePath);
  if (!resolved) return null;
  const target = after.index.file(remap(resolved.target));
  if (!target) return null;
  if (resolveRaw(reference, reference.raw, after, source.afterPath)?.target === target) return null;
  if (reference.directory) return importEdits(reference, resolved, after, source.afterPath, target, remap);
  const spelled = respellFile(reference, resolved, after, source.afterPath, target);
  return spelled === null ? null : [{ from: reference.from, to: reference.to, insert: spelled }];
}

function recordFileEdits(
  scanned: readonly ScannedSource[],
  before: World,
  after: World,
  remap: (path: string) => string,
  edits: Map<ScannedSource, SourceEdits>,
): void {
  for (const source of scanned) {
    for (const reference of source.references) {
      if (isDirectoryKind(reference.kind)) continue;
      const found = fileReferenceEdits(reference, source, before, after, remap);
      if (found) record(edits, source, found);
    }
  }
}

function collectPlan(
  scanned: readonly ScannedSource[],
  edits: ReadonlyMap<ScannedSource, SourceEdits>,
): FileReferencePlan {
  const files: FileReferenceFileEdits[] = [];
  let references = 0;
  for (const source of scanned) {
    const entry = edits.get(source);
    if (!entry) continue;
    files.push({
      path: source.afterPath,
      text: source.text,
      edits: withoutOverlaps(entry.edits),
      references: entry.references,
    });
    references += entry.references;
  }
  return { files, references };
}

export function planReferenceUpdates(input: PlanInput): FileReferencePlan {
  const { from: oldPath, to: newPath } = input.move;
  const remap = (path: string) => remapPath(path, oldPath, newPath);
  const unmap = (path: string) => remapPath(path, newPath, oldPath);
  const scanned = scanSources(input.sources, unmap);
  const beforeSearch = searchPathsOf(scanned);
  const before: World = { index: new ProjectFileIndex(input.before), searchPaths: beforeSearch };
  const afterIndex = new ProjectFileIndex(input.after);
  const edits = new Map<ScannedSource, SourceEdits>();
  const directoryWorld: World = { index: afterIndex, searchPaths: beforeSearch };
  const renamedSearch = respellSearchPaths(scanned, before, directoryWorld, remap, edits);
  const after: World = { index: afterIndex, searchPaths: renamedSearchPaths(beforeSearch, renamedSearch) };
  recordFileEdits(scanned, before, after, remap, edits);
  return collectPlan(scanned, edits);
}
