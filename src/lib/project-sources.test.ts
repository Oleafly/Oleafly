import fs from "node:fs";
import path from "node:path";
import type {
  ProjectSourcesRequest,
  ProjectSourcesResult,
} from "@oleafly/backend-port";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BatchBinding = (
  projectId: string,
  request: ProjectSourcesRequest,
) => Promise<ProjectSourcesResult>;

const bridge = vi.hoisted(() => ({
  readFileContent: vi.fn<(projectId: string, path: string) => Promise<string>>(),
  batch: undefined as BatchBinding | undefined,
}));

vi.mock("@/lib/tauri", () => {
  const module: Record<string, unknown> = {
    readFileContent: (projectId: string, filePath: string) =>
      bridge.readFileContent(projectId, filePath),
  };
  Object.defineProperty(module, "readProjectSourcesBatch", {
    enumerable: true,
    get: () => bridge.batch,
  });
  return module;
});

import {
  normalizeSourceText,
  projectSourcesBatchStats,
  projectSourcesCacheSize,
  readProjectSourcesBatch,
  resetProjectSourcesBatchStats,
  resetProjectSourcesCache,
} from "./project-sources";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

function fnv1a64Hex(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

interface FakeDisk {
  files: Map<string, Uint8Array>;
  calls: ProjectSourcesRequest[];
  responseCharacters: number;
  requestCharacters: number;
}

function fakeDisk(entries: Record<string, string | Uint8Array>): FakeDisk {
  const files = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(entries)) {
    files.set(
      key,
      typeof value === "string" ? new TextEncoder().encode(value) : value,
    );
  }
  return { files, calls: [], responseCharacters: 0, requestCharacters: 0 };
}

function decodeLossy(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

const hashCache = new WeakMap<Uint8Array, string>();

function cachedHash(bytes: Uint8Array): string {
  let hash = hashCache.get(bytes);
  if (hash === undefined) {
    hash = fnv1a64Hex(bytes);
    hashCache.set(bytes, hash);
  }
  return hash;
}

function simulateCommand(disk: FakeDisk): BatchBinding {
  return async (_projectId, request) => {
    disk.calls.push(request);
    disk.requestCharacters += JSON.stringify(request).length;
    const known = new Map(request.known.map((k) => [k.path, k.hash]));
    const result: ProjectSourcesResult = {
      files: [],
      unchanged: [],
      unreadable: [],
      truncated: false,
    };
    const paths = [...new Set(request.paths)].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const filePath of paths) {
      const bytes = disk.files.get(filePath);
      if (!bytes) {
        result.unreadable.push({
          path: filePath,
          message: `${filePath} could not be read: No such file or directory (os error 2).`,
        });
        continue;
      }
      const hash = cachedHash(bytes);
      if (known.get(filePath) === hash) {
        result.unchanged.push(filePath);
      } else {
        result.files.push({ path: filePath, hash, text: decodeLossy(bytes) });
      }
    }
    const json = JSON.stringify(result);
    disk.responseCharacters += json.length;
    return JSON.parse(json) as ProjectSourcesResult;
  };
}

function mountFallback(disk: FakeDisk): void {
  bridge.readFileContent.mockImplementation(async (_projectId, filePath) => {
    const bytes = disk.files.get(filePath);
    if (!bytes) throw new Error(`failed to read ${filePath}`);
    return decodeLossy(bytes);
  });
}

async function legacyReadProjectSources(
  projectId: string,
  paths: readonly string[],
): Promise<{ texts: Record<string, string>; unreadable: Set<string> }> {
  const texts: Record<string, string> = {};
  const unreadable = new Set<string>();
  let cursor = 0;
  const readers = Array.from(
    { length: Math.min(8, Math.max(1, paths.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= paths.length) return;
        const filePath = paths[index];
        try {
          texts[filePath] = await bridge.readFileContent(projectId, filePath);
        } catch {
          unreadable.add(filePath);
        }
      }
    },
  );
  await Promise.all(readers);
  return { texts, unreadable };
}

const SEED_ROOT = path.resolve(
  __dirname,
  "../../fixtures/research-seeds/computational-physics-phd-thesis",
);
const INDEXABLE = /\.(tex|bib|md|typ|sty|cls)$/u;

function walk(root: string, out: string[]): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function loadSeedThesis(): Record<string, Uint8Array> {
  const files: string[] = [];
  walk(SEED_ROOT, files);
  const out: Record<string, Uint8Array> = {};
  for (const full of files) {
    const rel = path.relative(SEED_ROOT, full).split(path.sep).join("/");
    if (!INDEXABLE.test(rel)) continue;
    out[rel] = new Uint8Array(fs.readFileSync(full));
  }
  return out;
}

