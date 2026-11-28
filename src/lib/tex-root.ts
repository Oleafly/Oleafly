import { useShallow } from "zustand/react/shallow";
import type { SourceFamily } from "@/lib/folder-detection";
import { documentFamily, isRepositoryNote, mainDocumentMissing, treeHasFile } from "@/lib/main-document";
import { basename } from "@/lib/path-utils";
import { isLibraryProject } from "@/lib/project-location";
import { resolveProjectPath } from "@/lib/project-intelligence/source";
import type { LatexUnits } from "@/lib/project-intelligence/types";
import { parseTexMagicComments } from "@/lib/tex-magic-comments";
import { useCompileRootStore } from "@/store/compile-root";
import { useFilesStore } from "@/store/files";

export type BrokenTexRootReason = "missing" | "not_tex";

type TexRootReason = "magic" | "document" | "include";

export interface EffectiveMainDoc {
  mainDoc: string;
  overriddenBy: string | null;
  reason: TexRootReason | null;
  brokenRoot: { declaredIn: string; target: string; reason: BrokenTexRootReason } | null;
}

type FilesState = ReturnType<typeof useFilesStore.getState>;

interface RootOverride {
  readonly projectId: string;
  readonly root: string;
  readonly by: string;
  readonly reason: TexRootReason;
}

const LATEX_SOURCE = /\.(?:tex|latex|ltx)$/i;
const DOCUMENT_CLASS = String.raw`\documentclass`;
const BEGIN_DOCUMENT = String.raw`\begin{document}`;
const CLASS_ARGUMENT = /^\s*(?:\[[^\]]*\]\s*)?\{\s*([^\s}]+)\s*\}/;
const PART_CLASSES: ReadonlySet<string> = new Set(["standalone", "subfiles"]);

let lastOverride: RootOverride | null = null;
let lastScan: { readonly text: string; readonly complete: boolean } | null = null;

function escaped(text: string, index: number): boolean {
  let slashes = 0;
  while (index - slashes > 0 && text[index - slashes - 1] === "\\") slashes++;
  return slashes % 2 === 1;
}

function inComment(text: string, at: number): boolean {
  for (let index = text.lastIndexOf("\n", at - 1) + 1; index < at; index++) {
    if (text[index] === "%" && !escaped(text, index)) return true;
  }
  return false;
}

function commandAt(text: string, command: string, from: number): number {
  for (let at = text.indexOf(command, from); at >= 0; at = text.indexOf(command, at + command.length)) {
    if (!escaped(text, at) && !inComment(text, at)) return at;
  }
  return -1;
}

function scanCompleteDocument(text: string): boolean {
  const at = commandAt(text, DOCUMENT_CLASS, 0);
  if (at < 0) return false;
  const start = at + DOCUMENT_CLASS.length;
  const className = CLASS_ARGUMENT.exec(text.slice(start, start + 2_000))?.[1]?.toLowerCase();
  if (!className || PART_CLASSES.has(className)) return false;
  return commandAt(text, BEGIN_DOCUMENT, start) >= 0;
}

function isCompleteDocument(text: string): boolean {
  if (lastScan?.text === text) return lastScan.complete;
  const complete = scanCompleteDocument(text);
  lastScan = { text, complete };
  return complete;
}

function isProjectLatexFile(files: FilesState, path: string): boolean {
  return LATEX_SOURCE.test(path) && treeHasFile(files.tree, path);
}

function followsOpenFile(files: FilesState): boolean {
  return files.engine.source_format === "latex" && useCompileRootStore.getState().followOpenFile;
}

function rootsReaching(units: LatexUnits, path: string): string[] {
  const group = units.fileGroups[path];
  if (group === undefined) return [];
  return (units.groups[group] ?? []).flatMap((unit) => {
    const root = units.roots[unit];
    return root === undefined ? [] : [root];
  });
}

function includingRoot(files: FilesState, projectId: string, path: string, stored: string): string | null {
  const known = useCompileRootStore.getState().latexUnits;
  if (known?.projectId !== projectId) return null;
  const roots = rootsReaching(known.units, path).filter((root) => isProjectLatexFile(files, root));
  if (roots.includes(stored)) return stored;
  if (lastOverride?.projectId === projectId && roots.includes(lastOverride.root)) return lastOverride.root;
  return roots.length === 1 ? (roots[0] ?? null) : null;
}

