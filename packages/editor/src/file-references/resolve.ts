import {
  directoryOf,
  extensionOf,
  isAbsolutePath,
  isUrlLike,
  joinPath,
  type ProjectFileIndex,
} from "./paths";
import type { LatexSearchPaths, PathReference, PathReferenceKind } from "./types";

export const GRAPHICS_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".mps", ".jbig2", ".jb2", ".eps", ".ps"];

export interface Base {
  readonly key: string;
  readonly directory: string;
}

export interface World {
  readonly index: ProjectFileIndex;
  readonly searchPaths: LatexSearchPaths;
}

export interface Resolution {
  readonly target: string;
  readonly baseKey: string;
  readonly implied: boolean;
  readonly directory?: string;
}

interface NameCandidate {
  readonly path: string;
  readonly implied: boolean;
}

const DIRECTORY_KINDS = new Set<PathReferenceKind>(["tex-graphicspath", "tex-svgpath"]);
const NAME_MAJOR = new Set<PathReferenceKind>(["tex-graphics", "tex-svg", "tex-pdf"]);

export function isDirectoryKind(kind: PathReferenceKind): boolean {
  return DIRECTORY_KINDS.has(kind);
}

export function impliedExtension(kind: PathReferenceKind, target: string): string | null {
  const extension = extensionOf(target);
  const lower = extension.toLowerCase();
  switch (kind) {
    case "tex-input":
    case "tex-include":
    case "tex-subfile":
    case "tex-import":
    case "tex-subimport":
      return lower === ".tex" ? extension : null;
    case "tex-graphics":
      return GRAPHICS_EXTENSIONS.includes(lower) ? extension : null;
    case "tex-svg":
      return lower === ".svg" ? extension : null;
    case "tex-pdf":
      return lower === ".pdf" ? extension : null;
    case "tex-bibtex":
      return lower === ".bib" ? extension : null;
    case "tex-package":
      return lower === ".sty" ? extension : null;
    case "tex-class":
      return lower === ".cls" ? extension : null;
    default:
      return null;
  }
}

export function extensionRequiredOmitted(kind: PathReferenceKind): boolean {
  return kind === "tex-include" || kind === "tex-package" || kind === "tex-class";
}

function withSuffix(name: string, suffix: string, keepBare: boolean): NameCandidate[] {
  if (name.toLowerCase().endsWith(suffix)) return [{ path: name, implied: false }];
  const candidates = [{ path: `${name}${suffix}`, implied: true }];
  if (keepBare) candidates.push({ path: name, implied: false });
  return candidates;
}

function nameCandidates(kind: PathReferenceKind, name: string): NameCandidate[] {
  switch (kind) {
    case "tex-input":
    case "tex-subfile":
    case "tex-import":
    case "tex-subimport":
      return withSuffix(name, ".tex", true);
    case "tex-include":
      return [{ path: `${name}.tex`, implied: true }];
    case "tex-graphics": {
      if (GRAPHICS_EXTENSIONS.includes(extensionOf(name).toLowerCase())) {
        return [{ path: name, implied: false }];
      }
      return [
        ...GRAPHICS_EXTENSIONS.map((extension) => ({ path: `${name}${extension}`, implied: true })),
        { path: name, implied: false },
      ];
    }
    case "tex-svg":
      return withSuffix(name, ".svg", false);
    case "tex-pdf":
      return withSuffix(name, ".pdf", true);
    case "tex-bibtex":
      return withSuffix(name, ".bib", true);
    case "tex-package":
      return [{ path: `${name}.sty`, implied: true }];
    case "tex-class":
      return [{ path: `${name}.cls`, implied: true }];
    default:
      return [{ path: name, implied: false }];
  }
}

function unescapeTypst(raw: string): string {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (_, escape: string, code?: string) => {
    if (code) return String.fromCodePoint(Number.parseInt(code, 16));
    if (escape === "n") return "\n";
    if (escape === "t") return "\t";
    return escape;
  });
}

function decodeMarkdown(raw: string): string {
  return raw
    .split("/")
    .map((segment) => {
      try {
        const decoded = decodeURIComponent(segment);
        return /[/\\]/.test(decoded) ? segment : decoded;
      } catch {
        return segment;
      }
    })
    .join("/");
}

export interface DecodedName {
  readonly name: string;
  readonly rooted: boolean;
}

