// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { PROJECT_INTELLIGENCE_PROTOCOL_VERSION } from "./types";
import {
  ProjectIntelligenceWorkerClient,
  ProjectIntelligenceWorkerError,
  type ProjectIntelligenceWorkerFactory,
} from "./worker-client";
import type { ProjectIntelligenceWorkerRequest } from "./worker-protocol";

const identity = { projectId: "p", projectRevision: 1, requestGeneration: 1 };

function snapshotShell(id = identity) {
  return {
    protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
    identity: id,
    status: "success",
    fileStates: {},
    definitions: [],
    uses: [],
    diagnostics: [],
    outlines: {},
    hierarchy: { roots: [], nodes: [], edges: [] },
    bibliography: { entries: [], duplicates: [], declarationUseIds: [] },
    stats: { fileCount: 0, characterCount: 0, parsedFileCount: 0, reusedFileCount: 0, durationMs: 0 },
    detectedPackages: [],
    documentClasses: [],
  };
}

class FakeWorker {
  readonly posted: ProjectIntelligenceWorkerRequest[] = [];
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  terminated = false;
  failPost = false;

  postMessage(message: ProjectIntelligenceWorkerRequest): void {
    if (this.failPost) throw new Error("DataCloneError");
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  lastRequestId(): number {
    const last = this.posted.at(-1) as { requestId: number };
    return last.requestId;
  }
}

const input = {
  identity,
  reset: true,
  mainDocument: "main.tex",
  knownFiles: [],
  upserts: [],
  removals: [],
  unreadable: [],
};

let workers: FakeWorker[];
let client: ProjectIntelligenceWorkerClient;

const factory: ProjectIntelligenceWorkerFactory = () => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker as unknown as ReturnType<ProjectIntelligenceWorkerFactory>;
};

function reply(worker: FakeWorker, data: Record<string, unknown>): void {
  worker.emit("message", {
    protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
    requestId: worker.lastRequestId(),
    identity,
    ...data,
  });
}

beforeEach(() => {
  workers = [];
  client = new ProjectIntelligenceWorkerClient(factory, 1_000);
});

afterEach(() => {
  client.dispose();
  vi.useRealTimers();
});

describe("ProjectIntelligenceWorkerError", () => {
  it("uses the localized reason sentence or a raw message", () => {
    const keyed = new ProjectIntelligenceWorkerError("timedOut", "timeout", true);
    expect(keyed).toMatchObject({ message: enCore.intelligence.timedOut, code: "timeout", retryable: true, reasonKey: "timedOut" });
    const raw = new ProjectIntelligenceWorkerError({ message: "parser crashed" }, "internal", false);
    expect(raw.message).toBe("parser crashed");
    expect(raw.reasonKey).toBeUndefined();
    expect(raw.name).toBe("ProjectIntelligenceWorkerError");
  });
});

