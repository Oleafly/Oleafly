import type {
  ProjectSourcesRequest,
  ProjectSourcesResult,
} from "@oleafly/backend-port";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  readFileContent: vi.fn<(projectId: string, path: string) => Promise<string>>(),
  readProjectSourcesBatch: vi.fn<
    (projectId: string, request: ProjectSourcesRequest) => Promise<ProjectSourcesResult>
  >(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileContent: bridge.readFileContent,
  readProjectSourcesBatch: bridge.readProjectSourcesBatch,
}));

import { resetProjectSourcesCache } from "@/lib/project-sources";
import { currentProjectSourcePaths, readProjectSources } from "./project-index";
import { useFilesStore } from "./files";

function seedTree(paths: Array<{ path: string; is_dir?: boolean }>) {
  useFilesStore.setState({
    tree: paths.map((p) => ({ path: p.path, is_dir: p.is_dir ?? false })),
  });
}

describe("currentProjectSourcePaths", () => {
  beforeEach(() => {
    seedTree([]);
  });

  it("returns indexable sources in a stable order regardless of tree order", () => {
    seedTree([
      { path: "zeta.tex" },
      { path: "alpha.tex" },
      { path: "Beta.tex" },
      { path: "mid.tex" },
    ]);
    const first = currentProjectSourcePaths();
    seedTree([
      { path: "mid.tex" },
      { path: "Beta.tex" },
      { path: "zeta.tex" },
      { path: "alpha.tex" },
    ]);
    expect(currentProjectSourcePaths()).toEqual(first);
  });

  it("orders by code point, so uppercase sorts before lowercase", () => {
    seedTree([{ path: "alpha.tex" }, { path: "Beta.tex" }]);
    expect(currentProjectSourcePaths()).toEqual(["Beta.tex", "alpha.tex"]);
  });

  it("skips directories and non-indexable files", () => {
    seedTree([
      { path: "src", is_dir: true },
      { path: "main.tex" },
      { path: "figure.png" },
    ]);
    expect(currentProjectSourcePaths()).toEqual(["main.tex"]);
  });

  it("folds an extra path in without duplicating one already in the tree", () => {
    seedTree([{ path: "main.tex" }]);
    expect(currentProjectSourcePaths("main.tex")).toEqual(["main.tex"]);
    expect(currentProjectSourcePaths("extra.tex")).toEqual([
      "extra.tex",
      "main.tex",
    ]);
  });
});

describe("readProjectSources", () => {
  const diskTexts: Record<string, string> = {
    "main.tex": "disk main",
    "chapters/one.tex": "disk one",
    "refs.bib": "disk refs",
  };

  beforeEach(() => {
    resetProjectSourcesCache();
    bridge.readFileContent.mockReset();
    bridge.readProjectSourcesBatch.mockReset();
    bridge.readProjectSourcesBatch.mockImplementation(async (_projectId, request) => {
      const known = new Map(request.known.map((entry) => [entry.path, entry.hash]));
      const result: ProjectSourcesResult = {
        files: [],
        unchanged: [],
        unreadable: [],
        truncated: false,
      };
      for (const path of [...request.paths].sort()) {
        const text = diskTexts[path];
        if (text === undefined) {
          result.unreadable.push({ path, message: `${path} could not be read.` });
        } else if (known.get(path) === `hash:${text}`) {
          result.unchanged.push(path);
        } else {
          result.files.push({ path, hash: `hash:${text}`, text });
        }
      }
      return result;
    });
    useFilesStore.setState({
      projectId: "project",
      files: {
        "main.tex": { content: "buffer main", dirty: false },
        "chapters/one.tex": { content: "buffer one", dirty: true },
      },
    });
  });

  afterEach(() => {
    useFilesStore.setState({ projectId: null, files: {} });
    resetProjectSourcesCache();
  });

  it("lets open buffers win and batches every other path into one call", async () => {
    const result = await readProjectSources("project", [
      "main.tex",
      "chapters/one.tex",
      "refs.bib",
      "missing.tex",
    ]);
    expect(result.texts).toEqual({
      "main.tex": "buffer main",
      "chapters/one.tex": "buffer one",
      "refs.bib": "disk refs",
    });
    expect([...result.unreadable]).toEqual(["missing.tex"]);
    expect(bridge.readProjectSourcesBatch).toHaveBeenCalledTimes(1);
    expect(bridge.readProjectSourcesBatch.mock.calls[0][1].paths).toEqual([
      "refs.bib",
      "missing.tex",
    ]);
    expect(bridge.readFileContent).not.toHaveBeenCalled();
  });

  it("reads dirty buffers from disk when diskForDirty is set", async () => {
    const result = await readProjectSources(
      "project",
      ["main.tex", "chapters/one.tex"],
      { diskForDirty: true },
    );
    expect(result.texts).toEqual({
      "main.tex": "buffer main",
      "chapters/one.tex": "disk one",
    });
    expect(bridge.readProjectSourcesBatch.mock.calls[0][1].paths).toEqual([
      "chapters/one.tex",
    ]);
  });

  it("makes no IPC call when every path is an open buffer", async () => {
    const result = await readProjectSources("project", ["main.tex"]);
    expect(result.texts).toEqual({ "main.tex": "buffer main" });
    expect(bridge.readProjectSourcesBatch).not.toHaveBeenCalled();
  });

  it("sends the hashes it was given on the next call and reuses cached text", async () => {
    await readProjectSources("project", ["refs.bib"]);
    const second = await readProjectSources("project", ["refs.bib"]);
    expect(second.texts).toEqual({ "refs.bib": "disk refs" });
    expect(bridge.readProjectSourcesBatch.mock.calls[1][1].known).toEqual([
      { path: "refs.bib", hash: "hash:disk refs" },
    ]);
  });
});
