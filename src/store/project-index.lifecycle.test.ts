import type {
  ProjectSourcesRequest,
  ProjectSourcesResult,
} from "@oleafly/backend-port";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  readProjectSourcesBatch: vi.fn<
    (projectId: string, request: ProjectSourcesRequest) => Promise<ProjectSourcesResult>
  >(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
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

vi.mock("@/lib/project-sources", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/project-sources")>();
  return { ...original, readProjectSourcesBatch: vi.fn(original.readProjectSourcesBatch) };
});

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { readProjectSourcesBatch, resetProjectSourcesCache } from "@/lib/project-sources";
import type {
  ExternalProjectIntelligence,
  ProjectIntelligenceSnapshot,
} from "@/lib/project-intelligence/types";
import {
  ProjectIntelligenceWorkerClient,
  ProjectIntelligenceWorkerError,
} from "@/lib/project-intelligence/worker-client";
import {
  bibliographyEntryDetails,
  projectFilesystemEpoch,
  useIndexStore,
} from "./project-index";
import { useFilesStore } from "./files";

let diskTexts: Record<string, string> = {};

function serveDisk(_projectId: string, request: ProjectSourcesRequest): Promise<ProjectSourcesResult> {
  return Promise.resolve({
    files: request.paths
      .filter((path) => diskTexts[path] !== undefined)
      .map((path) => ({ path, hash: `hash:${path}:${diskTexts[path]}`, text: diskTexts[path] })),
    unchanged: [],
    unreadable: request.paths
      .filter((path) => diskTexts[path] === undefined)
      .map((path) => ({ path, message: `${path} could not be read.` })),
    truncated: false,
  });
}

function tree(paths: string[]) {
  return paths.map((path) => ({ path, is_dir: false }));
}

function intelligence() {
  return useIndexStore.getState().intelligenceState;
}

function labels(snapshot: ProjectIntelligenceSnapshot | null): string[] {
  return (snapshot?.definitions ?? [])
    .filter((definition) => definition.kind === "label")
    .map((definition) => definition.name)
    .sort();
}

function flushTasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function settled() {
  await vi.waitFor(() => {
    expect(useIndexStore.getState().building).toBe(false);
    expect(intelligence().stale).toBe(false);
  });
}

async function loadProject() {
  await useIndexStore.getState().rebuildFromDisk();
  await settled();
  expect(intelligence().status).toBe("success");
}

beforeEach(() => {
  diskTexts = {
    "main.tex": String.raw`\section{Intro}\label{sec:intro}\input{chapter}`,
    "chapter.tex": String.raw`\section{Body}\label{sec:body}`,
  };
  resetProjectSourcesCache();
  bridge.readProjectSourcesBatch.mockReset();
  bridge.readProjectSourcesBatch.mockImplementation(serveDisk);
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.tex",
    activePath: null,
    tree: tree(["main.tex", "chapter.tex"]),
    files: {},
  });
  useIndexStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useIndexStore.getState().dispose();
  useFilesStore.setState({ projectId: null, tree: [], files: {}, activePath: null });
  resetProjectSourcesCache();
});

