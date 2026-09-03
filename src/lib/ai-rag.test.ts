import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RagChunk, RagRetrieveRequest } from "./ai-rag";

type RagBinding = (
  projectId: string,
  request: RagRetrieveRequest,
) => Promise<RagChunk[]>;

const bridge = vi.hoisted(() => ({
  readFileContent: vi.fn<(projectId: string, path: string) => Promise<string>>(),
  ragRetrieve: undefined as RagBinding | undefined,
}));

const store = vi.hoisted(() => ({
  state: {
    projectId: null as string | null,
    tree: [] as { path: string; is_dir: boolean }[],
    files: {} as Record<string, { content: string; dirty: boolean }>,
  },
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => store.state },
}));

vi.mock("@/lib/tauri", () => {
  const module: Record<string, unknown> = {
    readFileContent: (projectId: string, filePath: string) =>
      bridge.readFileContent(projectId, filePath),
  };
  Object.defineProperty(module, "ragRetrieve", {
    enumerable: true,
    get: () => bridge.ragRetrieve,
  });
  return module;
});

import {
  chunkFile,
  formatRagContext,
  queryTokens,
  rankChunks,
  retrieveProjectChunks,
  scoreChunk,
  tokenize,
} from "./ai-rag";

function lines(count: number, body: string): string {
  return Array.from({ length: count }, (_, index) => `${body}${index}`).join("\n");
}

beforeEach(() => {
  bridge.ragRetrieve = undefined;
  bridge.readFileContent.mockReset();
  store.state = { projectId: null, tree: [], files: {} };
});

describe("formatRagContext", () => {
  it("returns empty for no chunks", () => {
    expect(formatRagContext([])).toBe("");
  });

  it("includes path and text", () => {
    const chunks: RagChunk[] = [
      {
        path: "main.tex",
        startLine: 1,
        endLine: 10,
        text: "\\section{Introduction}",
        score: 2.5,
      },
    ];
    const s = formatRagContext(chunks);
    expect(s).toContain("main.tex:1-10");
    expect(s).toContain("Introduction");
  });
});