describe("ProjectIntelligenceWorkerClient", () => {
  it("refuses a non-positive or non-finite timeout", () => {
    expect(() => new ProjectIntelligenceWorkerClient(factory, 0)).toThrow(RangeError);
    expect(() => new ProjectIntelligenceWorkerClient(factory, Number.POSITIVE_INFINITY)).toThrow(
      "Project-intelligence timeout must be positive.",
    );
  });

  it("starts one worker lazily and resolves analysis with the snapshot", async () => {
    expect(workers).toHaveLength(0);
    const pending = client.analyze(input);
    const [worker] = workers;
    expect(worker.posted[0]).toMatchObject({ type: "analyze", requestId: 1, mainDocument: "main.tex" });
    reply(worker, { type: "result", snapshot: snapshotShell() });
    await expect(pending).resolves.toMatchObject({ identity });

    const second = client.analyze(input);
    expect(workers).toHaveLength(1);
    expect(worker.lastRequestId()).toBe(2);
    reply(worker, { type: "result", snapshot: snapshotShell() });
    await second;
  });

  it("returns bibliography entries and rejects worker errors with their code", async () => {
    const entries = client.bibliographyEntries(identity, ["a", "b"]);
    const [worker] = workers;
    expect(worker.posted[0]).toMatchObject({ type: "bibliography-entries", entryIds: ["a", "b"] });
    reply(worker, { type: "bibliography-entries", entries: [] });
    await expect(entries).resolves.toEqual([]);

    const failing = client.bibliographyEntries(identity, ["a"]);
    reply(worker, { type: "error", error: { code: "stale_snapshot", message: "Snapshot is stale", retryable: false } });
    await expect(failing).rejects.toMatchObject({ code: "stale_snapshot", message: "Snapshot is stale", retryable: false });
    expect(worker.terminated).toBe(false);
  });

  it("restarts the worker after a malformed response", async () => {
    const pending = client.analyze(input);
    workers[0].emit("message", { nonsense: true });
    await expect(pending).rejects.toMatchObject({ code: "protocol_error", reasonKey: "malformedResponse" });
    expect(workers[0].terminated).toBe(true);
    const next = client.analyze(input);
    expect(workers).toHaveLength(2);
    reply(workers[1], { type: "result", snapshot: snapshotShell() });
    await next;
  });

  it("ignores responses for requests it is not waiting on", async () => {
    const pending = client.analyze(input);
    const [worker] = workers;
    worker.emit("message", {
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      requestId: 99,
      identity,
      type: "result",
      snapshot: snapshotShell(),
    });
    expect(worker.terminated).toBe(false);
    reply(worker, { type: "result", snapshot: snapshotShell() });
    await pending;
  });

  it("fails the worker when a response belongs to another project identity", async () => {
    const pending = client.analyze(input);
    workers[0].emit("message", {
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      requestId: 1,
      identity: { ...identity, requestGeneration: 2 },
      type: "result",
      snapshot: snapshotShell({ ...identity, requestGeneration: 2 }),
    });
    await expect(pending).rejects.toMatchObject({ reasonKey: "identityMismatch" });
  });

  it("fails the worker when the snapshot identity disagrees with its envelope", async () => {
    void client.analyze(input);
    const other = client.bibliographyEntries(identity, []);
    workers[0].emit("message", {
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      requestId: 1,
      identity,
      type: "result",
      snapshot: snapshotShell({ ...identity, projectRevision: 7 }),
    });
    await expect(other).rejects.toMatchObject({ reasonKey: "malformedSnapshotIdentity" });
    expect(workers[0].terminated).toBe(true);
  });

  it("rejects every pending request when the worker crashes", async () => {
    const first = client.analyze(input);
    const second = client.bibliographyEntries(identity, []);
    workers[0].emit("error");
    await expect(first).rejects.toMatchObject({ code: "worker_failed" });
    await expect(second).rejects.toMatchObject({ code: "worker_failed" });

    const third = client.analyze(input);
    workers[1].emit("messageerror");
    await expect(third).rejects.toMatchObject({ code: "worker_failed" });
  });

  it("reports a worker that cannot be created", async () => {
    const broken = new ProjectIntelligenceWorkerClient(() => {
      throw new Error("Worker is not defined");
    });
    await expect(broken.analyze(input)).rejects.toMatchObject({
      code: "worker_unavailable",
      reasonKey: "workerUnavailable",
    });
    broken.dispose();
  });

  it("reports a request that cannot be posted", async () => {
    const pending = client.analyze(input);
    workers[0].failPost = true;
    await expect(client.analyze(input)).rejects.toMatchObject({ code: "post_message_failed" });
    reply(workers[0], { type: "result", snapshot: snapshotShell() });
    await pending;
  });

  it("times out a request and restarts the worker for the others", async () => {
    vi.useFakeTimers();
    const slow = new ProjectIntelligenceWorkerClient(factory, 500);
    const first = slow.analyze(input);
    const firstWorker = workers[0];
    vi.advanceTimersByTime(250);
    const second = slow.bibliographyEntries(identity, []);
    vi.advanceTimersByTime(250);
    await expect(first).rejects.toMatchObject({ code: "timeout", reasonKey: "timedOut" });
    await expect(second).rejects.toMatchObject({ code: "worker_restarted" });
    expect(firstWorker.terminated).toBe(true);
    vi.advanceTimersByTime(1_000);
    slow.dispose();
  });

  it("rejects pending work and new requests once disposed, and disposes only once", async () => {
    const pending = client.analyze(input);
    const [worker] = workers;
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed", reasonKey: "disposedDuringRequest" });
    expect(worker.posted.at(-1)).toEqual({ protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION, type: "dispose" });
    expect(worker.terminated).toBe(true);
    client.dispose();
    expect(worker.posted.filter((message) => message.type === "dispose")).toHaveLength(1);
    await expect(client.analyze(input)).rejects.toMatchObject({ code: "disposed", reasonKey: "disposed" });
  });

  it("still terminates the worker when the dispose message cannot be posted", () => {
    void client.analyze(input).catch(() => {});
    workers[0].failPost = true;
    client.dispose();
    expect(workers[0].terminated).toBe(true);
  });

  it("disposes cleanly before any worker was started", () => {
    client.dispose();
    expect(workers).toHaveLength(0);
  });
});
