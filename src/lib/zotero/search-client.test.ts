import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroHit } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("@/lib/tauri", () => ({ zoteroLibrarySearch: mocks.search }));

import {
  cachedZoteroSearch,
  matchesZoteroQuery,
  resetZoteroSearchCache,
  searchZoteroLibrary,
} from "./search-client";

function hit(citationKey: string, authors: string[], title: string, year?: string): ZoteroHit {
  return {
    library: "user",
    itemKey: citationKey.toUpperCase().slice(0, 8),
    citationKey,
    keySource: "bbt",
    title,
    authors,
    authorCount: authors.length,
    ...(year ? { year } : {}),
    itemType: "journalArticle",
    dateModified: "2024-01-01T00:00:00Z",
    score: 1,
  };
}

const HITS = [
  hit("smithDeep2020", ["Smith", "Doe"], "Deep learning", "2020"),
  hit("smileyFaces2019", ["Smiley"], "Faces", "2019"),
  hit("mullerAngstrom2021", ["Müller"], "Ångström imaging", "2021"),
];

beforeEach(() => {
  resetZoteroSearchCache();
  mocks.search.mockReset();
  mocks.search.mockImplementation(async (query: string) => ({
    generation: 1,
    total: HITS.length,
    hits: HITS.filter((candidate) => matchesZoteroQuery(candidate, query)),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Zotero search cache", () => {
  it("answers a repeated query from memory", async () => {
    expect(cachedZoteroSearch("smi", 1)).toBeNull();
    const first = await searchZoteroLibrary("smi", { generation: 1, delayMs: 0 });
    expect(first.hits.map((candidate) => candidate.citationKey)).toEqual(["smithDeep2020", "smileyFaces2019"]);
    expect(cachedZoteroSearch(" SMI ", 1)?.hits).toHaveLength(2);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it("narrows a complete result without another round trip", async () => {
    mocks.search.mockResolvedValueOnce({ generation: 1, total: 2, hits: HITS.slice(0, 2) });
    await searchZoteroLibrary("smi", { generation: 1, delayMs: 0 });
    const narrowed = cachedZoteroSearch("smith", 1);
    expect(narrowed?.hits.map((candidate) => candidate.citationKey)).toEqual(["smithDeep2020"]);
    expect(cachedZoteroSearch("smi 2019", 1)?.hits.map((candidate) => candidate.citationKey)).toEqual(["smileyFaces2019"]);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it("does not narrow a truncated result", async () => {
    mocks.search.mockResolvedValueOnce({ generation: 1, total: 900, hits: HITS.slice(0, 2) });
    await searchZoteroLibrary("s", { generation: 1, delayMs: 0 });
    expect(cachedZoteroSearch("smith", 1)).toBeNull();
  });

  it("drops cached results when the library changes", async () => {
    await searchZoteroLibrary("smi", { generation: 1, delayMs: 0 });
    expect(cachedZoteroSearch("smi", 2)).toBeNull();
  });

  it("shares one request between concurrent callers", async () => {
    const [left, right] = await Promise.all([
      searchZoteroLibrary("deep", { generation: 1, delayMs: 0 }),
      searchZoteroLibrary("deep", { generation: 1, delayMs: 0 }),
    ]);
    expect(left).toBe(right);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending search before it reaches Rust", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = searchZoteroLibrary("deep", { generation: 1, delayMs: 40, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("keeps the cache bounded", async () => {
    for (let index = 0; index < 80; index++) {
      await searchZoteroLibrary(`q${index}`, { generation: 1, delayMs: 0 });
    }
    expect(cachedZoteroSearch("q0", 1)).toBeNull();
    expect(cachedZoteroSearch("q79", 1)).not.toBeNull();
  });

  it("matches surnames, title words, years and keys with accents folded", () => {
    expect(matchesZoteroQuery(HITS[2], "muller")).toBe(true);
    expect(matchesZoteroQuery(HITS[2], "angstrom 2021")).toBe(true);
    expect(matchesZoteroQuery(HITS[2], "angstrom 2020")).toBe(false);
    expect(matchesZoteroQuery(HITS[0], "@smithdeep")).toBe(true);
    expect(matchesZoteroQuery(HITS[0], "learn")).toBe(true);
  });

  it("matches the words of a rich-text title, not its markup", async () => {
    const rich = hit("wasserstein2016", ["Wasserstein"], 'The <span class="nocase">ASA</span> Statement on <i>p</i>-Values &amp; Purpose', "2016");
    expect(matchesZoteroQuery(rich, "asa statement")).toBe(true);
    expect(matchesZoteroQuery(rich, "values purpose")).toBe(true);
    expect(matchesZoteroQuery(rich, "nocase")).toBe(false);
    expect(matchesZoteroQuery(rich, "span")).toBe(false);
    expect(matchesZoteroQuery(rich, "amp")).toBe(false);
    mocks.search.mockResolvedValueOnce({ generation: 1, total: 1, hits: [rich] });
    await searchZoteroLibrary("wa", { generation: 1, delayMs: 0 });
    expect(cachedZoteroSearch("wa nocase", 1)?.hits).toEqual([]);
    expect(cachedZoteroSearch("wa statement", 1)?.hits.map((candidate) => candidate.citationKey)).toEqual(["wasserstein2016"]);
  });
});
