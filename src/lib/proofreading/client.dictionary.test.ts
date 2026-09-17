// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingInput,
  type ProofreadingWorkerRequest,
} from "@oleafly/editor";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

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

  readonly posted: ProofreadingWorkerRequest[] = [];

  constructor() {
    WorkerMock.current = this;
  }

  postMessage(message: ProofreadingWorkerRequest) {
    this.posted.push(message);
  }

  addEventListener() {}

  terminate() {}
}

vi.stubGlobal("Worker", WorkerMock);

const { cancelProofreading, proofreadDocument } = await import("./client");

function input(
  path: string,
  dictionaryLocale?: string,
): Parameters<typeof proofreadDocument>[0] {
  return {
    identity: {
      projectId: "project",
      path,
      revision: 1,
      surface: "source",
    },
    text: "hola",
    format: "plaintext" as ProofreadingInput["format"],
    mode: "spelling" as ProofreadingInput["mode"],
    ignoredWords: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      ...(dictionaryLocale ? { dictionaryLocale } : {}),
    },
  };
}

let baseline = 0;

function fresh(): ProofreadingWorkerRequest[] {
  return (WorkerMock.current?.posted ?? []).slice(baseline);
}

async function posted(count = 1): Promise<ProofreadingWorkerRequest[]> {
  await vi.waitFor(() => expect(fresh().length).toBeGreaterThanOrEqual(count));
  return fresh();
}

beforeEach(() => {
  baseline = WorkerMock.current?.posted.length ?? 0;
  mocks.readDictionary.mockReset();
  mocks.readDictionary.mockResolvedValue({
    aff: new Uint8Array([1]),
    dic: new Uint8Array([2]),
  });
  useSettingsStore.getState().setDictionaryLocale("en_US");
});

afterEach(() => {
  cancelProofreading("source");
});

describe("dictionary delivery to the worker", () => {
  it("sends a downloaded pack once, before the document that needs it", async () => {
    void proofreadDocument(input("one.tex", "es_ES")).catch(() => undefined);
    const messages = await posted(2);

    expect(messages[0]).toMatchObject({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "dictionary",
      locale: "es_ES",
    });
    expect(messages[1]).toMatchObject({ type: "proofread" });
    expect(mocks.readDictionary).toHaveBeenCalledWith("es_ES");

    void proofreadDocument(input("two.tex", "es_ES")).catch(() => undefined);
    const later = await posted(3);
    expect(mocks.readDictionary).toHaveBeenCalledTimes(1);
    expect(
      later.filter((message) => message.type === "dictionary"),
    ).toHaveLength(1);
  });

  it("never asks the backend for a pack that ships with the app", async () => {
    void proofreadDocument(input("three.tex", "fr_FR")).catch(() => undefined);
    const messages = await posted();

    expect(messages.every((message) => message.type === "proofread")).toBe(true);
    expect(mocks.readDictionary).not.toHaveBeenCalled();
  });

  it("lets the worker report an uninstalled pack instead of proofreading with another language", async () => {
    mocks.readDictionary.mockRejectedValue(new Error("not installed"));

    void proofreadDocument(input("four.tex", "it_IT")).catch(() => undefined);
    const messages = await posted();

    expect(mocks.readDictionary).toHaveBeenCalledWith("it_IT");
    expect(messages.filter((message) => message.type === "dictionary")).toHaveLength(0);
    expect(messages.at(-1)).toMatchObject({
      type: "proofread",
      preferences: { dictionaryLocale: "it_IT" },
    });
    expect(useProofreadingStore.getState().source.phase).not.toBe("unavailable");
  });

  it("falls back to the app setting when the caller names no language", async () => {
    useSettingsStore.getState().setDictionaryLocale("de_DE");
    void proofreadDocument(input("five.tex")).catch(() => undefined);
    const messages = await posted();
    const proofreads = messages.filter(
      (message) => message.type === "proofread",
    );
    const request = proofreads[proofreads.length - 1];

    expect(request).toMatchObject({
      preferences: { dictionaryLocale: "de_DE" },
    });
    expect(mocks.readDictionary).not.toHaveBeenCalled();
  });
});