describe("project index editing", () => {
  it("re-analyzes an edited file after the idle delay", async () => {
    await loadProject();
    vi.useFakeTimers();

    useIndexStore
      .getState()
      .updateFile("chapter.tex", String.raw`\section{Body}\label{sec:body}\label{sec:extra}`);

    expect(intelligence()).toMatchObject({
      status: "running",
      stale: true,
      currentFileFallbackAllowed: true,
      reason: { key: "retainedStale" },
    });
    expect(labels(intelligence().data)).toEqual(["sec:body", "sec:intro"]);

    await vi.advanceTimersByTimeAsync(300);
    await settled();

    expect(intelligence().status).toBe("success");
    expect(labels(intelligence().data)).toEqual(["sec:body", "sec:extra", "sec:intro"]);
  });

  it("combines edits made inside one idle window into one analysis", async () => {
    await loadProject();
    vi.useFakeTimers();
    const analyze = vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze");

    useIndexStore.getState().updateFile("chapter.tex", String.raw`\label{sec:first}`);
    await vi.advanceTimersByTimeAsync(100);
    useIndexStore.getState().updateFile("main.tex", String.raw`\label{sec:second}\input{chapter}`);
    await vi.advanceTimersByTimeAsync(300);
    await settled();

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0].upserts.map((file) => file.file).sort()).toEqual([
      "chapter.tex",
      "main.tex",
    ]);
    expect(labels(intelligence().data)).toEqual(["sec:first", "sec:second"]);
  });

  it("ignores edits that cannot change the analysis", async () => {
    await loadProject();
    const before = useIndexStore.getState();

    useIndexStore.getState().updateFile("figure.png", "binary");
    useIndexStore.getState().updateFile("chapter.tex", diskTexts["chapter.tex"]);

    expect(useIndexStore.getState().requestGeneration).toBe(before.requestGeneration);
    expect(intelligence()).toBe(before.intelligenceState);

    useFilesStore.setState({ projectId: null });
    useIndexStore.getState().updateFile("chapter.tex", "changed");
    useIndexStore.getState().deleteFile("chapter.tex");
    useIndexStore.getState().renameFile("chapter.tex", "renamed.tex");
    useIndexStore.getState().invalidateFilesystem();
    await useIndexStore.getState().rebuildFromDisk();

    expect(useIndexStore.getState().requestGeneration).toBe(before.requestGeneration);
  });

  it("drops a deleted file from the next analysis", async () => {
    await loadProject();
    const epoch = projectFilesystemEpoch();
    useFilesStore.setState({ tree: tree(["main.tex"]) });

    useIndexStore.getState().deleteFile("chapter.tex");

    expect(projectFilesystemEpoch()).toBe(epoch + 1);
    expect(useIndexStore.getState().texts).not.toHaveProperty("chapter.tex");
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(300);
    await settled();
    expect(Object.keys(intelligence().data?.fileStates ?? {})).toEqual(["main.tex"]);
    expect(labels(intelligence().data)).toEqual(["sec:intro"]);
  });

  it("does nothing when an unknown file is deleted", async () => {
    await loadProject();
    const generation = useIndexStore.getState().requestGeneration;

    useIndexStore.getState().deleteFile("never-seen.tex");

    expect(useIndexStore.getState().requestGeneration).toBe(generation);
  });

  it("carries a renamed file's text to its new path", async () => {
    await loadProject();
    useFilesStore.setState({ tree: tree(["main.tex", "body.tex"]) });

    useIndexStore.getState().renameFile("chapter.tex", "body.tex");

    expect(useIndexStore.getState().texts["body.tex"]).toBe(diskTexts["chapter.tex"]);
    expect(useIndexStore.getState().texts).not.toHaveProperty("chapter.tex");
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(300);
    await settled();
    expect(Object.keys(intelligence().data?.fileStates ?? {}).sort()).toEqual(["body.tex", "main.tex"]);
    expect(labels(intelligence().data)).toEqual(["sec:body", "sec:intro"]);
  });

  it("stops analyzing a file renamed to a non-source name", async () => {
    await loadProject();
    useFilesStore.setState({ tree: tree(["main.tex", "chapter.txt"]) });

    useIndexStore.getState().renameFile("chapter.tex", "chapter.txt");
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(300);
    await settled();

    expect(useIndexStore.getState().texts).not.toHaveProperty("chapter.txt");
    expect(labels(intelligence().data)).toEqual(["sec:intro"]);
  });

  it("ignores a rename onto the same path", async () => {
    await loadProject();
    const generation = useIndexStore.getState().requestGeneration;

    useIndexStore.getState().renameFile("chapter.tex", "./chapter.tex");

    expect(useIndexStore.getState().requestGeneration).toBe(generation);
  });
});

