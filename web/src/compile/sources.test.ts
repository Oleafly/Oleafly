import { describe, expect, it, vi } from "vitest";
import type { WebApi } from "../api";
import type { WebFile } from "../protocol";
import { readSources } from "./sources";

const FILES: WebFile[] = [
  { fileId: "a", path: "main.tex", kind: "text", blob: null },
  { fileId: "b", path: "intro.tex", kind: "text", blob: null },
  { fileId: "c", path: "fig.png", kind: "blob", blob: "h-fig" },
  { fileId: "d", path: "figs", kind: "dir", blob: null },
];

describe("readSources", () => {
  it("reads the server's text, this browser's open files over it, and other files once on demand", async () => {
    const api = {
      texts: vi.fn(async () => [
        { fileId: "a", path: "main.tex", text: "server main" },
        { fileId: "b", path: "intro.tex", text: "server intro" },
      ]),
      blob: vi.fn(async () => new Blob([new Uint8Array([1, 2])])),
    } as unknown as WebApi;
    const sources = await readSources(
      { api, projectId: "p1", files: () => FILES, openText: (path) => (path === "main.tex" ? "typed main" : null) },
      new AbortController().signal,
    );
    expect(sources.files).toEqual([
      { path: "main.tex", kind: "text" },
      { path: "intro.tex", kind: "text" },
      { path: "fig.png", kind: "blob" },
    ]);
    expect(sources.text("main.tex")).toBe("typed main");
    expect(sources.text("intro.tex")).toBe("server intro");
    expect(sources.text("fig.png")).toBeNull();
    expect(await sources.bytes("fig.png")).toEqual(new Uint8Array([1, 2]));
    await sources.bytes("fig.png");
    expect(api.blob).toHaveBeenCalledOnce();
    expect(await sources.bytes("missing.png")).toBeNull();
  });
});
