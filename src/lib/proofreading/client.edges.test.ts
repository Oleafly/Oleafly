// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingSuggestRequest,
  type ProofreadingWorkerRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { useProofreadingStore } from "@/store/proofreading";

type Payload = { aff: Uint8Array; dic: Uint8Array };

const copy = enCore.proofreading;

const mocks = vi.hoisted(() => ({
  readDictionary: vi.fn<(id: string) => Promise<{ aff: Uint8Array; dic: Uint8Array }>>(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readDictionary: mocks.readDictionary,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

const control = {
  constructThrows: false,
  refuse: new Set<string>(),
};

class WorkerMock {
  static all: WorkerMock[] = [];
  readonly posted: ProofreadingWorkerRequest[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  terminated = false;

  constructor() {
    if (control.constructThrows) throw new Error("no worker");
    WorkerMock.all.push(this);
  }

  postMessage(message: ProofreadingWorkerRequest) {
    if (control.refuse.has(message.type)) throw new Error("structured clone failed");
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(type === "message" ? { data } : new Event(type));
    }
  }

  respond(data: unknown) {
    this.emit("message", data);
  }

  terminate() {
    this.terminated = true;
  }

  proofreads() {
    return this.posted.filter((message) => message.type === "proofread");
  }

  suggests() {
    return this.posted.filter(
      (message): message is ProofreadingSuggestRequest => message.type === "suggest",
    );
  }
}

vi.stubGlobal("Worker", WorkerMock);

const {
  cancelProofreading,
  forgetProofreadingDictionary,
  getRetainedProofreadingResult,
  proofreadDocument,
  retryProofreading,
  suggestSpelling,
} = await import("./client");

function latest(): WorkerMock {
  const worker = WorkerMock.all.at(-1);
  if (!worker) throw new Error("no worker");
  return worker;
}

function input(overrides: Record<string, unknown> = {}) {
  const { identity, ...rest } = overrides as { identity?: Record<string, unknown> };
  return {
    cacheKey: "cache-v1",
    identity: {
      projectId: "project" as string | null,
      path: "main.tex",
      revision: 1,
      surface: "source" as "source" | "visual",
      ...identity,
    },
    format: "latex" as const,
    mode: "combined" as const,
    text: "alpha beta",
    ignoredWords: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dialect: "american" as const,
      dictionaryLocale: "en_US",
    },
    ...rest,
  };
}

function resultFor(request: ProofreadingWorkerRequest, overrides: Record<string, unknown> = {}) {
  if (request.type !== "proofread") throw new Error("not a proofread request");
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: request.requestId,
    identity: request.identity,
    status: "ready",
    diagnostics: [],
    ...overrides,
  } as ProofreadingWorkerResponse;
}

function errorFor(request: ProofreadingWorkerRequest) {
  if (request.type !== "proofread") throw new Error("not a proofread request");
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "error",
    requestId: request.requestId,
    identity: request.identity,
    error: { message: "engine blew up", code: "analysis_failed", retryable: true },
  };
}

function answer(worker: WorkerMock, request: ProofreadingSuggestRequest, texts: string[]) {
  worker.respond({
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "suggestions",
    requestId: request.requestId,
    locale: request.locale,
    word: request.word,
    suggestions: texts.map((text) => ({ text, kind: 0 })),
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const PAYLOAD: Payload = { aff: new Uint8Array([1]), dic: new Uint8Array([2]) };

beforeEach(() => {
  WorkerMock.all.at(-1)?.emit("error");
  control.constructThrows = false;
  control.refuse = new Set();
  mocks.readDictionary.mockReset();
  mocks.readDictionary.mockResolvedValue(PAYLOAD);
  mocks.logError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  useProofreadingStore.getState().clear("source");
  useProofreadingStore.getState().clear("visual");
});

describe("suggestion lookups", () => {
  it("remembers at most 500 lookups and forgets the oldest first", async () => {
    const words = Array.from({ length: 501 }, (_, index) => `lookup${index.toString(36)}x`);
    for (const word of words) void suggestSpelling(word, "en_US");
    const worker = latest();
    expect(worker.suggests()).toHaveLength(501);

    void suggestSpelling(words[500], "en_US");
    expect(worker.suggests()).toHaveLength(501);

    void suggestSpelling(words[0], "en_US");
    expect(worker.suggests()).toHaveLength(502);
    expect(worker.suggests().at(-1)?.word).toBe(words[0]);
  });

  it("answers nothing when the worker cannot start", async () => {
    control.constructThrows = true;
    await expect(suggestSpelling("startfail", "en_US")).resolves.toEqual([]);
  });

  it("answers nothing when the lookup cannot be posted", async () => {
    control.refuse.add("suggest");
    await expect(suggestSpelling("postfail", "en_US")).resolves.toEqual([]);
    expect(latest().suggests()).toEqual([]);
  });

  it("answers nothing when a downloaded pack cannot be read", async () => {
    mocks.readDictionary.mockRejectedValue(new Error("missing"));
    await expect(suggestSpelling("slovo", "cs_CZ")).resolves.toEqual([]);
    expect(latest().suggests()).toEqual([]);
  });

  it("does not ask the worker once a lookup timed out while its pack was read", async () => {
    vi.useFakeTimers();
    const pack = deferred<Payload>();
    mocks.readDictionary.mockReturnValue(pack.promise);
    const lookup = suggestSpelling("pomalu", "sk_SK");
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(lookup).resolves.toEqual([]);
    pack.resolve(PAYLOAD);
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().posted.map((message) => message.type)).toEqual(["dictionary"]);
  });

  it("keeps the first answer and ignores answers nobody waits for", async () => {
    const lookup = suggestSpelling("twiceword", "en_US");
    const worker = latest();
    const [request] = worker.suggests();
    worker.respond({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "suggestions",
      requestId: 987_654,
      locale: "en_US",
      word: "other",
      suggestions: [{ text: "nope", kind: 0 }],
    });
    answer(worker, request, ["twice"]);
    answer(worker, request, ["thrice"]);
    await expect(lookup).resolves.toEqual([{ text: "twice", kind: 0 }]);
    expect(worker.terminated).toBe(false);
  });

  it("asks again after the dictionary's suggestions are forgotten", async () => {
    const first = suggestSpelling("forgetme", "en_US");
    const german = suggestSpelling("wortt", "de_DE");
    const worker = latest();
    answer(worker, worker.suggests()[0], ["forget me"]);
    answer(worker, worker.suggests()[1], ["wort"]);
    await expect(first).resolves.toEqual([{ text: "forget me", kind: 0 }]);
    await expect(german).resolves.toEqual([{ text: "wort", kind: 0 }]);
    await expect(suggestSpelling("forgetme", "en_US")).resolves.toEqual([{ text: "forget me", kind: 0 }]);
    expect(worker.suggests()).toHaveLength(2);

    expect(forgetProofreadingDictionary("en-US")).toBe(false);
    void suggestSpelling("forgetme", "en_US");
    await expect(suggestSpelling("wortt", "de_DE")).resolves.toEqual([{ text: "wort", kind: 0 }]);
    expect(worker.suggests().map((request) => request.word)).toEqual(["forgetme", "wortt", "forgetme"]);
    expect(worker.terminated).toBe(false);
  });
});

describe("pack delivery for documents", () => {
  it("fails the document when the pack cannot be posted to the worker", async () => {
    control.refuse.add("dictionary");
    const promise = proofreadDocument(input({ preferences: { ...input().preferences, dictionaryLocale: "cs_CZ" } }));
    await expect(promise).rejects.toMatchObject({ code: "post_message_failed", message: copy.postFailed });
    expect(useProofreadingStore.getState().source).toMatchObject({ phase: "error", message: copy.postFailed });
    expect(latest().proofreads()).toEqual([]);
  });

  it("sends only the newest request when an unreadable pack was shared", async () => {
    const pack = deferred<Payload>();
    mocks.readDictionary.mockReturnValue(pack.promise);
    const czech = { ...input().preferences, dictionaryLocale: "cs_CZ" };
    const first = proofreadDocument(input({ preferences: czech }));
    const superseded = expect(first).rejects.toMatchObject({ code: "superseded" });
    const second = proofreadDocument(input({ preferences: czech, text: "alpha beta gamma" }));
    await superseded;
    pack.reject(new Error("unreadable"));
    await vi.waitFor(() => expect(latest().proofreads()).toHaveLength(1));
    await tick();
    expect(latest().proofreads()).toHaveLength(1);
    expect(latest().proofreads()[0]).toMatchObject({ text: "alpha beta gamma" });
    expect(mocks.readDictionary).toHaveBeenCalledTimes(1);
    latest().respond(resultFor(latest().proofreads()[0]));
    await expect(second).resolves.toMatchObject({ status: "ready" });
  });
});

describe("worker control", () => {
  it("logs a cancel the worker refuses and still drops the request", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({ code: "cancelled" });
    control.refuse.add("cancel");
    cancelProofreading("source");
    await rejection;
    expect(mocks.logError).toHaveBeenCalledWith("cancel proofreading", expect.any(Error));
    expect(useProofreadingStore.getState().source.phase).toBe("idle");
  });

  it("restarts work on every surface when one surface is retried", async () => {
    const visual = proofreadDocument(input({ identity: { surface: "visual", path: "visual.tex" } }));
    const failed = expect(visual).rejects.toMatchObject({ code: "analysis_failed" });
    const worker = latest();
    worker.respond(errorFor(worker.proofreads()[0]));
    await failed;
    expect(useProofreadingStore.getState().visual.phase).toBe("error");

    const source = proofreadDocument(input());
    const restarted = expect(source).rejects.toMatchObject({ code: "worker_restarted", message: copy.restarted });
    retryProofreading("visual");
    await restarted;
    expect(worker.terminated).toBe(true);
    expect(useProofreadingStore.getState().source.phase).toBe("idle");
    expect(useProofreadingStore.getState().visual.phase).toBe("idle");
  });

  it("ignores messages from a worker it already replaced", async () => {
    const first = proofreadDocument(input());
    const stopped = expect(first).rejects.toMatchObject({ code: "worker_failed" });
    const oldWorker = latest();
    oldWorker.emit("error");
    await stopped;

    const second = proofreadDocument(input({ text: "alpha beta delta" }));
    const newWorker = latest();
    expect(newWorker).not.toBe(oldWorker);
    const request = newWorker.proofreads()[0];
    oldWorker.respond(resultFor(request, { status: "partial" }));
    oldWorker.emit("error");
    expect(useProofreadingStore.getState().source.phase).toBe("loading");

    newWorker.respond({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result",
      requestId: 123_456,
      identity: { ...request.identity, path: "ghost.tex" },
      status: "ready",
      diagnostics: [],
    });
    expect(newWorker.terminated).toBe(false);
    newWorker.respond(resultFor(request));
    await expect(second).resolves.toMatchObject({ status: "ready" });
  });
});

describe("retained results", () => {
  it("returns a retained result only for the exact document and settings", async () => {
    const promise = proofreadDocument(input({ cacheKey: "k1", text: "retained text" }));
    const worker = latest();
    const response = resultFor(worker.proofreads()[0]);
    worker.respond(response);
    await promise;

    const exact = {
      cacheKey: "k1",
      projectId: "project",
      path: "main.tex",
      text: "retained text",
      mode: "combined" as const,
      surface: "source" as const,
    };
    expect(getRetainedProofreadingResult(exact)).toEqual(response);
    for (const change of [
      { cacheKey: "k2" },
      { projectId: null },
      { path: "other.tex" },
      { text: "changed text" },
      { mode: "spelling" as const },
      { surface: "visual" as const },
    ]) {
      expect(getRetainedProofreadingResult({ ...exact, ...change })).toBeNull();
    }
  });
});