function scaledThesis(copies: number): Record<string, Uint8Array> {
  const base = loadSeedThesis();
  const out: Record<string, Uint8Array> = {};
  for (const [rel, bytes] of Object.entries(base)) {
    const scalable =
      rel.startsWith("chapters/") || rel.startsWith("appendices/");
    const count = scalable ? copies : 1;
    for (let copy = 0; copy < count; copy++) {
      const target =
        copy === 0 ? rel : rel.replace(/\.tex$/u, `-${copy}.tex`);
      out[target] = bytes;
    }
  }
  return out;
}

beforeEach(() => {
  resetProjectSourcesCache();
  resetProjectSourcesBatchStats();
  bridge.batch = undefined;
  bridge.readFileContent.mockReset();
});

afterEach(() => {
  bridge.batch = undefined;
});

describe("fnv1a64Hex", () => {
  it("matches the vectors the Rust command is tested against", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(fnv1a64Hex(encode(""))).toBe("cbf29ce484222325");
    expect(fnv1a64Hex(encode("a"))).toBe("af63dc4c8601ec8c");
    expect(fnv1a64Hex(encode("foobar"))).toBe("85944171f73967e8");
  });
});

describe("readProjectSourcesBatch with the batch command available", () => {
  it("sends no known hashes on a cache miss and stores what comes back", async () => {
    const disk = fakeDisk({ "main.tex": "\\section{A}", "refs.bib": "@x{}" });
    bridge.batch = simulateCommand(disk);
    const result = await readProjectSourcesBatch("p", ["main.tex", "refs.bib"]);
    expect(result.texts).toEqual({ "main.tex": "\\section{A}", "refs.bib": "@x{}" });
    expect(result.unreadable.size).toBe(0);
    expect(disk.calls).toHaveLength(1);
    expect(disk.calls[0].known).toEqual([]);
    expect(projectSourcesCacheSize()).toBe(2);
    expect(bridge.readFileContent).not.toHaveBeenCalled();
    expect(projectSourcesBatchStats().invokes).toBe(1);
  });

  it("serves a cache hit from memory and ships no text", async () => {
    const disk = fakeDisk({ "main.tex": "\\section{A}", "refs.bib": "@x{}" });
    bridge.batch = simulateCommand(disk);
    await readProjectSourcesBatch("p", ["main.tex", "refs.bib"]);
    const before = projectSourcesBatchStats().transferredCharacters;
    const result = await readProjectSourcesBatch("p", ["main.tex", "refs.bib"]);
    expect(result.texts).toEqual({ "main.tex": "\\section{A}", "refs.bib": "@x{}" });
    expect(disk.calls[1].known).toEqual([
      { path: "main.tex", hash: fnv1a64Hex(new TextEncoder().encode("\\section{A}")) },
      { path: "refs.bib", hash: fnv1a64Hex(new TextEncoder().encode("@x{}")) },
    ]);
    expect(projectSourcesBatchStats().transferredCharacters).toBe(before);
    expect(projectSourcesBatchStats().invokes).toBe(2);
  });

  it("ships only the file that changed on disk", async () => {
    const disk = fakeDisk({ "main.tex": "one", "refs.bib": "@x{}" });
    bridge.batch = simulateCommand(disk);
    await readProjectSourcesBatch("p", ["main.tex", "refs.bib"]);
    disk.files.set("main.tex", new TextEncoder().encode("two"));
    const before = projectSourcesBatchStats().transferredCharacters;
    const result = await readProjectSourcesBatch("p", ["main.tex", "refs.bib"]);
    expect(result.texts).toEqual({ "main.tex": "two", "refs.bib": "@x{}" });
    expect(projectSourcesBatchStats().transferredCharacters - before).toBe(3);
  });

  it("normalizes CRLF like the editor store and keeps the backend hash as the known hash", async () => {
    const raw = "line one\r\nline two\rline three";
    const disk = fakeDisk({ "main.tex": raw });
    bridge.batch = simulateCommand(disk);
    const result = await readProjectSourcesBatch("p", ["main.tex"]);
    expect(result.texts["main.tex"]).toBe("line one\nline two\nline three");
    expect(normalizeSourceText(raw)).toBe(result.texts["main.tex"]);
    const second = await readProjectSourcesBatch("p", ["main.tex"]);
    expect(second.texts["main.tex"]).toBe("line one\nline two\nline three");
    expect(disk.calls[1].known).toEqual([
      { path: "main.tex", hash: fnv1a64Hex(new TextEncoder().encode(raw)) },
    ]);
    expect(disk.calls[1].known[0].hash).not.toBe(
      fnv1a64Hex(new TextEncoder().encode(result.texts["main.tex"])),
    );
  });

  it("forgets everything after a reset and after switching projects", async () => {
    const disk = fakeDisk({ "main.tex": "x" });
    bridge.batch = simulateCommand(disk);
    await readProjectSourcesBatch("p", ["main.tex"]);
    resetProjectSourcesCache("other");
    expect(projectSourcesCacheSize()).toBe(1);
    resetProjectSourcesCache("p");
    expect(projectSourcesCacheSize()).toBe(0);
    await readProjectSourcesBatch("p", ["main.tex"]);
    expect(disk.calls[1].known).toEqual([]);
    await readProjectSourcesBatch("q", ["main.tex"]);
    expect(disk.calls[2].known).toEqual([]);
    resetProjectSourcesCache();
    expect(projectSourcesCacheSize()).toBe(0);
  });

  it("maps unreadable files to the unreadable set and drops them from the cache", async () => {
    const disk = fakeDisk({ "main.tex": "x", "gone.tex": "y" });
    bridge.batch = simulateCommand(disk);
    await readProjectSourcesBatch("p", ["main.tex", "gone.tex"]);
    disk.files.delete("gone.tex");
    const result = await readProjectSourcesBatch("p", ["main.tex", "gone.tex"]);
    expect(result.texts).toEqual({ "main.tex": "x" });
    expect([...result.unreadable]).toEqual(["gone.tex"]);
    expect(projectSourcesCacheSize()).toBe(1);
    expect(bridge.readFileContent).not.toHaveBeenCalled();
  });

  it("does not invoke at all for an empty path list and dedupes repeated paths", async () => {
    const disk = fakeDisk({ "main.tex": "x" });
    bridge.batch = simulateCommand(disk);
    const empty = await readProjectSourcesBatch("p", []);
    expect(empty.texts).toEqual({});
    expect(disk.calls).toHaveLength(0);
    await readProjectSourcesBatch("p", ["main.tex", "main.tex"]);
    expect(disk.calls[0].paths).toEqual(["main.tex"]);
  });

  it("falls back to single reads when the batch command rejects", async () => {
    const disk = fakeDisk({ "main.tex": "x", "refs.bib": "y\r\n" });
    mountFallback(disk);
    bridge.batch = async () => {
      throw new Error("Checkpoint recovery is pending for this project.");
    };
    const result = await readProjectSourcesBatch("p", ["main.tex", "refs.bib", "gone.tex"]);
    expect(result.texts).toEqual({ "main.tex": "x", "refs.bib": "y\n" });
    expect([...result.unreadable]).toEqual(["gone.tex"]);
    expect(bridge.readFileContent).toHaveBeenCalledTimes(3);
    expect(projectSourcesBatchStats().fallbackReads).toBe(3);
  });

  it("reads oversized files through the per-file path instead of marking them unreadable", async () => {
    const big = "x".repeat(4096);
    const disk = fakeDisk({ "main.tex": "small", "big.tex": "was small" });
    mountFallback(disk);
    bridge.batch = simulateCommand(disk);
    await readProjectSourcesBatch("p", ["main.tex", "big.tex"]);
    expect(projectSourcesCacheSize()).toBe(2);

    disk.files.set("big.tex", new TextEncoder().encode(big));
    const simulated = simulateCommand(disk);
    bridge.batch = async (projectId, request) => {
      const result = await simulated(projectId, request);
      result.files = result.files.filter((file) => file.path !== "big.tex");
      result.oversized = ["big.tex"];
      result.truncated = true;
      return result;
    };
    const result = await readProjectSourcesBatch("p", ["main.tex", "big.tex"]);
    expect(result.texts).toEqual({ "main.tex": "small", "big.tex": big });
    expect(result.unreadable.size).toBe(0);
    expect(bridge.readFileContent).toHaveBeenCalledTimes(1);
    expect(bridge.readFileContent).toHaveBeenCalledWith("p", "big.tex");
    expect(projectSourcesBatchStats().fallbackReads).toBe(1);
    expect(projectSourcesCacheSize()).toBe(1);
    expect(disk.calls[1].known.map((k) => k.path)).toEqual(["main.tex", "big.tex"]);

    const again = await readProjectSourcesBatch("p", ["main.tex", "big.tex"]);
    expect(again.texts["big.tex"]).toBe(big);
    expect(disk.calls[2].known.map((k) => k.path)).toEqual(["main.tex"]);
    expect(bridge.readFileContent).toHaveBeenCalledTimes(2);
  });

  it("re-reads a path the backend calls unchanged when the cache has no copy", async () => {
    const disk = fakeDisk({ "main.tex": "x" });
    mountFallback(disk);
    bridge.batch = async (_projectId, request) => ({
      files: [],
      unchanged: [...request.paths],
      unreadable: [],
      truncated: false,
    });
    const result = await readProjectSourcesBatch("p", ["main.tex"]);
    expect(result.texts).toEqual({ "main.tex": "x" });
    expect(bridge.readFileContent).toHaveBeenCalledTimes(1);
  });
});