function followedRoot(
  files: FilesState,
  projectId: string,
  path: string,
  text: string,
  stored: string,
): RootOverride | null {
  if (!followsOpenFile(files)) return null;
  if (isCompleteDocument(text)) {
    return path === stored || !treeHasFile(files.tree, path) ? null : { projectId, root: path, by: path, reason: "document" };
  }
  const root = includingRoot(files, projectId, path, stored);
  return root === null || root === stored ? null : { projectId, root, by: path, reason: "include" };
}

function keptRoot(files: FilesState, projectId: string, stored: string): RootOverride | null {
  const kept = lastOverride;
  if (kept?.projectId !== projectId || kept.root === stored || !files.openTabs.includes(kept.by)) return null;
  if (!isProjectLatexFile(files, kept.root)) return null;
  return kept.reason === "magic" || followsOpenFile(files) ? kept : null;
}

function overridden(stored: string, override: RootOverride | null): EffectiveMainDoc {
  if (override === null) return { mainDoc: stored, overriddenBy: null, reason: null, brokenRoot: null };
  return { mainDoc: override.root, overriddenBy: override.by, reason: override.reason, brokenRoot: null };
}

export function resolveEffectiveMainDoc(): EffectiveMainDoc {
  const files = useFilesStore.getState();
  const stored = files.mainDoc || "main.tex";
  const { projectId, activePath } = files;
  if (!projectId) {
    lastOverride = null;
    return overridden(stored, null);
  }
  const text = activePath && LATEX_SOURCE.test(activePath) ? files.files[activePath]?.content : undefined;
  if (!activePath || text === undefined) return overridden(stored, keptRoot(files, projectId, stored));
  const project = files.projects?.find((entry) => entry.id === projectId);
  const magic = parseTexMagicComments(text, project && !isLibraryProject(project) ? "shared" : "library").root;
  if (magic === null) {
    lastOverride = followedRoot(files, projectId, activePath, text, stored);
    return overridden(stored, lastOverride);
  }
  const resolved = resolveProjectPath(activePath, magic);
  if (resolved !== null && isProjectLatexFile(files, resolved)) {
    lastOverride = { projectId, root: resolved, by: activePath, reason: "magic" };
    return overridden(stored, lastOverride);
  }
  lastOverride = null;
  return {
    ...overridden(stored, null),
    brokenRoot: {
      declaredIn: activePath,
      target: magic,
      reason: resolved !== null && treeHasFile(files.tree, resolved) ? "not_tex" : "missing",
    },
  };
}

type FollowedReason = "format" | "standalone";

export interface CompileTarget extends Omit<EffectiveMainDoc, "reason"> {
  reason: TexRootReason | FollowedReason | null;
  format: SourceFamily | null;
}

