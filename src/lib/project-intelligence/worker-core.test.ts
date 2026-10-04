import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT_INTELLIGENCE_PROTOCOL_VERSION } from "./types";
import { createProjectIntelligenceWorker, installProjectIntelligenceWorker } from "./worker-core";
import {
  PROJECT_INTELLIGENCE_LIMITS,
  type AnalyzeProjectIntelligenceRequest,
  type ProjectIntelligenceWorkerResponse,
} from "./worker-protocol";

const parser = vi.hoisted(() => ({ failFor: null as string | null, failWith: null as unknown }));

vi.mock("./analyze-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./analyze-file")>();
  return {
    ...actual,
    analyzeProjectFile: (file: string, text: string, revision: number) => {
      if (file === parser.failFor) throw parser.failWith;
      return actual.analyzeProjectFile(file, text, revision);
    },
  };
});

type Upsert = AnalyzeProjectIntelligenceRequest["upserts"][number];

let generation = 0;

function request(
  overrides: Partial<Omit<AnalyzeProjectIntelligenceRequest, "identity">> & {
    projectId?: string;
    projectRevision?: number;
    requestGeneration?: number;
  } = {},
): AnalyzeProjectIntelligenceRequest {
  const { projectId = "p", projectRevision = 1, requestGeneration, ...rest } = overrides;
  generation = requestGeneration ?? generation + 1;
  return {
    protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
    type: "analyze",
    requestId: generation,
    identity: { projectId, projectRevision, requestGeneration: generation },
    reset: false,
    knownFiles: [],
    upserts: [],
    removals: [],
    unreadable: [],
    ...rest,
  };
}

function upsert(file: string, text: string, sourceRevision = 1): Upsert {
  return { file, text, sourceRevision };
}

function worker() {
  const posted: ProjectIntelligenceWorkerResponse[] = [];
  const close = vi.fn();
  const handle = createProjectIntelligenceWorker({ postMessage: (message) => posted.push(message), close });
  const send = (message: unknown) => {
    handle(message);
    return posted.at(-1);
  };
  return { send, posted, close };
}

function errorOf(response: ProjectIntelligenceWorkerResponse | undefined) {
  if (response?.type !== "error") throw new Error(`expected an error, got ${response?.type}`);
  return response.error;
}

function snapshotOf(response: ProjectIntelligenceWorkerResponse | undefined) {
  if (response?.type !== "result") throw new Error(`expected a result, got ${response?.type}`);
  return response.snapshot;
}

afterEach(() => {
  parser.failFor = null;
  parser.failWith = null;
  generation = 0;
  vi.restoreAllMocks();
});

describe("analyze request validation", () => {
  it.each([
    [
      "too many known files",
      { knownFiles: Array.from({ length: PROJECT_INTELLIGENCE_LIMITS.maxKnownFiles + 1 }, (_, i) => `f${i}.tex`) },
      `Project has ${PROJECT_INTELLIGENCE_LIMITS.maxKnownFiles + 1} files. The safe worker limit is ${PROJECT_INTELLIGENCE_LIMITS.maxKnownFiles}.`,
    ],
    [
      "too many upserts",
      { upserts: Array.from({ length: PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles + 1 }, (_, i) => upsert(`f${i}.tex`, "")) },
      `Request has ${PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles + 1} source files. The safe worker limit is ${PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles}.`,
    ],
    [
      "a path that is not normalized",
      { knownFiles: ["./main.tex"] },
      "Project-intelligence paths must be normalized project-relative paths.",
    ],
    [
      "duplicate known files",
      { knownFiles: ["main.tex", "main.tex"] },
      "Project-intelligence file lists must not contain duplicates.",
    ],
    [
      "duplicate unreadable files",
      { unreadable: [{ file: "a.tex", sourceRevision: 1 }, { file: "a.tex", sourceRevision: 2 }] },
      "Project-intelligence file lists must not contain duplicates.",
    ],
    [
      "a file both updated and removed",
      { upserts: [upsert("a.tex", "")], removals: ["a.tex"] },
      "A file cannot be updated, removed, and unreadable in the same request.",
    ],
    [
      "an unsupported source file",
      { upserts: [upsert("notes.txt", "hello")] },
      "Unsupported source file in worker request: notes.txt",
    ],
    [
      "an oversized source file",
      { upserts: [upsert("big.tex", "x".repeat(PROJECT_INTELLIGENCE_LIMITS.maxFileCharacters + 1))] },
      `big.tex has ${PROJECT_INTELLIGENCE_LIMITS.maxFileCharacters + 1} characters. The safe per-file worker limit is ${PROJECT_INTELLIGENCE_LIMITS.maxFileCharacters}.`,
    ],
  ])("refuses %s", (_label, overrides, message) => {
    const { send } = worker();
    expect(errorOf(send(request(overrides)))).toEqual({ code: "invalid_request", message, retryable: false });
  });

  it("requires revisions and generations to advance within a project", () => {
    const { send } = worker();
    snapshotOf(send(request({ projectRevision: 3, requestGeneration: 5 })));
    expect(errorOf(send(request({ projectRevision: 2, requestGeneration: 6 }))).message).toBe(
      "Project and request revisions must advance monotonically.",
    );
    expect(errorOf(send(request({ projectRevision: 3, requestGeneration: 5 }))).code).toBe("invalid_request");
    snapshotOf(send(request({ projectRevision: 3, requestGeneration: 6 })));
    snapshotOf(send(request({ projectId: "other", projectRevision: 1, requestGeneration: 1 })));
    snapshotOf(send(request({ projectId: "other", projectRevision: 1, requestGeneration: 1, reset: true })));
  });

  it("refuses source revisions that move backwards or are reused for new text", () => {
    const { send } = worker();
    snapshotOf(send(request({ knownFiles: ["a.tex"], upserts: [upsert("a.tex", "one", 4)] })));
    expect(errorOf(send(request({ knownFiles: ["a.tex"], upserts: [upsert("a.tex", "two", 3)] }))).message).toBe(
      "Source revision moved backwards for a.tex.",
    );
    expect(errorOf(send(request({ knownFiles: ["a.tex"], upserts: [upsert("a.tex", "two", 4)] }))).message).toBe(
      "Source revision 4 was reused for changed content in a.tex.",
    );
  });
});