describe("readProjectSourcesBatch without the batch command", () => {
  it("reads every path through read_file with the same normalization", async () => {
    const disk = fakeDisk({ "main.tex": "a\r\nb", "gone.tex": "z" });
    disk.files.delete("gone.tex");
    mountFallback(disk);
    const result = await readProjectSourcesBatch("p", ["main.tex", "gone.tex"]);
    expect(result.texts).toEqual({ "main.tex": "a\nb" });
    expect([...result.unreadable]).toEqual(["gone.tex"]);
    expect(bridge.readFileContent).toHaveBeenCalledTimes(2);
    expect(projectSourcesBatchStats().invokes).toBe(0);
  });
});

describe("parity with the per-file implementation", () => {
  it("produces identical texts and unreadable sets on the seed thesis, cold and warm", async () => {
    const seed = loadSeedThesis();
    const paths = Object.keys(seed).sort();
    expect(paths.length).toBeGreaterThanOrEqual(10);
    for (const bytes of Object.values(seed)) {
      expect(decodeLossy(bytes)).not.toContain("\r");
    }
    const disk = fakeDisk({ ...seed, "phantom.tex": "" });
    disk.files.delete("phantom.tex");
    const requested = [...paths, "phantom.tex"];
    mountFallback(disk);
    const legacy = await legacyReadProjectSources("p", requested);

    bridge.batch = simulateCommand(disk);
    const cold = await readProjectSourcesBatch("p", requested);
    expect(cold.texts).toEqual(legacy.texts);
    expect([...cold.unreadable]).toEqual([...legacy.unreadable]);

    const warm = await readProjectSourcesBatch("p", requested);
    expect(warm.texts).toEqual(legacy.texts);
    expect([...warm.unreadable]).toEqual([...legacy.unreadable]);
    expect(disk.calls[1].known).toHaveLength(paths.length);
  });

  it("differs from the per-file implementation only by CRLF normalization", async () => {
    const disk = fakeDisk({ "main.tex": "a\r\nb\rc\n" });
    mountFallback(disk);
    const legacy = await legacyReadProjectSources("p", ["main.tex"]);
    bridge.batch = simulateCommand(disk);
    const batch = await readProjectSourcesBatch("p", ["main.tex"]);
    expect(legacy.texts["main.tex"]).toBe("a\r\nb\rc\n");
    expect(batch.texts["main.tex"]).toBe(normalizeSourceText(legacy.texts["main.tex"]));
  });
});

