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

vi.mock("@/lib/project-intelligence/worker-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/project-intelligence/worker-client")>();
  const { inProcessProjectIntelligenceWorkerFactory } = await import(
    "@/lib/project-intelligence/in-process-worker"
  );
  class InProcessWorkerClient extends original.ProjectIntelligenceWorkerClient {
    constructor() {
      super(inProcessProjectIntelligenceWorkerFactory(), 5_000);
    }
  }
  return { ...original, ProjectIntelligenceWorkerClient: InProcessWorkerClient };
});

vi.mock("@/lib/index/build", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/index/build")>();
  return { ...original, indexFromSymbols: vi.fn(original.indexFromSymbols) };
});

import { indexFromSymbols } from "@/lib/index/build";
import { resetProjectSourcesCache } from "@/lib/project-sources";
import {
  bibliographyEntryDetails,
  currentProjectSourcePaths,
  readProjectSources,
  useIndexStore,
} from "./project-index";
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

describe("snapshot install", () => {
  const diskTexts: Record<string, string> = {
    "main.tex": String.raw`\section{Intro}\label{sec:intro}\ref{sec:intro}\cite{alpha}`,
    "refs.bib": "@misc{alpha, author={A}, title={Alpha}, year={2020}, note={n}}",
  };

  beforeEach(() => {
    resetProjectSourcesCache();
    bridge.readProjectSourcesBatch.mockReset();
    bridge.readProjectSourcesBatch.mockImplementation(async (_projectId, request) => ({
      files: request.paths
        .filter((path) => diskTexts[path] !== undefined)
        .map((path) => ({ path, hash: `hash:${path}`, text: diskTexts[path] })),
      unchanged: [],
      unreadable: request.paths
        .filter((path) => diskTexts[path] === undefined)
        .map((path) => ({ path, message: `${path} could not be read.` })),
      truncated: false,
    }));
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "main.tex",
      activePath: null,
      tree: [
        { path: "main.tex", is_dir: false },
        { path: "refs.bib", is_dir: false },
      ],
      files: {},
    });
    useIndexStore.getState().reset();
  });

  afterEach(() => {
    useIndexStore.getState().dispose();
    useFilesStore.setState({ projectId: null, tree: [], files: {}, activePath: null });
    resetProjectSourcesCache();
  });

  it("installs the flattened snapshot and builds the legacy index only on first use", async () => {
    vi.mocked(indexFromSymbols).mockClear();
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => {
      expect(useIndexStore.getState().intelligenceState.status).toBe("success");
    });
    const state = useIndexStore.getState();
    const snapshot = state.intelligenceState.data;
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect("files" in snapshot).toBe(false);
    expect(Object.keys(snapshot.fileStates)).toEqual(["main.tex", "refs.bib"]);
    expect(snapshot.bibliography.entries.map((entry) => entry.display)).toEqual([
      "A · 2020 · Alpha",
    ]);
    expect(indexFromSymbols).not.toHaveBeenCalled();

    const index = state.index;
    expect(index).not.toBeNull();
    expect(
      index?.defs.filter((symbol) => symbol.kind === "bibentry").map((symbol) => symbol.name),
    ).toEqual(["alpha"]);
    expect(indexFromSymbols).toHaveBeenCalledTimes(1);
    expect(index?.symbolAt("main.tex", 2)?.kind).toBe("section");
    expect(useIndexStore.getState().index).toBe(index);
    expect(indexFromSymbols).toHaveBeenCalledTimes(1);

    const details = await bibliographyEntryDetails(snapshot, [
      snapshot.bibliography.entries[0].id,
    ]);
    expect(details.map((entry) => entry.fields.map((field) => field.name))).toEqual([
      ["author", "title", "year", "note"],
    ]);
    await expect(bibliographyEntryDetails(snapshot, [])).resolves.toEqual([]);
  });
});