describe("incremental analysis", () => {
  it("reuses unchanged files, reparses changed ones and drops removed ones", () => {
    const { send } = worker();
    const first = snapshotOf(
      send(request({ knownFiles: ["a.tex", "b.tex"], upserts: [upsert("a.tex", "\\label{a}"), upsert("b.tex", "\\label{b}")] })),
    );
    expect(first.stats).toMatchObject({ fileCount: 2, parsedFileCount: 2, reusedFileCount: 0 });

    const second = snapshotOf(
      send(request({ knownFiles: ["a.tex", "b.tex"], upserts: [upsert("a.tex", "\\label{a}", 2), upsert("b.tex", "\\label{c}", 2)] })),
    );
    expect(second.stats).toMatchObject({ parsedFileCount: 1, reusedFileCount: 1 });
    expect(second.fileStates["a.tex"].sourceRevision).toBe(2);
    expect(second.definitions.filter((d) => d.kind === "label").map((d) => d.name)).toEqual(["a", "c"]);

    const third = snapshotOf(send(request({ knownFiles: ["a.tex", "b.tex"], upserts: [upsert("a.tex", "\\label{a}", 2)] })));
    expect(third.stats).toMatchObject({ parsedFileCount: 0, reusedFileCount: 2 });

    const fourth = snapshotOf(send(request({ knownFiles: ["a.tex"], removals: ["b.tex"] })));
    expect(Object.keys(fourth.fileStates)).toEqual(["a.tex"]);
  });

  it("marks known but unloaded sources and unreadable files, ignoring non-source files", () => {
    const { send } = worker();
    const snapshot = snapshotOf(
      send(
        request({
          mainDocument: "main.tex",
          knownFiles: ["main.tex", "ch.tex", "figure.png", "locked.tex", "notes.txt"],
          upserts: [upsert("main.tex", "\\input{ch}")],
          unreadable: [
            { file: "locked.tex", sourceRevision: 2 },
            { file: "notes.txt", sourceRevision: 1 },
          ],
        }),
      ),
    );
    expect(Object.keys(snapshot.fileStates).sort()).toEqual(["ch.tex", "locked.tex", "main.tex"]);
    expect(snapshot.fileStates["ch.tex"]).toMatchObject({ status: "error", statusReason: "fileNotLoaded" });
    expect(snapshot.fileStates["locked.tex"]).toMatchObject({ status: "error", sourceRevision: 2 });
    expect(snapshot.status).toBe("partial");
    expect(snapshot.hierarchy.roots[0]).toBe("main.tex");
  });

  it("reports an unreadable file with the message the project index sends", () => {
    const { send } = worker();
    const snapshot = snapshotOf(
      send(
        request({
          knownFiles: ["main.tex", "locked.tex"],
          upserts: [upsert("main.tex", "\\input{locked}")],
          unreadable: [
            { file: "locked.tex", sourceRevision: 2, message: { key: "projectFileUnreadable" } },
          ],
        }),
      ),
    );
    expect(snapshot.fileStates["locked.tex"]).toMatchObject({
      status: "error",
      statusReason: "projectFileUnreadable",
    });
    expect(snapshot.diagnostics.find((d) => d.code === "unreadable-file")?.message).toEqual({
      key: "projectFileUnreadable",
    });
  });

  it.each([
    ["a string message", "locked"],
    ["a message without a key", {}],
    ["a message with an empty key", { key: "" }],
    ["a message with an unknown field", { key: "projectFileUnreadable", extra: 1 }],
    ["message params that are not a record", { key: "projectFileUnreadable", params: ["x"] }],
    ["message params with a non-scalar value", { key: "projectFileUnreadable", params: { path: {} } }],
  ])("refuses an unreadable file with %s", (_label, message) => {
    const { send } = worker();
    const response = send({
      ...request({ knownFiles: ["locked.tex"] }),
      unreadable: [{ file: "locked.tex", sourceRevision: 1, message }],
    });
    expect(errorOf(response).code).toBe("invalid_request");
  });

  it("refuses a project that exceeds the source file limit after loading known files", () => {
    const { send } = worker();
    const knownFiles = Array.from({ length: PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles + 1 }, (_, i) => `f${i}.tex`);
    expect(errorOf(send(request({ knownFiles })))).toMatchObject({ code: "input_limit", retryable: false });
  });

  it("reports a file whose parser crashes as an analysis failure and keeps the rest", () => {
    const { send } = worker();
    parser.failFor = "bad.tex";
    parser.failWith = new Error("unbalanced braces");
    const snapshot = snapshotOf(
      send(request({ knownFiles: ["bad.tex", "ok.tex"], upserts: [upsert("bad.tex", "{"), upsert("ok.tex", "ok")] })),
    );
    expect(snapshot.stats.parsedFileCount).toBe(1);
    expect(snapshot.fileStates["bad.tex"]).toMatchObject({ status: "error", statusReason: "analysisFailed" });
    expect(snapshot.diagnostics.find((d) => d.location.file === "bad.tex")?.message).toEqual({
      key: "analysisFailed",
      params: { message: "unbalanced braces" },
    });

    parser.failWith = "not an error";
    const next = snapshotOf(send(request({ knownFiles: ["bad.tex"], upserts: [upsert("bad.tex", "{{", 2)] })));
    expect(next.diagnostics[0].message).toEqual({
      key: "analysisFailed",
      params: { message: "The source parser failed." },
    });
  });

  it("turns an unexpected failure into a retryable analysis error", () => {
    const { send } = worker();
    vi.spyOn(performance, "now").mockImplementation(() => {
      throw new Error("clock unavailable");
    });
    expect(errorOf(send(request()))).toEqual({
      code: "analysis_failed",
      message: "Project intelligence failed inside the worker.",
      retryable: true,
    });
  });
});