describe("tokenize", () => {
  it("lowercases and keeps backslashes, underscores and digits", () => {
    expect(tokenize("\\Section{Hello_World} 42 -- ok")).toEqual([
      "\\section",
      "hello_world",
      "42",
      "ok",
    ]);
  });

  it("drops runs shorter than two characters", () => {
    expect(tokenize("a b c d")).toEqual([]);
    expect(tokenize("a ab abc")).toEqual(["ab", "abc"]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("treats every other character as a separator", () => {
    expect(tokenize("café; naïve — ok")).toEqual(["caf", "na", "ve", "ok"]);
  });

  it("caps a query at thirty two tokens", () => {
    const query = Array.from({ length: 50 }, (_, i) => `token${i}`).join(" ");
    expect(queryTokens(query)).toHaveLength(32);
    expect(queryTokens(query)[31]).toBe("token31");
  });
});

describe("chunkFile", () => {
  it("advances by thirty two lines and overlaps by eight", () => {
    const chunks = chunkFile("main.tex", lines(100, "line"));
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([
      [1, 40],
      [33, 72],
      [65, 100],
    ]);
    expect(chunks[1].text.startsWith("line32\n")).toBe(true);
    expect(chunks[2].text.endsWith("line99")).toBe(true);
  });

  it("emits one chunk for a file shorter than a window", () => {
    const chunks = chunkFile("main.tex", "one\ntwo\nthree");
    expect(chunks).toHaveLength(1);
    expect([chunks[0].startLine, chunks[0].endLine]).toEqual([1, 3]);
    expect(chunks[0].text).toBe("one\ntwo\nthree");
  });

  it("skips a blank window without ending the walk", () => {
    const head = Array.from({ length: 32 }, (_, i) => `x${i}`);
    const content = [...head, ...Array.from({ length: 68 }, () => "")].join("\n");
    const chunks = chunkFile("main.tex", content);
    expect(chunks).toHaveLength(1);
    expect([chunks[0].startLine, chunks[0].endLine]).toEqual([1, 40]);
    expect(chunks[0].text.endsWith("x31")).toBe(true);
  });

  it("trims the window text", () => {
    const chunks = chunkFile("main.tex", "﻿  \n\thello\n   ");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("hello");
    expect([chunks[0].startLine, chunks[0].endLine]).toEqual([1, 3]);
  });

  it("caps chunk text at eighteen hundred characters", () => {
    const chunks = chunkFile("main.tex", "x".repeat(2000));
    expect(chunks[0].text).toHaveLength(1800);
  });

  it("only chunks the first eighty thousand characters of a file", () => {
    const chunks = chunkFile("main.tex", `${"a".repeat(80_000)}\nneedle`);
    expect(chunks).toHaveLength(1);
    expect([chunks[0].startLine, chunks[0].endLine]).toEqual([1, 1]);
    expect(scoreChunk(["needle"], chunks[0].text)).toBe(0);
  });
});

describe("scoreChunk", () => {
  it("caps token hits at eight per chunk", () => {
    expect(scoreChunk(["ab"], "ab ".repeat(12))).toBe(8 * 1.25);
    expect(scoreChunk(["ab"], "ab ab ab")).toBe(3 * 1.25);
  });

  it("counts overlapping matches once and scans forward", () => {
    expect(scoreChunk(["aa"], "aaa")).toBe(1.25);
    expect(scoreChunk(["aa"], "aaaa")).toBe(2 * 1.25);
  });

  it("weighs longer tokens more, up to a length of sixteen", () => {
    expect(scoreChunk(["ab"], "ab")).toBe(1.25);
    expect(scoreChunk(["abcdefgh"], "abcdefgh")).toBe(2);
    expect(scoreChunk(["abcdefghijklmnop"], "abcdefghijklmnop")).toBe(3);
    expect(scoreChunk(["abcdefghijklmnopqrstuvwx"], "abcdefghijklmnopqrstuvwx")).toBe(3);
  });

  it("counts a repeated query token once", () => {
    expect(scoreChunk(["ab", "ab", "ab"], "ab ab")).toBe(scoreChunk(["ab"], "ab ab"));
  });

  it("matches case insensitively and scores nothing without tokens", () => {
    expect(scoreChunk(["needle"], "NEEDLE")).toBe(1.75);
    expect(scoreChunk([], "needle")).toBe(0);
  });
});

describe("rankChunks", () => {
  it("puts the highest score first and keeps source order on a tie", () => {
    const ranked = rankChunks(
      ["needle"],
      [
        { path: "a.tex", content: "needle" },
        { path: "b.tex", content: "needle needle needle" },
        { path: "c.tex", content: "needle" },
      ],
      8,
    );
    expect(ranked.map((c) => c.path)).toEqual(["b.tex", "a.tex", "c.tex"]);
    expect(ranked[0].score).toBe(3 * 1.75);
    expect(ranked[1].score).toBe(ranked[2].score);
  });

  it("drops chunks that score zero", () => {
    const ranked = rankChunks(
      ["needle"],
      [
        { path: "a.tex", content: "haystack" },
        { path: "b.tex", content: "needle" },
      ],
      8,
    );
    expect(ranked.map((c) => c.path)).toEqual(["b.tex"]);
  });

  it("returns at most topK chunks", () => {
    const sources = [{ path: "a.tex", content: lines(400, "needle line ") }];
    expect(rankChunks(["needle"], sources, 3)).toHaveLength(3);
    expect(rankChunks(["needle"], sources, 0)).toHaveLength(0);
  });
});

describe("retrieveProjectChunks", () => {
  const chunk: RagChunk = {
    path: "main.tex",
    startLine: 1,
    endLine: 1,
    text: "needle",
    score: 1.75,
  };

  function openProject(): void {
    store.state = {
      projectId: "p",
      tree: [
        { path: "chapters", is_dir: true },
        { path: "chapters/one.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
        { path: "main.pdf", is_dir: false },
      ],
      files: {},
    };
  }

  it("prefers the backend command when the binding is present", async () => {
    openProject();
    const calls: [string, RagRetrieveRequest][] = [];
    bridge.ragRetrieve = async (projectId, request) => {
      calls.push([projectId, request]);
      return [chunk];
    };
    const result = await retrieveProjectChunks("needle", { topK: 4 });
    expect(result).toEqual([chunk]);
    expect(calls).toEqual([["p", { query: "needle", topK: 4, overrides: [] }]]);
    expect(bridge.readFileContent).not.toHaveBeenCalled();
  });

  it("sends only dirty open buffers as overrides", async () => {
    openProject();
    store.state.files = {
      "main.tex": { content: "edited", dirty: true },
      "chapters/one.tex": { content: "saved", dirty: false },
    };
    let seen: RagRetrieveRequest | null = null;
    bridge.ragRetrieve = async (_projectId, request) => {
      seen = request;
      return [];
    };
    await retrieveProjectChunks("needle");
    expect(seen).toEqual({
      query: "needle",
      topK: 5,
      overrides: [{ path: "main.tex", text: "edited" }],
    });
  });

  it("treats an empty answer from the backend as final", async () => {
    openProject();
    bridge.ragRetrieve = async () => [];
    expect(await retrieveProjectChunks("needle")).toEqual([]);
    expect(bridge.readFileContent).not.toHaveBeenCalled();
  });

  it("reads each file when the binding is absent", async () => {
    openProject();
    bridge.readFileContent.mockImplementation(async (_projectId, path) =>
      path === "main.tex" ? "needle here" : "nothing",
    );
    const result = await retrieveProjectChunks("needle", { topK: 4 });
    expect(result.map((c) => c.path)).toEqual(["main.tex"]);
    expect(bridge.readFileContent.mock.calls.map((call) => call[1])).toEqual([
      "chapters/one.tex",
      "main.tex",
    ]);
  });

  it("falls back to reading each file when the command rejects", async () => {
    openProject();
    bridge.ragRetrieve = async () => {
      throw new Error("Checkpoint recovery is pending for this project.");
    };
    bridge.readFileContent.mockImplementation(async (_projectId, path) =>
      path === "main.tex" ? "needle here" : "nothing",
    );
    const result = await retrieveProjectChunks("needle", { topK: 4 });
    expect(result.map((c) => c.path)).toEqual(["main.tex"]);
    expect(bridge.readFileContent).toHaveBeenCalledTimes(2);
  });

  it("skips a file that cannot be read on the fallback path", async () => {
    openProject();
    bridge.readFileContent.mockImplementation(async (_projectId, path) => {
      if (path === "main.tex") return "needle here";
      throw new Error("gone");
    });
    const result = await retrieveProjectChunks("needle");
    expect(result.map((c) => c.path)).toEqual(["main.tex"]);
  });

  it("retrieves nothing without a project, a query or a usable token", async () => {
    bridge.ragRetrieve = async () => [chunk];
    expect(await retrieveProjectChunks("needle")).toEqual([]);
    openProject();
    expect(await retrieveProjectChunks("   ")).toEqual([]);
    expect(await retrieveProjectChunks("a b c")).toEqual([]);
  });
});