describe("timing on the audit corpus", () => {
  it("replaces 261 round trips with one and ships no text when nothing changed", async () => {
    const corpus = scaledThesis(32);
    const paths = Object.keys(corpus).sort();
    expect(paths).toHaveLength(261);
    const disk = fakeDisk(corpus);
    const roundTrip = async <T>(value: T): Promise<T> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return JSON.parse(JSON.stringify(value)) as T;
    };
    let legacyInvokes = 0;
    let legacyCharacters = 0;
    bridge.readFileContent.mockImplementation(async (_projectId, filePath) => {
      legacyInvokes += 1;
      const text = await roundTrip(decodeLossy(disk.files.get(filePath) ?? new Uint8Array()));
      legacyCharacters += JSON.stringify(text).length;
      return text;
    });
    const simulated = simulateCommand(disk);
    bridge.batch = async (projectId, request) => roundTrip(await simulated(projectId, request));

    const median = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const time = async (fn: () => Promise<unknown>, runs: number) => {
      const samples: number[] = [];
      for (let i = 0; i < runs; i++) {
        const start = performance.now();
        await fn();
        samples.push(performance.now() - start);
      }
      return median(samples);
    };

    await legacyReadProjectSources("p", paths);
    const legacyRun = legacyInvokes;
    legacyInvokes = 0;
    legacyCharacters = 0;
    const legacyMs = await time(() => legacyReadProjectSources("p", paths), 5);
    const legacyPerRun = legacyInvokes / 5;
    const legacyCharsPerRun = legacyCharacters / 5;

    resetProjectSourcesCache();
    resetProjectSourcesBatchStats();
    const coldMs = await time(async () => {
      resetProjectSourcesCache();
      await readProjectSourcesBatch("p", paths);
    }, 5);
    const coldStats = projectSourcesBatchStats();
    const coldResponse = disk.responseCharacters / disk.calls.length;

    resetProjectSourcesBatchStats();
    disk.calls.length = 0;
    disk.responseCharacters = 0;
    disk.requestCharacters = 0;
    await readProjectSourcesBatch("p", paths);
    const primingCalls = disk.calls.length;
    const primingResponse = disk.responseCharacters;
    const primingRequest = disk.requestCharacters;
    resetProjectSourcesBatchStats();
    const warmMs = await time(() => readProjectSourcesBatch("p", paths), 10);
    const warmStats = projectSourcesBatchStats();
    const warmCalls = disk.calls.length - primingCalls;
    const warmResponse = (disk.responseCharacters - primingResponse) / warmCalls;
    const warmRequest = (disk.requestCharacters - primingRequest) / warmCalls;

    console.log(
      [
        `thesis-x32: ${paths.length} files`,
        `legacy per rebuild: ${legacyPerRun} invokes, ${Math.round(legacyCharsPerRun)} JSON chars, median ${legacyMs.toFixed(2)} ms (simulated 0 ms timer per round trip)`,
        `batch cold per rebuild: ${coldStats.invokes / 5} invoke, ${Math.round(coldResponse)} response JSON chars, median ${coldMs.toFixed(2)} ms`,
        `batch warm per rebuild: ${warmCalls / 10} invoke, ${Math.round(warmRequest)} request JSON chars, ${Math.round(warmResponse)} response JSON chars, ${warmStats.transferredCharacters} text chars, median ${warmMs.toFixed(2)} ms`,
      ].join("\n"),
    );

    expect(legacyRun).toBe(261);
    expect(legacyPerRun).toBe(261);
    expect(coldStats.invokes).toBe(5);
    expect(warmCalls).toBe(10);
    expect(warmStats.transferredCharacters).toBe(0);
    expect(warmStats.fallbackReads).toBe(0);
    expect(warmMs).toBeLessThan(legacyMs);
  });
});

