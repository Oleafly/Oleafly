import { useShallow } from "zustand/react/shallow";
import { mainDocumentMissing, treeHasFile } from "@/lib/main-document";
import { isLibraryProject } from "@/lib/project-location";
import { resolveProjectPath } from "@/lib/project-intelligence/source";
import type { LatexUnits } from "@/lib/project-intelligence/types";
import { parseTexMagicComments } from "@/lib/tex-magic-comments";
import { useCompileRootStore } from "@/store/compile-root";
import { useFilesStore } from "@/store/files";

export type BrokenTexRootReason = "missing" | "not_tex";

export type TexRootReason = "magic" | "document" | "include";

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

export function effectiveMainDocMissing(root: EffectiveMainDoc = resolveEffectiveMainDoc()): boolean {
  const { projectId, manifestHome, tree } = useFilesStore.getState();
  return mainDocumentMissing({ projectId, manifestHome, tree, mainDoc: root.mainDoc });
}

export function useEffectiveMainDoc<T>(pick: (root: EffectiveMainDoc) => T): T {
  useCompileRootStore((state) => state.followOpenFile);
  useCompileRootStore((state) => state.latexUnits);
  return useFilesStore(useShallow(() => pick(resolveEffectiveMainDoc())));
}
