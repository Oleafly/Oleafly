// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingInput,
  type ProofreadingWorkerRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";
import { useFilesStore } from "@/store/files";
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
  private readonly listeners: Array<(event: MessageEvent<unknown>) => void> = [];

  constructor() {
    WorkerMock.current = this;
  }

  postMessage(message: ProofreadingWorkerRequest) {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
    if (type === "message") this.listeners.push(listener);
  }

  terminate() {}

  respond(response: ProofreadingWorkerResponse) {
    for (const listener of this.listeners) {
      listener(new MessageEvent("message", { data: response }));
    }
  }
}

vi.stubGlobal("Worker", WorkerMock);

const { cancelProofreading, forgetProofreadingDictionary, proofreadDocument } =
  await import("./client");
const { currentDictionaryLocale } = await import("./effective-locale");

const FOLDER = "linked-thesis";
const TEXT = "Bakalářka na listu papíruu se skládá z vrcholů.";
const TYPO = "papíruu";

function checkOpenFile(revision: number) {
  return proofreadDocument({
    cacheKey: `opened-folder-${revision}`,
    identity: { projectId: FOLDER, path: "main.tex", revision, surface: "source" },
    text: TEXT,
    format: "latex" as ProofreadingInput["format"],
    mode: "spelling" as ProofreadingInput["mode"],
    ignoredWords: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dictionaryLocale: currentDictionaryLocale(),
    },
  });
}

function postedCheck(revision: number) {
  const worker = WorkerMock.current;
  const request = worker?.posted.find(
    (message) => message.type === "proofread" && message.identity.revision === revision,
  );
  return worker && request?.type === "proofread" ? { worker, request } : null;
}

async function proofreadRequest(revision: number) {
  await vi.waitFor(() => expect(postedCheck(revision)).not.toBeNull());
  const posted = postedCheck(revision);
  if (!posted) throw new Error("no proofreading request reached the worker");
  return posted;
}

beforeEach(() => {
  mocks.readDictionary.mockReset();
  mocks.readDictionary.mockResolvedValue({
    aff: new Uint8Array([1]),
    dic: new Uint8Array([2]),
  });
  useSettingsStore.getState().setDictionaryLocale("en_US");
  useFilesStore.setState({
    projectId: FOLDER,
    manifestHome: "folder",
    activePath: "main.tex",
    projectDictionaryLocale: "cs-CZ",
  });
});

afterEach(() => {
  cancelProofreading("source");
  forgetProofreadingDictionary("cs_CZ");
  useFilesStore.setState({
    projectId: null,
    manifestHome: "library",
    activePath: null,
    projectDictionaryLocale: null,
  });
});

describe("spell checking an opened folder", () => {
  it("checks in the language the folder's project.json declares and reports whole words", async () => {
    const result = checkOpenFile(1);
    const { worker, request } = await proofreadRequest(1);

    expect(mocks.readDictionary).toHaveBeenCalledWith("cs_CZ");
    expect(worker.posted[0]).toMatchObject({ type: "dictionary", locale: "cs_CZ" });
    expect(request.identity.projectId).toBe(FOLDER);
    expect(request.preferences.dictionaryLocale).toBe("cs_CZ");

    const from = TEXT.indexOf(TYPO);
    worker.respond({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result",
      requestId: request.requestId,
      identity: request.identity,
      status: "ready",
      activeDictionaryLocale: "cs_CZ",
      diagnostics: [
        {
          from,
          to: from + TYPO.length,
          message: "Possible misspelling",
          kind: "Spelling",
          source: "hunspell",
          word: TYPO,
          suggestions: [{ text: "papíru", kind: 0 }],
          rule: null,
        },
      ],
    });
    await result;

    const status = useProofreadingStore.getState().source;
    expect(status.phase).toBe("ready");
    expect(status.identity?.projectId).toBe(FOLDER);
    expect(status.activeDictionaryLocale).toBe("cs_CZ");
    expect(status.diagnostics.map((diagnostic) => diagnostic.word)).toEqual([TYPO]);
    expect(TEXT.slice(status.diagnostics[0]?.from, status.diagnostics[0]?.to)).toBe(TYPO);
  });

  it("re-checks in a language chosen for the folder", async () => {
    const reasons: string[] = [];
    const listener = (event: Event) =>
      reasons.push((event as CustomEvent<{ setting: string }>).detail.setting);
    window.addEventListener("oleafly:proofreading-settings-changed", listener);
    useFilesStore.setState({ projectDictionaryLocale: "fr_FR" });
    window.removeEventListener("oleafly:proofreading-settings-changed", listener);
    expect(reasons).toEqual(["projectDictionaryLocale"]);

    void checkOpenFile(2).catch(() => undefined);
    const { request } = await proofreadRequest(2);

    expect(request.preferences.dictionaryLocale).toBe("fr_FR");
    expect(mocks.readDictionary).not.toHaveBeenCalled();
  });

  it("keeps the folder's language after its pack is removed and says the pack is missing", async () => {
    const first = checkOpenFile(3);
    const delivered = await proofreadRequest(3);
    delivered.worker.respond({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result",
      requestId: delivered.request.requestId,
      identity: delivered.request.identity,
      status: "ready",
      activeDictionaryLocale: "cs_CZ",
      diagnostics: [],
    });
    await first;

    mocks.readDictionary.mockRejectedValue(new Error("not installed"));
    expect(forgetProofreadingDictionary("cs_CZ")).toBe(true);
    expect(useFilesStore.getState().projectDictionaryLocale).toBe("cs-CZ");

    const second = checkOpenFile(4).catch((error: unknown) => error);
    const { worker, request } = await proofreadRequest(4);
    expect(worker).not.toBe(delivered.worker);
    expect(worker.posted.some((message) => message.type === "dictionary")).toBe(false);
    expect(request.preferences.dictionaryLocale).toBe("cs_CZ");

    worker.respond({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "error",
      requestId: request.requestId,
      identity: request.identity,
      error: {
        code: "initialization_failed",
        message: "The cs_CZ spelling dictionary could not be loaded.",
        retryable: false,
      },
    });
    await second;

    const status = useProofreadingStore.getState().source;
    expect(status.phase).toBe("unavailable");
    expect(status.retryable).toBe(false);
    expect(status.identity?.projectId).toBe(FOLDER);
  });
});