export function decodeName(reference: Pick<PathReference, "language">, raw: string): DecodedName | null {
  if (reference.language === "latex") {
    const name = raw.trim().replaceAll('"', "");
    if (!name || isAbsolutePath(name) || isUrlLike(name)) return null;
    return { name, rooted: false };
  }
  if (reference.language === "typst") {
    const name = unescapeTypst(raw);
    if (!name || name.startsWith("@") || isUrlLike(name)) return null;
    if (name.startsWith("/")) return { name: name.replace(/^\/+/, ""), rooted: true };
    return isAbsolutePath(name) ? null : { name, rooted: false };
  }
  const name = decodeMarkdown(raw);
  if (!name || isAbsolutePath(name) || isUrlLike(name)) return null;
  return { name, rooted: false };
}

function latexWorkingBases(world: World, source: string): Base[] {
  return [
    { key: "main", directory: world.index.mainDirectory },
    { key: "root", directory: "" },
    { key: "source", directory: directoryOf(source) },
  ];
}

function withSearchPaths(
  bases: readonly Base[],
  lists: ReadonlyArray<readonly [string, readonly string[]]>,
): Base[] {
  const expanded: Base[] = [];
  for (const base of bases) {
    expanded.push(base);
    for (const [prefix, paths] of lists) {
      paths.forEach((path, index) => {
        const directory = joinPath(base.directory, path);
        if (directory !== null) expanded.push({ key: `${base.key}:${prefix}${index}`, directory });
      });
    }
  }
  return expanded;
}

export function basesFor(
  kind: PathReferenceKind,
  world: World,
  source: string,
  rooted: boolean,
): Base[] {
  if (kind === "typst") {
    return rooted
      ? [{ key: "root", directory: "" }]
      : [{ key: "source", directory: directoryOf(source) }];
  }
  if (kind === "markdown") return [{ key: "source", directory: directoryOf(source) }];
  const working = latexWorkingBases(world, source);
  if (kind === "tex-subfile" || kind === "tex-subimport") {
    return [working[2], working[0], working[1]];
  }
  if (kind === "tex-graphics" || kind === "tex-pdf") {
    return withSearchPaths(working, [["g", world.searchPaths.graphics]]);
  }
  if (kind === "tex-svg") {
    return withSearchPaths(working, [
      ["s", world.searchPaths.svg],
      ["g", world.searchPaths.graphics],
    ]);
  }
  return working;
}

function findFile(
  kind: PathReferenceKind,
  name: string,
  bases: readonly Base[],
  index: ProjectFileIndex,
): Resolution | null {
  const names = nameCandidates(kind, name);
  const pairs: Array<[Base, NameCandidate]> = NAME_MAJOR.has(kind)
    ? names.flatMap((candidate) => bases.map((base): [Base, NameCandidate] => [base, candidate]))
    : bases.flatMap((base) => names.map((candidate): [Base, NameCandidate] => [base, candidate]));
  for (const [base, candidate] of pairs) {
    const path = joinPath(base.directory, candidate.path);
    const target = path === null || path === "" ? null : index.file(path);
    if (target) return { target, baseKey: base.key, implied: candidate.implied };
  }
  return null;
}

function findDirectory(name: string, bases: readonly Base[], index: ProjectFileIndex): Resolution | null {
  for (const base of bases) {
    const directory = joinPath(base.directory, name);
    if (directory !== null && index.directory(directory)) {
      return { target: directory, baseKey: base.key, implied: false };
    }
  }
  return null;
}

function findImport(
  reference: PathReference,
  directoryRaw: string,
  fileRaw: string,
  world: World,
  source: string,
): Resolution | null {
  const directoryName = directoryRaw.trim().replaceAll('"', "");
  if (isAbsolutePath(directoryName) || isUrlLike(directoryName)) return null;
  const file = decodeName(reference, fileRaw);
  if (!file) return null;
  for (const base of basesFor(reference.kind, world, source, false)) {
    const directory = joinPath(base.directory, directoryName);
    if (directory === null) continue;
    const found = findFile(reference.kind, file.name, [{ key: base.key, directory }], world.index);
    if (found) return { ...found, directory };
  }
  return null;
}

export function resolveRaw(
  reference: PathReference,
  raw: string,
  world: World,
  source: string,
  directoryRaw?: string,
): Resolution | null {
  if (reference.directory) {
    return findImport(reference, directoryRaw ?? reference.directory.raw, raw, world, source);
  }
  const decoded = decodeName(reference, raw);
  if (!decoded) return null;
  const bases = basesFor(reference.kind, world, source, decoded.rooted);
  if (isDirectoryKind(reference.kind)) return findDirectory(decoded.name, bases, world.index);
  return findFile(reference.kind, decoded.name, bases, world.index);
}
