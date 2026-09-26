// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingInput,
  type ProofreadingRequest,
  type ProofreadingWorkerRequest,
} from "@oleafly/editor";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

type Payload = { aff: Uint8Array; dic: Uint8Array };

const mocks = vi.hoisted(() => ({
  readDictionary: vi.fn<(id: string) => Promise<Payload>>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readDictionary: mocks.readDictionary,
}));

class WorkerMock {
  static all: WorkerMock[] = [];
  readonly posted: ProofreadingWorkerRequest[] = [];
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  terminated = false;

  constructor() {
    WorkerMock.all.push(this);
  }

  postMessage(message: ProofreadingWorkerRequest) {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  terminate() {
    this.terminated = true;
  }
}

vi.stubGlobal("Worker", WorkerMock);

const {
  cancelProofreading,
  forgetProofreadingDictionary,
  proofreadDocument,
} = await import("./client");

function input(
  path: string,
  surface: "source" | "visual",
  dictionaryLocale: string,
): Parameters<typeof proofreadDocument>[0] {
  return {
    identity: { projectId: "project", path, revision: 1, surface },
    text: "papíru",
    format: "plaintext" as ProofreadingInput["format"],
    mode: "spelling" as ProofreadingInput["mode"],
    ignoredWords: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dictionaryLocale,
    },
  };
}

function kinds(worker: WorkerMock): string[] {
  return worker.posted.map((message) => {
    if (message.type === "dictionary") return `dictionary:${message.locale}`;
    if (message.type === "proofread") {
      return `proofread:${message.preferences.dictionaryLocale}`;
    }
    return message.type;
  });
}

function latest(): WorkerMock {
  const worker = WorkerMock.all.at(-1);
  if (!worker) throw new Error("no worker");
  return worker;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  cancelProofreading("source");
  cancelProofreading("visual");
  WorkerMock.all.at(-1)?.emit("error", new Event("error"));
  mocks.readDictionary.mockReset();
  mocks.readDictionary.mockResolvedValue({
    aff: new Uint8Array([1]),
    dic: new Uint8Array([2]),
  });
  useSettingsStore.getState().setDictionaryLocale("en_US");
});

describe("proofreading worker lifecycle", () => {
  it("does not mark a pack delivered for a worker that never received it", async () => {
    const reads: ((payload: Payload) => void)[] = [];
    mocks.readDictionary.mockImplementation(
      () => new Promise((resolve) => reads.push(resolve)),
    );
    void proofreadDocument(input("a.tex", "source", "cs_CZ")).catch(
      () => undefined,
    );
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    const first = latest();
    first.emit("error", new Event("error"));
    expect(first.terminated).toBe(true);

    void proofreadDocument(input("b.tex", "visual", "en_US")).catch(
      () => undefined,
    );
    const second = latest();
    expect(second).not.toBe(first);
    reads[0]?.({ aff: new Uint8Array([1]), dic: new Uint8Array([2]) });
    await tick();

    void proofreadDocument(input("a.tex", "source", "cs_CZ")).catch(
      () => undefined,
    );
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    reads[1]?.({ aff: new Uint8Array([1]), dic: new Uint8Array([2]) });
    await vi.waitFor(() =>
      expect(kinds(second)).toEqual([
        "proofread:en_US",
        "dictionary:cs_CZ",
        "proofread:cs_CZ",
      ]),
    );
    expect(kinds(first)).toEqual([]);
  });

  it("reads a pack once when two surfaces ask for it together", async () => {
    void proofreadDocument(input("c.tex", "source", "pl_PL")).catch(
      () => undefined,
    );
    void proofreadDocument(input("c.tex", "visual", "pl_PL")).catch(
      () => undefined,
    );
    const worker = latest();
    await vi.waitFor(() =>
      expect(kinds(worker).filter((kind) => kind === "proofread:pl_PL")).toHaveLength(2),
    );
    expect(mocks.readDictionary).toHaveBeenCalledTimes(1);
    expect(kinds(worker).filter((kind) => kind === "dictionary:pl_PL")).toHaveLength(1);
  });

  it("tells the worker to drop work for a file the editor left", async () => {
    void proofreadDocument(input("d.tex", "source", "en_US")).catch(
      () => undefined,
    );
    const worker = latest();
    cancelProofreading("source", "d.tex");
    expect(worker.posted.at(-1)).toEqual({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "cancel",
      surface: "source",
      path: "d.tex",
    });
  });

  it("restarts the worker when a pack it holds is removed", async () => {
    void proofreadDocument(input("e.tex", "source", "sk_SK")).catch(
      () => undefined,
    );
    const worker = latest();
    await vi.waitFor(() =>
      expect(kinds(worker)).toContain("proofread:sk_SK"),
    );

    expect(forgetProofreadingDictionary("sk_SK")).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(useProofreadingStore.getState().source.phase).toBe("idle");
    expect(forgetProofreadingDictionary("sk_SK")).toBe(false);

    void proofreadDocument(input("e.tex", "source", "sk_SK")).catch(
      () => undefined,
    );
    await vi.waitFor(() =>
      expect(kinds(latest())).toEqual(["dictionary:sk_SK", "proofread:sk_SK"]),
    );
  });

  it("restarts the worker for a removed pack it still holds after newer deliveries", async () => {
    for (const locale of ["nl_NL", "da_DK", "sv_SE"]) {
      void proofreadDocument(input("g.tex", "source", locale)).catch(
        () => undefined,
      );
      const worker = latest();
      await vi.waitFor(() =>
        expect(kinds(worker)).toContain(`proofread:${locale}`),
      );
    }
    const worker = latest();

    expect(forgetProofreadingDictionary("nl_NL")).toBe(true);
    expect(worker.terminated).toBe(true);
  });

  it("restarts the worker when a pack is removed while it is being read", async () => {
    const reads: ((payload: Payload) => void)[] = [];
    mocks.readDictionary.mockImplementation(
      () => new Promise((resolve) => reads.push(resolve)),
    );
    void proofreadDocument(input("h.tex", "source", "fi_FI")).catch(
      () => undefined,
    );
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    const worker = latest();

    expect(forgetProofreadingDictionary("fi_FI")).toBe(true);
    expect(worker.terminated).toBe(true);
    reads[0]?.({ aff: new Uint8Array([1]), dic: new Uint8Array([2]) });
    await tick();
    expect(kinds(worker)).not.toContain("dictionary:fi_FI");
  });

  it("records that a missing pack is not worth retrying", async () => {
    mocks.readDictionary.mockRejectedValue(new Error("not installed"));
    void proofreadDocument(input("f.tex", "source", "hu_HU")).catch(
      () => undefined,
    );
    const worker = latest();
    await vi.waitFor(() =>
      expect(kinds(worker)).toContain("proofread:hu_HU"),
    );
    const request = worker.posted.at(-1) as ProofreadingRequest;
    worker.emit(
      "message",
      new MessageEvent("message", {
        data: {
          protocolVersion: PROOFREADING_PROTOCOL_VERSION,
          type: "error",
          requestId: request.requestId,
          identity: request.identity,
          error: {
            code: "initialization_failed",
            message: "The hu_HU spelling dictionary could not be loaded.",
            retryable: false,
          },
        },
      }),
    );
    const status = useProofreadingStore.getState().source;
    expect(status.phase).toBe("unavailable");
    expect(status.retryable).toBe(false);
  });
});