describe("project index refreshes", () => {
  it("marks the graph as refreshing as soon as the file tree changes", async () => {
    await loadProject();
    const epoch = projectFilesystemEpoch();
    const revision = useIndexStore.getState().projectRevision;

    useIndexStore.getState().invalidateFilesystem();

    expect(projectFilesystemEpoch()).toBe(epoch + 1);
    expect(useIndexStore.getState()).toMatchObject({ building: true, projectRevision: revision + 1 });
    expect(intelligence()).toMatchObject({
      status: "running",
      stale: true,
      reason: { key: "sourceGraphRefreshing" },
    });
  });

  it("keeps the current analysis when a rebuild finds nothing new", async () => {
    await loadProject();
    const analyze = vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze");
    const before = intelligence();

    await useIndexStore.getState().rebuildFromDisk();

    expect(analyze).not.toHaveBeenCalled();
    expect(useIndexStore.getState().building).toBe(false);
    expect(intelligence()).toBe(before);
  });

  it("discards a rebuild whose project closed while it was reading", async () => {
    let release: () => void = () => {};
    bridge.readProjectSourcesBatch.mockImplementation(
      (projectId, request) =>
        new Promise((resolve) => {
          release = () => resolve(serveDisk(projectId, request));
        }),
    );
    const analyze = vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze");

    const pending = useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(bridge.readProjectSourcesBatch).toHaveBeenCalled());
    useFilesStore.setState({ projectId: "other" });
    release();
    await pending;

    expect(analyze).not.toHaveBeenCalled();
    expect(useIndexStore.getState().texts).toEqual({});
  });

  it("reports a failed source read as an analysis failure", async () => {
    vi.mocked(readProjectSourcesBatch).mockRejectedValueOnce(new Error("disk unplugged"));

    await useIndexStore.getState().rebuildFromDisk();

    expect(useIndexStore.getState()).toMatchObject({ building: false, projectRevision: 1 });
    expect(intelligence()).toMatchObject({
      status: "error",
      data: null,
      stale: false,
      reason: { key: "analysisFailed" },
      failure: { name: "Error", message: "disk unplugged", retryable: true },
    });
  });

  it("ignores a failed read once a newer rebuild has started", async () => {
    let fail: () => void = () => {};
    vi.mocked(readProjectSourcesBatch).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = () => reject(new Error("late")))),
    );

    const first = useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(readProjectSourcesBatch).toHaveBeenCalled());
    const second = useIndexStore.getState().rebuildFromDisk();
    fail();
    await Promise.all([first, second]);
    await settled();

    expect(intelligence().status).toBe("success");
  });

  it("shows a worker crash as unavailable and keeps the last good analysis", async () => {
    await loadProject();
    const good = intelligence().data;
    vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze").mockRejectedValueOnce(
      new ProjectIntelligenceWorkerError("workerUnavailable", "worker_unavailable", false),
    );
    vi.useFakeTimers();

    useIndexStore.getState().updateFile("chapter.tex", String.raw`\label{sec:changed}`);
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(intelligence().status).toBe("unavailable"));

    expect(intelligence()).toMatchObject({
      data: good,
      stale: true,
      reason: { key: "workerUnavailable" },
      failure: {
        name: "ProjectIntelligenceWorkerError",
        reason: { key: "workerUnavailable" },
        retryable: false,
      },
    });
    expect(useIndexStore.getState().building).toBe(false);
  });

  it("describes a non-error worker rejection with the generic failure text", async () => {
    vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze").mockRejectedValueOnce("boom");

    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(intelligence().status).toBe("error"));

    expect(intelligence().failure).toEqual({
      name: "ProjectIntelligenceError",
      message: enCore.intelligence.failed,
      retryable: true,
    });
  });

  it("drops a worker failure for a project that is no longer open", async () => {
    let reject: (error: unknown) => void = () => {};
    vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze").mockReturnValueOnce(
      new Promise((_resolve, fail) => (reject = fail)),
    );

    await useIndexStore.getState().rebuildFromDisk();
    useFilesStore.setState({ projectId: "other" });
    reject(new Error("too late"));
    await flushTasks();

    expect(intelligence().status).toBe("running");
  });

  it("drops a worker result for a project that is no longer open", async () => {
    const original = ProjectIntelligenceWorkerClient.prototype.analyze;
    let resolveSnapshot: () => void = () => {};
    vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze").mockImplementationOnce(function (
      this: ProjectIntelligenceWorkerClient,
      input,
    ) {
      const result = original.call(this, input);
      return new Promise((resolve) => {
        resolveSnapshot = () => resolve(result);
      });
    });

    await useIndexStore.getState().rebuildFromDisk();
    useFilesStore.setState({ projectId: "other" });
    resolveSnapshot();
    await flushTasks();

    expect(intelligence().status).toBe("running");
    expect(intelligence().data).toBeNull();
  });

  it("retries with a fresh worker state after a failure", async () => {
    vi.spyOn(ProjectIntelligenceWorkerClient.prototype, "analyze").mockRejectedValueOnce(new Error("hiccup"));
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(intelligence().status).toBe("error"));

    await useIndexStore.getState().retryIntelligence();
    await settled();

    expect(intelligence().status).toBe("success");
    expect(labels(intelligence().data)).toEqual(["sec:body", "sec:intro"]);
  });

  it("refuses bibliography lookups once the worker is stopped", async () => {
    await loadProject();
    const snapshot = intelligence().data;
    if (!snapshot) throw new Error("expected a snapshot");

    useIndexStore.getState().dispose();

    expect(intelligence().reason).toEqual({ key: "stopped" });
    await expect(bibliographyEntryDetails(snapshot, ["any"])).rejects.toMatchObject({
      code: "stale_snapshot",
      retryable: false,
    });
  });
});

