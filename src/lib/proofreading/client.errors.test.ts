// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingWorkerRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { useProofreadingStore } from "@/store/proofreading";

const copy = enCore.proofreading;

const control = {
  constructThrows: false,
  postThrows: false,
};

class WorkerMock {
  static current: WorkerMock | null = null;
  static terminated = 0;

  request: ProofreadingWorkerRequest | null = null;
  private readonly messageListeners: ((
    event: MessageEvent<unknown>,
  ) => void)[] = [];
  private readonly fatalListeners: ((event: Event) => void)[] = [];

  constructor() {
    if (control.constructThrows) throw new Error("no worker");
    WorkerMock.current = this;
  }

  postMessage(message: ProofreadingWorkerRequest) {
    if (control.postThrows) throw new Error("structured clone failed");
    this.request = message;
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: MessageEvent<unknown> | Event) => void,
  ) {
    if (type === "message") {
      this.messageListeners.push(
        listener as (event: MessageEvent<unknown>) => void,
      );
    } else {
      this.fatalListeners.push(listener as (event: Event) => void);
    }
  }

  terminate() {
    WorkerMock.terminated += 1;
  }

  respond(response: unknown) {
    for (const listener of this.messageListeners) {
      listener(new MessageEvent("message", { data: response }));
    }
  }

  fail() {
    for (const listener of this.fatalListeners) listener(new Event("error"));
  }
}

vi.stubGlobal("Worker", WorkerMock);

const {
  cancelProofreading,
  proofreadDocument,
  retryProofreading,
  ProofreadingWorkerError,
} = await import("./client");

function input(overrides: Record<string, unknown> = {}) {
  return {
    cacheKey: "cache-v1",
    identity: {
      projectId: "project",
      path: "main.tex",
      revision: 1,
      surface: "source" as const,
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
    ...overrides,
  };
}

function result(
  request: ProofreadingWorkerRequest,
  overrides: Record<string, unknown> = {},
): ProofreadingWorkerResponse {
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

beforeEach(() => {
  control.constructThrows = false;
  control.postThrows = false;
  WorkerMock.terminated = 0;
});

afterEach(() => {
  vi.useRealTimers();
  useProofreadingStore.getState().clear("source");
  useProofreadingStore.getState().clear("visual");
});

describe("proofreading client failures", () => {
  it("reports a worker that cannot start", async () => {
    control.constructThrows = true;
    await expect(proofreadDocument(input())).rejects.toMatchObject({
      code: "worker_unavailable",
      message: copy.couldNotStart,
    });
    expect(useProofreadingStore.getState().source.message).toBe(
      copy.couldNotStart,
    );
  });

  it("reports a message the worker refuses", async () => {
    control.postThrows = true;
    await expect(proofreadDocument(input())).rejects.toMatchObject({
      code: "post_message_failed",
      message: copy.postFailed,
    });
  });

  it("times out and restarts the worker", async () => {
    vi.useFakeTimers();
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "timeout",
      message: copy.timedOut,
    });
    await vi.advanceTimersByTimeAsync(130_000);
    await rejection;
    expect(useProofreadingStore.getState().source.message).toBe(copy.timedOut);
    vi.useRealTimers();
  });

  it("rejects a response that is not the worker protocol", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "protocol_error",
      message: copy.invalidResponse,
    });
    WorkerMock.current?.respond({ nonsense: true });
    await rejection;
  });

  it("rejects a response for another document", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "protocol_error",
      message: copy.staleResponse,
    });
    const request = WorkerMock.current?.request;
    if (request?.type !== "proofread") throw new Error("no request");
    WorkerMock.current?.respond(
      result(request, {
        identity: { ...request.identity, path: "other.tex" },
      }),
    );
    await rejection;
  });

  it("rejects a diagnostic that runs past the document", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "protocol_error",
      message: copy.outOfRangeDiagnostic,
    });
    const request = WorkerMock.current?.request;
    if (!request) throw new Error("no request");
    WorkerMock.current?.respond(
      result(request, {
        diagnostics: [
          {
            from: 0,
            to: 9_999,
            message: "way out there",
            kind: "Spelling",
            source: "hunspell",
            word: "alpha",
            suggestions: [],
            rule: null,
          },
        ],
      }),
    );
    await rejection;
  });

  it("passes a worker error through with its code", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "analysis_failed",
      message: "engine blew up",
    });
    const request = WorkerMock.current?.request;
    if (request?.type !== "proofread") throw new Error("no request");
    WorkerMock.current?.respond({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "error",
      requestId: request.requestId,
      identity: request.identity,
      error: { message: "engine blew up", code: "analysis_failed", retryable: true },
    });
    await rejection;
    expect(useProofreadingStore.getState().source.phase).toBe("error");
  });

  it("marks the surface unavailable when initialization failed", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "initialization_failed",
    });
    const request = WorkerMock.current?.request;
    if (request?.type !== "proofread") throw new Error("no request");
    WorkerMock.current?.respond({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "error",
      requestId: request.requestId,
      identity: request.identity,
      error: {
        message: "dictionaries missing",
        code: "initialization_failed",
        retryable: false,
      },
    });
    await rejection;
    expect(useProofreadingStore.getState().source.phase).toBe("unavailable");
  });

  it("supersedes an earlier request for the same document", async () => {
    const first = proofreadDocument(input());
    const superseded = expect(first).rejects.toMatchObject({
      code: "superseded",
      message: copy.superseded,
    });
    const second = proofreadDocument(input({ text: "alpha beta gamma" }));
    await superseded;
    const request = WorkerMock.current?.request;
    if (!request) throw new Error("no request");
    WorkerMock.current?.respond(result(request));
    await expect(second).resolves.toMatchObject({ status: "ready" });
  });

  it("cancels a pending request for one path", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "cancelled",
      message: copy.cancelled,
    });
    cancelProofreading("source", "main.tex");
    await rejection;
    expect(useProofreadingStore.getState().source.phase).toBe("idle");
  });

  it("leaves a request for another path alone", async () => {
    const promise = proofreadDocument(input());
    cancelProofreading("source", "other.tex");
    const request = WorkerMock.current?.request;
    if (!request) throw new Error("no request");
    WorkerMock.current?.respond(result(request));
    await expect(promise).resolves.toMatchObject({ status: "ready" });
  });

  it("restarts the worker after a fatal worker event", async () => {
    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toMatchObject({
      code: "worker_failed",
      message: copy.stopped,
    });
    WorkerMock.current?.fail();
    await rejection;
  });

  it("retries only from a failed phase", async () => {
    retryProofreading("source");
    expect(useProofreadingStore.getState().source.phase).toBe("idle");

    const promise = proofreadDocument(input());
    const rejection = expect(promise).rejects.toBeInstanceOf(
      ProofreadingWorkerError,
    );
    WorkerMock.current?.fail();
    await rejection;
    expect(useProofreadingStore.getState().source.phase).toBe("unavailable");

    retryProofreading("source");
    expect(useProofreadingStore.getState().source.phase).toBe("idle");
  });
});
