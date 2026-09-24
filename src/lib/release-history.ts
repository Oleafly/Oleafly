import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ReleaseEntry {
  version: string;
  publishedAt: string | null;
  body: string;
  url: string;
}

export interface ReleasePage {
  entries: ReleaseEntry[];
  more: boolean;
}

export type ReleasePageFetcher = (page: number) => Promise<ReleasePage>;

export type ReleaseHistoryStatus = "idle" | "loading" | "error" | "done";

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export function stableVersionOf(tag: string): string | null {
  const match = STABLE_TAG.exec(tag.trim());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

interface GithubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
}

export function releaseEntriesFrom(payload: unknown): ReleaseEntry[] {
  if (!Array.isArray(payload)) return [];
  const entries: ReleaseEntry[] = [];
  for (const item of payload as GithubRelease[]) {
    if (!item || item.draft === true || item.prerelease === true) continue;
    if (typeof item.tag_name !== "string") continue;
    const version = stableVersionOf(item.tag_name);
    if (!version) continue;
    entries.push({
      version,
      publishedAt: typeof item.published_at === "string" ? item.published_at : null,
      body: typeof item.body === "string" ? item.body : "",
      url: typeof item.html_url === "string" ? item.html_url : `https://github.com/Oleafly/Oleafly/releases/tag/v${version}`,
    });
  }
  return entries;
}

export const RELEASE_PAGE_CACHE_MS = 10 * 60 * 1000;
const pageCache = new Map<number, { at: number; page: ReleasePage }>();

export function clearReleasePageCache(): void {
  pageCache.clear();
}

export const tauriReleasePageFetcher: ReleasePageFetcher = async (page) => {
  const cached = pageCache.get(page);
  if (cached && Date.now() - cached.at < RELEASE_PAGE_CACHE_MS) return cached.page;
  const payload = await invoke<unknown>("release_notes_page", { page });
  const result = { entries: releaseEntriesFrom(payload), more: Array.isArray(payload) && payload.length > 0 };
  pageCache.set(page, { at: Date.now(), page: result });
  return result;
};

export interface ReleaseHistory {
  entries: ReleaseEntry[];
  status: ReleaseHistoryStatus;
  loadMore: () => void;
  retry: () => void;
}

export function useReleaseHistory({
  newerThan,
  olderThan,
  fetchPage,
  enabled,
}: Readonly<{
  newerThan?: string;
  olderThan?: string;
  fetchPage: ReleasePageFetcher;
  enabled: boolean;
}>): ReleaseHistory {
  const active = enabled;
  const key = `${active}|${newerThan ?? ""}|${olderThan ?? ""}`;
  const [entries, setEntries] = useState<ReleaseEntry[]>([]);
  const [status, setStatus] = useState<ReleaseHistoryStatus>(active ? "idle" : "done");
  const buffer = useRef<ReleaseEntry[]>([]);
  const nextPage = useRef(1);
  const exhausted = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const appliedKey = useRef(key);

  useEffect(() => {
    if (appliedKey.current === key) return;
    appliedKey.current = key;
    generation.current += 1;
    buffer.current = [];
    nextPage.current = 1;
    exhausted.current = false;
    busy.current = false;
    setEntries([]);
    setStatus(active ? "idle" : "done");
  }, [active, key]);

  const revealNext = useCallback(() => {
    const next = buffer.current.shift();
    if (next) setEntries((current) => [...current, next]);
    setStatus(buffer.current.length === 0 && exhausted.current ? "done" : "idle");
    return Boolean(next);
  }, []);

  const loadMore = useCallback(() => {
    if (!active || busy.current) return;
    if (buffer.current.length > 0) {
      revealNext();
      return;
    }
    if (exhausted.current) {
      setStatus("done");
      return;
    }
    busy.current = true;
    const run = generation.current;
    setStatus("loading");
    const page = nextPage.current;
    void fetchPage(page)
      .then((result) => {
        if (run !== generation.current) return;
        nextPage.current = page + 1;
        if (!result.more) exhausted.current = true;
        for (const entry of result.entries) {
          if (newerThan && compareVersions(entry.version, newerThan) <= 0) {
            exhausted.current = true;
            break;
          }
          if (!olderThan || compareVersions(entry.version, olderThan) < 0) buffer.current.push(entry);
        }
        busy.current = false;
        if (!revealNext() && !exhausted.current) {
          setStatus("idle");
          loadMore();
        }
      })
      .catch(() => {
        if (run !== generation.current) return;
        busy.current = false;
        setStatus("error");
      });
  }, [active, fetchPage, newerThan, olderThan, revealNext]);

  const retry = useCallback(() => {
    if (status === "error") {
      setStatus("idle");
      loadMore();
    }
  }, [loadMore, status]);

  return { entries, status, loadMore, retry };
}