describe("language-server contributions", () => {
  function contribution(identity: ProjectIntelligenceSnapshot["identity"]): ExternalProjectIntelligence {
    return {
      identity,
      definitions: [
        {
          id: "texlab:fig:plot",
          source: "texlab",
          engine: "latex",
          kind: "label",
          name: "fig:plot",
          location: { file: "chapter.tex", range: { from: 0, to: 4, startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 } },
        },
      ],
      uses: [],
    };
  }

  it("rejects a contribution for another analysis", async () => {
    await loadProject();
    const identity = intelligence().identity;
    if (!identity) throw new Error("expected an identity");

    const accepted = useIndexStore
      .getState()
      .mergeLanguageService(contribution({ ...identity, requestGeneration: identity.requestGeneration + 1 }));

    expect(accepted).toBe(false);
    expect(labels(intelligence().data)).toEqual(["sec:body", "sec:intro"]);
  });

  it("merges a contribution into the current analysis", async () => {
    await loadProject();
    const identity = intelligence().identity;
    if (!identity) throw new Error("expected an identity");

    expect(useIndexStore.getState().mergeLanguageService(contribution(identity))).toBe(true);

    expect(labels(intelligence().data)).toEqual(["fig:plot", "sec:body", "sec:intro"]);
    expect(useIndexStore.getState().index?.defs.some((symbol) => symbol.name === "fig:plot")).toBe(true);
  });

  it("holds a contribution that arrives before its analysis and merges it on arrival", async () => {
    await loadProject();
    vi.useFakeTimers();
    useIndexStore.getState().updateFile("chapter.tex", String.raw`\label{sec:body}`);
    const identity = intelligence().identity;
    if (!identity) throw new Error("expected an identity");

    expect(useIndexStore.getState().mergeLanguageService(contribution(identity))).toBe(true);
    expect(labels(intelligence().data)).toEqual(["sec:body", "sec:intro"]);

    await vi.advanceTimersByTimeAsync(300);
    await settled();

    expect(labels(intelligence().data)).toEqual(["fig:plot", "sec:body", "sec:intro"]);
  });
});
