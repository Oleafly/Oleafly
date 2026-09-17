import type { FileEntry } from "@oleafly/backend-port";
import { loadAssetThumbnail, THUMBNAIL_TARGET_RE } from "@/components/editor/cm/hover-asset";
import { dirname } from "@/lib/project-intelligence/source";
import { useFilesStore } from "@/store/files";

const IMPLICIT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".pdf"];

export interface AssetLookupContext {
  activePath: string | null;
  mainDoc: string;
}

interface ResolverCache {
  projectId: string | null;
  tree: readonly FileEntry[] | null;
  entries: Map<string, Promise<string | null>>;
}

const cache: ResolverCache = { projectId: null, tree: null, entries: new Map() };

function normalizeSegments(path: string): string[] {
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments;
}

function joined(base: string, path: string): string {
  return normalizeSegments(base === "" ? path : `${base}/${path}`).join("/");
}

export function candidateAssetPaths(rawPath: string, context: AssetLookupContext): string[] {
  const path = rawPath.trim().replace(/^["']|["']$/gu, "").replaceAll("\\", "/");
  if (path === "") return [];
  const bases = [...new Set(["", dirname(context.mainDoc), context.activePath ? dirname(context.activePath) : ""])];
  const extensions = THUMBNAIL_TARGET_RE.test(path) ? [""] : ["", ...IMPLICIT_EXTENSIONS];
  const candidates: string[] = [];
  for (const base of bases) {
    for (const extension of extensions) {
      const candidate = joined(base, `${path}${extension}`);
      if (candidate !== "" && !candidates.includes(candidate)) candidates.push(candidate);
    }
  }
  return candidates;
}

export function clearVisualAssetCache(): void {
  cache.entries.clear();
  cache.tree = null;
}

function syncCache(projectId: string, tree: readonly FileEntry[]): void {
  if (cache.projectId === projectId && cache.tree === tree) return;
  cache.projectId = projectId;
  cache.tree = tree;
  cache.entries.clear();
}

export function resolveVisualAssetUrl(path: string): Promise<string | null> {
  const state = useFilesStore.getState();
  const projectId = state.projectId;
  if (!projectId) return Promise.resolve(null);
  syncCache(projectId, state.tree);
  const key = `${state.activePath ?? ""}\0${path}`;
  const cached = cache.entries.get(key);
  if (cached) return cached;
  const known = new Set(state.tree.filter((entry) => !entry.is_dir).map((entry) => entry.path));
  const candidate = candidateAssetPaths(path, state).find((option) => known.has(option)) ?? null;
  const resolved = candidate ? loadAssetThumbnail(projectId, candidate) : Promise.resolve(null);
  cache.entries.set(key, resolved);
  return resolved;
}