describe("cache eviction under memory pressure", () => {
  const BIG = 4_000_000;

  function bigBinding(calls: ProjectSourcesRequest[]): BatchBinding {
    return async (_projectId, request) => {
      calls.push({ paths: [...request.paths], known: [...request.known] });
      const known = new Map(request.known.map((entry) => [entry.path, entry.hash]));
      const result: ProjectSourcesResult = {
        files: [],
        unchanged: [],
        unreadable: [],
        truncated: false,
      };
      for (const filePath of request.paths) {
        const hash = `hash-of-${filePath}`;
        if (known.get(filePath) === hash) result.unchanged.push(filePath);
        else result.files.push({ path: filePath, hash, text: "x".repeat(BIG) });
      }
      return result;
    };
  }

  it("drops the oldest entries once the requested set alone exceeds the budget", async () => {
    const calls: ProjectSourcesRequest[] = [];
    bridge.batch = bigBinding(calls);

    const result = await readProjectSourcesBatch("p", ["a.tex", "b.tex", "c.tex"]);

    expect(Object.keys(result.texts).sort()).toEqual(["a.tex", "b.tex", "c.tex"]);
    expect(result.texts["a.tex"]).toHaveLength(BIG);
    expect(projectSourcesCacheSize()).toBe(2);

    await readProjectSourcesBatch("p", ["a.tex", "b.tex", "c.tex"]);

    expect(calls[1].known.map((entry) => entry.path)).toEqual(["b.tex", "c.tex"]);
  });

  it("drops everything outside the requested set before trimming further", async () => {
    const calls: ProjectSourcesRequest[] = [];
    bridge.batch = bigBinding(calls);
    await readProjectSourcesBatch("p", ["a.tex", "b.tex", "c.tex"]);
    expect(projectSourcesCacheSize()).toBe(2);

    const result = await readProjectSourcesBatch("p", ["d.tex"]);

    expect(Object.keys(result.texts)).toEqual(["d.tex"]);
    expect(projectSourcesCacheSize()).toBe(1);

    await readProjectSourcesBatch("p", ["d.tex"]);
    expect(calls[2].known).toEqual([{ path: "d.tex", hash: "hash-of-d.tex" }]);
  });

  it("keeps everything when the cache stays inside the budget", async () => {
    const calls: ProjectSourcesRequest[] = [];
    bridge.batch = bigBinding(calls);

    await readProjectSourcesBatch("p", ["a.tex", "b.tex"]);

    expect(projectSourcesCacheSize()).toBe(2);
  });
});