const QUARTO_FOLDERS = /(?:^|\/)(?:_extensions|_freeze|_book|_site|_manuscript)\//;
const PANDOC_TEMPLATE = /\$(?:body|if\(|for\()/;
const QUARTO_PROJECT_FILES = ["_quarto.yml", "_quarto.yaml"] as const;

interface FollowedRoot {
  readonly projectId: string;
  readonly root: string;
  readonly reason: FollowedReason;
}

let lastFormatRoot: FollowedRoot | null = null;

function sameFormat(family: SourceFamily | null, stored: SourceFamily | null): boolean {
  return family === stored || (stored === "quarto" && family === "markdown");
}

function formatOf(target: string, stored: string): SourceFamily | null {
  const family = documentFamily(target);
  return sameFormat(family, documentFamily(stored)) ? null : family;
}

function partOfAnotherDocument(projectId: string, path: string): boolean {
  const parts = useCompileRootStore.getState().parts;
  return parts?.projectId === projectId && parts.files.has(path);
}

function keptLatexRoot(projectId: string, path: string): string | null {
  const kept = lastFormatRoot;
  const known = useCompileRootStore.getState().latexUnits;
  if (kept?.projectId !== projectId || known?.projectId !== projectId) return null;
  if (documentFamily(kept.root) !== "latex") return null;
  return rootsReaching(known.units, path).includes(kept.root) ? kept.root : null;
}

function formatRoot(files: FilesState, projectId: string, path: string, stored: string): string | null {
  const format = formatOf(path, stored);
  if (format === null || QUARTO_FOLDERS.test(path)) return null;
  if (!treeHasFile(files.tree, path) || isRepositoryNote(path)) return null;
  const text = files.files[path]?.content;
  const template = (format === "latex" || format === "typst") && text !== undefined && PANDOC_TEMPLATE.test(text);
  if (format !== "latex") return template || partOfAnotherDocument(projectId, path) ? null : path;
  if (text === undefined || template || parseTexMagicComments(text).root !== null) return null;
  return isCompleteDocument(text) ? path : keptLatexRoot(projectId, path);
}

export function insideQuartoProject(tree: FilesState["tree"], path: string): boolean {
  const folders = path.split("/").slice(0, -1);
  for (let depth = folders.length; depth >= 0; depth--) {
    const folder = folders.slice(0, depth).join("/");
    const inFolder = (name: string) => (folder ? `${folder}/${name}` : name);
    if (QUARTO_PROJECT_FILES.some((name) => treeHasFile(tree, inFolder(name)))) return true;
  }
  return false;
}

function standaloneRoot(files: FilesState, projectId: string, path: string, stored: string): string | null {
  const family = documentFamily(path);
  if (path === stored || family === null || family === "latex") return null;
  if (!sameFormat(family, documentFamily(stored))) return null;
  if (QUARTO_FOLDERS.test(path) || !treeHasFile(files.tree, path) || isRepositoryNote(path)) return null;
  const parts = useCompileRootStore.getState().parts;
  const known = parts?.projectId === projectId ? parts.files : null;
  if (known?.has(path)) return null;
  if (family === "typst" ? known === null : basename(path).startsWith("_") || insideQuartoProject(files.tree, path)) {
    return null;
  }
  const text = files.files[path]?.content;
  if (family === "typst" && (text === undefined || PANDOC_TEMPLATE.test(text))) return null;
  return path;
}

function followedRootFor(files: FilesState, projectId: string, path: string, stored: string): FollowedRoot | null {
  const format = formatRoot(files, projectId, path, stored);
  if (format !== null) return { projectId, root: format, reason: "format" };
  const standalone = standaloneRoot(files, projectId, path, stored);
  return standalone === null ? null : { projectId, root: standalone, reason: "standalone" };
}

function keptFormatRoot(files: FilesState, projectId: string): FollowedRoot | null {
  const kept = lastFormatRoot;
  if (kept?.projectId !== projectId || !files.openTabs.includes(kept.root)) return null;
  return treeHasFile(files.tree, kept.root) ? kept : null;
}

export function resolveCompileTarget(): CompileTarget {
  const effective = resolveEffectiveMainDoc();
  const files = useFilesStore.getState();
  const { projectId, activePath } = files;
  const stored = files.mainDoc || "main.tex";
  if (!projectId || !useCompileRootStore.getState().followOpenFile) {
    lastFormatRoot = null;
    return { ...effective, format: projectId ? formatOf(effective.mainDoc, stored) : null };
  }
  const followed =
    activePath && documentFamily(activePath) !== null
      ? followedRootFor(files, projectId, activePath, stored)
      : keptFormatRoot(files, projectId);
  lastFormatRoot = followed;
  if (followed === null) return { ...effective, format: formatOf(effective.mainDoc, stored) };
  const { root, reason } = followed;
  return { mainDoc: root, overriddenBy: root, reason, brokenRoot: null, format: formatOf(root, stored) };
}

export function effectiveMainDocMissing(root: Pick<EffectiveMainDoc, "mainDoc"> = resolveEffectiveMainDoc()): boolean {
  const { projectId, manifestHome, tree } = useFilesStore.getState();
  return mainDocumentMissing({ projectId, manifestHome, tree, mainDoc: root.mainDoc });
}

export function useEffectiveMainDoc<T>(pick: (root: EffectiveMainDoc) => T): T {
  useCompileRootStore((state) => state.followOpenFile);
  useCompileRootStore((state) => state.latexUnits);
  return useFilesStore(useShallow(() => pick(resolveEffectiveMainDoc())));
}

export function useCompileTarget<T>(pick: (target: CompileTarget) => T): T {
  useCompileRootStore((state) => state.followOpenFile);
  useCompileRootStore((state) => state.latexUnits);
  useCompileRootStore((state) => state.parts);
  return useFilesStore(useShallow(() => pick(resolveCompileTarget())));
}
