// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingInput,
  type ProofreadingSuggestRequest,
  type ProofreadingWorkerRequest,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  readDictionary: vi.fn<
    (id: string) => Promise<{ aff: Uint8Array; dic: Uint8Array }>
  >(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readDictionary: mocks.readDictionary,
}));

class WorkerMock {
  static current: WorkerMock | null = null;
  static created = 0;

  readonly posted: ProofreadingWorkerRequest[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  terminated = false;

  constructor() {
    WorkerMock.current = this;
    WorkerMock.created += 1;
  }

  postMessage(message: ProofreadingWorkerRequest) {
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

  terminate() {
    this.terminated = true;
  }
}

vi.stubGlobal("Worker", WorkerMock);

const { cancelProofreading, proofreadDocument, suggestSpelling } = await import(
  "./client"
);

function suggestRequests(): ProofreadingSuggestRequest[] {
  return (WorkerMock.current?.posted ?? []).filter(
    (message): message is ProofreadingSuggestRequest =>
      message.type === "suggest",
  );
}

async function nextSuggestRequest(count: number) {
  await vi.waitFor(() => expect(suggestRequests().length).toBe(count));
  return suggestRequests()[count - 1] as ProofreadingSuggestRequest;
}

function answer(request: ProofreadingSuggestRequest, texts: string[]) {
  WorkerMock.current?.emit("message", {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "suggestions",
    requestId: request.requestId,
    locale: request.locale,
    word: request.word,
    suggestions: texts.map((text) => ({ text, kind: 0 })),
  });
}

beforeEach(() => {
  mocks.readDictionary.mockReset();
  mocks.readDictionary.mockResolvedValue({
    aff: new Uint8Array([1]),
    dic: new Uint8Array([2]),
  });
});

afterEach(() => {
  vi.useRealTimers();
  cancelProofreading("source");
});

describe("on-demand spelling suggestions", () => {
  it("asks the worker once and remembers the answer", async () => {
    const pending = suggestSpelling("papiru", "fr_FR");
    const request = await nextSuggestRequest(1);
    expect(request).toMatchObject({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "suggest",
      locale: "fr_FR",
      word: "papiru",
    });
    answer(request, ["papier"]);
    await expect(pending).resolves.toEqual([{ text: "papier", kind: 0 }]);

    await expect(suggestSpelling("papiru", "fr_FR")).resolves.toEqual([
      { text: "papier", kind: 0 },
    ]);
    expect(suggestRequests()).toHaveLength(1);
  });

  it("delivers a downloaded dictionary before asking for suggestions", async () => {
    const before = WorkerMock.current?.posted.length ?? 0;
    const pending = suggestSpelling("papiru", "cs-CZ");
    await vi.waitFor(() =>
      expect(
        WorkerMock.current?.posted
          .slice(before)
          .map((message) => message.type),
      ).toEqual(["dictionary", "suggest"]),
    );
    expect(mocks.readDictionary).toHaveBeenCalledWith("cs_CZ");
    const request = suggestRequests().at(-1) as ProofreadingSuggestRequest;
    expect(request.locale).toBe("cs_CZ");
    answer(request, ["papíru"]);
    await expect(pending).resolves.toEqual([{ text: "papíru", kind: 0 }]);
  });

  it("gives up quietly on a slow answer without restarting the worker", async () => {
    vi.useFakeTimers();
    const worker = WorkerMock.current;
    const before = suggestRequests().length;
    const pending = suggestSpelling("zzslow", "en_US");
    await vi.advanceTimersByTimeAsync(0);
    expect(suggestRequests()).toHaveLength(before + 1);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toEqual([]);
    expect(worker?.terminated).toBe(false);
    expect(WorkerMock.current).toBe(worker);

    const retry = suggestSpelling("zzslow", "en_US");
    await vi.advanceTimersByTimeAsync(0);
    expect(suggestRequests()).toHaveLength(before + 2);
    answer(suggestRequests().at(-1) as ProofreadingSuggestRequest, ["slow"]);
    await expect(retry).resolves.toEqual([{ text: "slow", kind: 0 }]);
  });

  it("settles pending suggestions when the worker fails", async () => {
    const pending = suggestSpelling("zzfail", "en_US");
    await vi.waitFor(() =>
      expect(suggestRequests().some((request) => request.word === "zzfail")).toBe(
        true,
      ),
    );
    WorkerMock.current?.emit("error");
    await expect(pending).resolves.toEqual([]);
  });

  it("ignores words longer than the protocol allows", async () => {
    const before = suggestRequests().length;
    await expect(suggestSpelling("x".repeat(200), "en_US")).resolves.toEqual([]);
    expect(suggestRequests()).toHaveLength(before);
  });

  it("does not disturb a document proofread that is in flight", async () => {
    const document = proofreadDocument({
      identity: { projectId: "p", path: "a.tex", revision: 1, surface: "source" },
      text: "hola",
      format: "plaintext" as ProofreadingInput["format"],
      mode: "spelling" as ProofreadingInput["mode"],
      ignoredWords: [],
      preferences: { showRegionalism: true, showWordChoice: true, dictionaryLocale: "en_US" },
    }).catch((error: Error) => error);
    const pending = suggestSpelling("zzdoc", "en_US");
    answer(await nextSuggestRequestFor("zzdoc"), ["doc"]);
    await expect(pending).resolves.toEqual([{ text: "doc", kind: 0 }]);
    cancelProofreading("source");
    expect(await document).toBeInstanceOf(Error);
  });
});

async function nextSuggestRequestFor(word: string) {
  await vi.waitFor(() =>
    expect(suggestRequests().some((request) => request.word === word)).toBe(true),
  );
  return suggestRequests().find(
    (request) => request.word === word,
  ) as ProofreadingSuggestRequest;
}