describe("malformed messages", () => {
  it("answers malformed requests that carry a usable request id and identity", () => {
    const { send, posted } = worker();
    const identity = { projectId: "p", projectRevision: 1, requestGeneration: 1 };
    expect(send({ type: "analyze", requestId: 7, identity })).toMatchObject({
      type: "error",
      requestId: 7,
      identity,
      error: { code: "invalid_request", message: "Malformed project-intelligence worker request.", retryable: false },
    });
    for (const message of [null, "analyze", { requestId: 0, identity }, { requestId: 8, identity: {} }, { requestId: 9 }]) {
      send(message);
    }
    expect(posted).toHaveLength(1);
  });
});

describe("installProjectIntelligenceWorker", () => {
  it("wires the host message events to the worker", () => {
    const host: { listener?: (event: MessageEvent<unknown>) => void } = {};
    const posted: ProjectIntelligenceWorkerResponse[] = [];
    const close = vi.fn();
    installProjectIntelligenceWorker({
      postMessage: (message) => posted.push(message),
      close,
      addEventListener: (_type, handler) => {
        host.listener = handler;
      },
    });
    host.listener?.({ data: request() } as MessageEvent<unknown>);
    expect(posted[0]?.type).toBe("result");
    host.listener?.({ data: { protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION, type: "dispose" } } as MessageEvent<unknown>);
    expect(close).toHaveBeenCalledOnce();
  });
});
