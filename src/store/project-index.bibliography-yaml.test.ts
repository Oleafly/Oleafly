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

import { resetProjectSourcesCache } from "@/lib/project-sources";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { currentProjectSourcePaths, useIndexStore } from "./project-index";
import { useFilesStore } from "./files";

const FILE_BYTES = 2_000_000;
const BATCH_BYTES = 10_000_000;

const LIBRARY = 'harry:\n  type: book\n  title: "Harry Potter"\n  author: "Rowling, J. K."\n  date: 2003\n';
const DATA = `${"- {id: 1, name: \"sample row\", values: [1, 2, 3, 4, 5, 6, 7, 8]}\n".repeat(48_000)}`;
const RECORDS = "- name: alpha\n  type: sensor\n- name: beta\n  type: sensor\n";
const CONFIG = "name: CI\non:\n  push:\n    branches: [main]\n";
const MAIN = [
  "= Intro <sec:intro>",
  "See @sec:intro and @harry.",
  '#let rows = yaml("data.yml")',
  '#yaml("records.yml")',
  '#bibliography("refs.yml", style: "apa")',
  "",
].join("\n");

let disk: Record<string, string> = {};

function emulateRustBatch(request: ProjectSourcesRequest): ProjectSourcesResult {
  const known = new Map(request.known.map((entry) => [entry.path, entry.hash]));
  const result: ProjectSourcesResult = { files: [], unchanged: [], unreadable: [], oversized: [], truncated: false };
  let consumed = 0;
  for (const path of [...request.paths].sort()) {
    const text = disk[path];
    if (text === undefined) {
      result.unreadable.push({ path, message: `${path} could not be read.` });
      continue;
    }
    const allowed = Math.min(FILE_BYTES, BATCH_BYTES - consumed);
    if (text.length > allowed) {
      result.truncated = true;
      result.oversized?.push(path);
      continue;
    }
    consumed += text.length;
    const hash = `hash:${text.length}:${text.slice(0, 32)}`;
    if (known.get(path) === hash) result.unchanged.push(path);
    else result.files.push({ path, hash, text });
  }
  return result;
}

function openProject(files: Record<string, string>, extraTree: readonly string[] = []) {
  disk = files;
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.typ",
    activePath: null,
    tree: [...Object.keys(files), ...extraTree].map((path) => ({ path, is_dir: false })),
    files: {},
  });
}

async function analysed(): Promise<ProjectIntelligenceSnapshot> {
  await vi.waitFor(() => {
    const state = useIndexStore.getState();
    expect(state.building).toBe(false);
    expect(state.intelligenceState.status).not.toBe("running");
  });
  const state = useIndexStore.getState().intelligenceState;
  expect(state.status).toBe("success");
  if (!state.data) throw new Error("no snapshot");
  return state.data;
}

function resolution(snapshot: ProjectIntelligenceSnapshot, name: string) {
  return snapshot.uses.find((use) => use.name === name && use.location.file === "main.typ")?.resolution;
}

function requestedPaths(): string[] {
  return bridge.readProjectSourcesBatch.mock.calls.flatMap(([, request]) => request.paths);
}

beforeEach(() => {
  resetProjectSourcesCache();
  bridge.readFileContent.mockReset();
  bridge.readProjectSourcesBatch.mockReset();
  bridge.readProjectSourcesBatch.mockImplementation(async (_projectId, request) => emulateRustBatch(request));
  useIndexStore.getState().reset();
});

afterEach(() => {
  useIndexStore.getState().dispose();
  useFilesStore.setState({ projectId: null, tree: [], files: {}, activePath: null });
  resetProjectSourcesCache();
});

describe("YAML files in a Typst project", () => {
  it("indexes the Hayagriva library and leaves a 3 MB data file and other YAML out", async () => {
    expect(DATA.length).toBeGreaterThan(3_000_000);
    openProject(
      { "main.typ": MAIN, "refs.yml": LIBRARY, "data.yml": DATA, "records.yml": RECORDS, "config.yml": CONFIG },
      [".github/workflows/ci.yml", "pnpm-lock.yaml"],
    );

    await useIndexStore.getState().rebuildFromDisk();
    const snapshot = await analysed();

    expect(Object.keys(snapshot.fileStates)).toEqual(["main.typ", "refs.yml"]);
    expect(resolution(snapshot, "sec:intro")).toBe("resolved");
    expect(resolution(snapshot, "harry")).toBe("resolved");
    expect(snapshot.bibliography.entries.map((entry) => entry.key)).toEqual(["harry"]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(currentProjectSourcePaths()).toEqual(["main.typ", "refs.yml"]);
    expect(bridge.readFileContent).not.toHaveBeenCalled();
    expect(requestedPaths()).not.toContain(".github/workflows/ci.yml");
    expect(requestedPaths()).not.toContain("pnpm-lock.yaml");
  });

  it("keeps a YAML file the document cites as a bibliography even when its start does not look like one", async () => {
    const header = `${"# licence text\n".repeat(700)}`;
    openProject({ "main.typ": MAIN, "refs.yml": `${header}${LIBRARY}`, "other.yml": `${header}${LIBRARY}` });

    await useIndexStore.getState().rebuildFromDisk();
    const snapshot = await analysed();

    expect(Object.keys(snapshot.fileStates)).toEqual(["main.typ", "refs.yml"]);
    expect(resolution(snapshot, "harry")).toBe("resolved");
  });

  it("leaves out a Hayagriva-looking file over one million characters", async () => {
    const huge = `${LIBRARY}${"x:\n  type: misc\n  title: padding entry\n".repeat(30_000)}`;
    expect(huge.length).toBeGreaterThan(1_000_000);
    expect(huge.length).toBeLessThan(FILE_BYTES);
    openProject({ "main.typ": MAIN, "refs.yml": huge });

    await useIndexStore.getState().rebuildFromDisk();
    const snapshot = await analysed();

    expect(Object.keys(snapshot.fileStates)).toEqual(["main.typ"]);
    expect(resolution(snapshot, "sec:intro")).toBe("resolved");
  });

  it("follows edits that turn a YAML file into a library and back", async () => {
    openProject({ "main.typ": MAIN, "refs.yml": RECORDS, "data.yml": DATA });
    await useIndexStore.getState().rebuildFromDisk();
    expect(Object.keys((await analysed()).fileStates)).toEqual(["main.typ", "refs.yml"]);

    useIndexStore.getState().updateFile("data.yml", `${DATA}more: 1\n`);
    useIndexStore.getState().updateFile("records.yml", LIBRARY);
    let snapshot = await analysed();
    expect(Object.keys(snapshot.fileStates)).toEqual(["main.typ", "records.yml", "refs.yml"]);

    useIndexStore.getState().updateFile("records.yml", RECORDS);
    snapshot = await analysed();
    expect(Object.keys(snapshot.fileStates)).toEqual(["main.typ", "refs.yml"]);
    expect(currentProjectSourcePaths()).toEqual(["main.typ", "refs.yml"]);
  });
});
