import type { FileEntry } from "@oleafly/backend-port";
import type { AssetUnavailable } from "@oleafly/wysiwyg";
import { type AssetThumbnail, readAssetThumbnail } from "@/components/editor/cm/hover-asset";
import { isImagePath } from "@/lib/image-mime";
import { logError } from "@/lib/log";
import { dirname } from "@/lib/path-utils";
import { useFilesStore } from "@/store/files";

const IMPLICIT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".pdf"];
const OUTSIDE_PROJECT = /^(?:[a-z]:\/|~(?:\/|$)|\/\/|file:)/iu;

export interface AssetLookupContext {
  activePath: string | null;
  mainDoc: string;
}

export interface ResolvedVisualAsset {
  url: string;
  path: string;
}

export interface AssetCandidates {
  readonly paths: readonly string[];
  readonly outside: boolean;
}

type VisualAssetLookup = ResolvedVisualAsset | AssetUnavailable | null;

interface ResolverCache {
  projectId: string | null;
  tree: readonly FileEntry[] | null;
  entries: Map<string, Promise<VisualAssetLookup>>;
}

const cache: ResolverCache = { projectId: null, tree: null, entries: new Map() };
const reported = new WeakSet<AssetThumbnail>();

function normalizeSegments(path: string): string[] | null {
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") segments.push(part);
    else if (segments.pop() === undefined) return null;
  }
  return segments;
}

function addCandidates(paths: string[], segments: readonly string[], extensions: readonly string[]): void {
  for (const extension of extensions) {
    const candidate = `${segments.join("/")}${extension}`;
    if (!paths.includes(candidate)) paths.push(candidate);
  }
}

export function assetCandidates(rawPath: string, context: AssetLookupContext): AssetCandidates {
  const path = rawPath.trim().replace(/^["']|["']$/gu, "").replaceAll("\\", "/");
  if (path === "") return { paths: [], outside: false };
  if (OUTSIDE_PROJECT.test(path)) return { paths: [], outside: true };
  const bases = [...new Set(["", dirname(context.mainDoc), context.activePath ? dirname(context.activePath) : ""])];
  const extensions = isImagePath(path, { allowPdf: true }) ? [""] : ["", ...IMPLICIT_EXTENSIONS];
  const paths: string[] = [];
  let escapes = false;
  for (const base of bases) {
    const segments = normalizeSegments(base === "" ? path : `${base}/${path}`);
    if (segments === null) escapes = true;
    if (segments?.length) addCandidates(paths, segments, extensions);
  }
  return { paths, outside: path.startsWith("/") || (escapes && paths.length === 0) };
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

function reportUnreadable(path: string, thumbnail: AssetThumbnail): void {
  if (thumbnail.error === undefined || reported.has(thumbnail)) return;
  reported.add(thumbnail);
  void logError(`show the image ${path}`, thumbnail.error);
}

function lookupVisualAsset(path: string): Promise<VisualAssetLookup> {
  const state = useFilesStore.getState();
  const projectId = state.projectId;
  if (!projectId) return Promise.resolve(null);
  syncCache(projectId, state.tree);
  const key = `${state.activePath ?? ""}\0${path}`;
  const cached = cache.entries.get(key);
  if (cached) return cached;
  const known = new Set(state.tree.filter((entry) => !entry.is_dir).map((entry) => entry.path));
  const folded = new Set([...known].map((entry) => entry.toLowerCase()));
  const candidates = assetCandidates(path, state);
  const lookup = (async (): Promise<VisualAssetLookup> => {
    let unreadable = false;
    for (const candidate of candidates.paths) {
      const exact = known.has(candidate);
      if (!exact && !folded.has(candidate.toLowerCase())) continue;
      // Read the requested spelling, not a lowercased tree entry. The actual
      // filesystem decides whether it is an alias (including Windows folders
      // configured to be case-sensitive).
      const thumbnail = await readAssetThumbnail(projectId, candidate);
      if (thumbnail.url !== null) return { url: thumbnail.url, path: candidate };
      if (!exact) continue;
      unreadable = true;
      reportUnreadable(candidate, thumbnail);
    }
    if (unreadable) return { reason: "unreadable" };
    return candidates.outside ? { reason: "outside" } : null;
  })();
  cache.entries.set(key, lookup);
  return lookup;
}

export function resolveVisualAsset(path: string): Promise<ResolvedVisualAsset | null> {
  return lookupVisualAsset(path).then((found) => (found && "url" in found ? found : null));
}

export function resolveVisualAssetUrl(path: string): Promise<string | AssetUnavailable | null> {
  return lookupVisualAsset(path).then((found) => (found && "url" in found ? found.url : found));
}
