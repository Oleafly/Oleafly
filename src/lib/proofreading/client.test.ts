// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingWorkerRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";
import { useProofreadingStore } from "@/store/proofreading";
import {
  cancelProofreading,
  getRetainedProofreadingResult,
  proofreadDocument,
} from "./client";

class WorkerMock {
  static current: WorkerMock | null = null;

  request: ProofreadingWorkerRequest | null = null;
  private readonly messageListeners: Array<
    (event: MessageEvent<unknown>) => void
  > = [];

  constructor() {
    WorkerMock.current = this;
  }

  postMessage(message: ProofreadingWorkerRequest) {
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
    }
  }

  terminate() {}

  respond(response: ProofreadingWorkerResponse) {
    for (const listener of this.messageListeners) {
      listener(new MessageEvent("message", { data: response }));
    }
  }
}

vi.stubGlobal("Worker", WorkerMock);

afterEach(() => {
  cancelProofreading("source");
  vi.useRealTimers();
});

describe("proofreading client retention", () => {
  it("retains the exact result before publishing a ready store state", async () => {
    const input = {
      cacheKey: "settings-and-dictionary-v1",
      identity: {
        projectId: "project",
        path: "main.tex",
        revision: 7,
        surface: "source" as const,
      },
      format: "latex" as const,
      mode: "combined" as const,
      text: "qwertzuiopz",
      ignoredWords: [],
      preferences: {
        showRegionalism: true,
        showWordChoice: true,
        dialect: "american" as const,
        dictionaryLocale: "en_US",
      },
    };
    const promise = proofreadDocument(input);
    const worker = WorkerMock.current;
    expect(worker?.request?.type).toBe("proofread");
    if (worker?.request?.type !== "proofread") return;

    const retainedInput = {
      cacheKey: input.cacheKey,
      projectId: input.identity.projectId,
      path: input.identity.path,
      text: input.text,
      mode: input.mode,
      surface: input.identity.surface,
    };
    let retainedWhenReady = null;
    const unsubscribe = useProofreadingStore.subscribe((state) => {
      if (state.source.phase === "ready") {
        retainedWhenReady =
          getRetainedProofreadingResult(retainedInput);
      }
    });
    const response = {
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result" as const,
      requestId: worker.request.requestId,
      identity: worker.request.identity,
      status: "ready" as const,
      diagnostics: [
        {
          from: 0,
          to: input.text.length,
          message: "Possible misspelling",
          kind: "Spelling",
          source: "hunspell" as const,
          word: input.text,
          suggestions: [],
        },
      ],
    };

    worker.respond(response);
    await expect(promise).resolves.toEqual(response);
    unsubscribe();

    expect(retainedWhenReady).toEqual(response);
    expect(getRetainedProofreadingResult(retainedInput)).toEqual(
      response,
    );
  });

  it("does not terminate supported book-sized analysis at the short-document deadline", async () => {
    vi.useFakeTimers();
    const input = {
      identity: {
        projectId: "large-project",
        path: "book.tex",
        revision: 1,
        surface: "source" as const,
      },
      format: "latex" as const,
      mode: "combined" as const,
      text: "prose ".repeat(75_000),
      ignoredWords: [],
      preferences: {
        showRegionalism: true,
        showWordChoice: true,
        dialect: "american" as const,
        dictionaryLocale: "en_US",
      },
    };
    const promise = proofreadDocument(input);
    const worker = WorkerMock.current;
    expect(worker?.request?.type).toBe("proofread");
    if (worker?.request?.type !== "proofread") return;

    await vi.advanceTimersByTimeAsync(25_001);
    expect(useProofreadingStore.getState().source.phase).toBe("loading");

    const response = {
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result" as const,
      requestId: worker.request.requestId,
      identity: worker.request.identity,
      status: "ready" as const,
      diagnostics: [],
    };
    worker.respond(response);
    await expect(promise).resolves.toEqual(response);
  });
});
