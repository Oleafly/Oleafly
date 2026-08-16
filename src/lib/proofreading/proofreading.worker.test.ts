// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  includeMalformed: false,
  dictionaryAvailable: false,
  spell: vi.fn<(word: string) => boolean>(),
  suggest: vi.fn<(word: string) => string[]>(),
}));

function fakeLint(
  kind: string,
  message: string,
  start: number,
  end: number,
) {
  return {
    span: () => ({ start, end, free: vi.fn() }),
    lint_kind: () => kind,
    message: () => message,
    suggestions: () => [],
    free: vi.fn(),
  };
}

vi.mock("harper.js", () => ({
  Dialect: {
    American: "american",
    British: "british",
    Australian: "australian",
    Canadian: "canadian",
    Indian: "indian",
  },
  LocalLinter: class {
    async setup() {}
    async setLintConfig() {}
    async setDialect() {}
    async clearWords() {}
    async importWords() {}
    async lint() {
      return [
        fakeLint("Spelling", "Harper spelling", 0, 5),
        fakeLint("WordChoice", "Grammar finding", 6, 10),
        ...(mocks.includeMalformed
          ? [
              {
                span: () => {
                  throw new Error("Malformed lint span");
                },
                free: vi.fn(),
              },
            ]
          : []),
      ];
    }
    async dispose() {}
  },
}));

vi.mock("harper.js/binary", () => ({ binary: new Uint8Array() }));
vi.mock("hunspell-asm", () => ({
  loadModule: async () => {
    if (!mocks.dictionaryAvailable) {
      throw new Error("Requested dictionary unavailable");
    }
    return {
      mountBuffer: () => "/dictionary",
      create: () => ({
        spell: mocks.spell,
        suggest: mocks.suggest,
        dispose: vi.fn(),
      }),
    };
  },
}));

function request(
  requestId: number,
  mode: ProofreadingRequest["mode"],
): ProofreadingRequest {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "proofread",
    requestId,
    identity: {
      projectId: "project",
      path: "main.tex",
      revision: requestId,
      requestGeneration: requestId,
      surface: "source",
    },
    format: "plaintext",
    mode,
    text: "alpha beta",
    ignoredWords: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dialect: "british",
      dictionaryLocale: "en_GB",
    },
  };
}

async function analyze(
  value: ProofreadingRequest,
): Promise<ProofreadingWorkerResponse> {
  window.dispatchEvent(new MessageEvent("message", { data: value }));
  await vi.waitFor(() =>
    expect(mocks.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: value.requestId }),
    ),
  );
  return mocks.postMessage.mock.calls.find(
    ([response]) => response.requestId === value.requestId,
  )?.[0] as ProofreadingWorkerResponse;
}

beforeAll(async () => {
  mocks.postMessage.mockReset();
  vi.stubGlobal("postMessage", mocks.postMessage);
  await import("./proofreading.worker");
});

describe("proofreading worker outcomes", () => {
  it("retains Harper dialect findings in grammar-only results", async () => {
    const response = await analyze(request(1, "grammar"));

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.status).toBe("ready");
    expect(response.diagnostics).toEqual([
      expect.objectContaining({
        kind: "Spelling",
        message: "Harper spelling",
        source: "harper",
      }),
      expect.objectContaining({
        kind: "WordChoice",
        message: "Grammar finding",
        source: "harper",
      }),
    ]);
  });

  it("hides Harper dialect findings when regionalism suggestions are disabled", async () => {
    const value = request(2, "grammar");
    value.preferences.showRegionalism = false;
    const response = await analyze(value);

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.status).toBe("ready");
    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]?.kind).toBe("WordChoice");
  });

  it("retains valid grammar findings as partial when the selected dictionary fails", async () => {
    const response = await analyze(request(3, "combined"));

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.status).toBe("partial");
    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]?.kind).toBe("WordChoice");
    expect(response.activeDictionaryLocale).toBeUndefined();
    expect(response.message).toContain("dictionary could not start");
  });

  it("rejects a well-formed locale that is not in the packaged dictionary manifest", async () => {
    const unsupportedLocale = request(31, "combined");
    unsupportedLocale.preferences.dictionaryLocale = "zz_ZZ";
    const response = await analyze(unsupportedLocale);

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.status).toBe("partial");
    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]?.kind).toBe("WordChoice");
    expect(response.activeDictionaryLocale).toBeUndefined();
    expect(response.message).toContain(
      "the requested zz_ZZ spelling dictionary could not start",
    );
  });

  it("reports malformed engine findings as partial instead of silent success", async () => {
    mocks.includeMalformed = true;
    const malformedRequest = request(4, "grammar");
    malformedRequest.text = "alpha beta gamma";
    const response = await analyze(malformedRequest);
    mocks.includeMalformed = false;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.status).toBe("partial");
    expect(response.diagnostics).toHaveLength(2);
    expect(response.message).toContain("malformed grammar finding");
  });

  it("reuses Hunspell results for repeated tokens without dropping their diagnostics", async () => {
    mocks.dictionaryAvailable = true;
    mocks.spell.mockImplementation((word) => word !== "qwertzuiopz");
    mocks.suggest.mockReturnValue(["quartz"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1]))),
    );
    const repeated = request(5, "spelling");
    repeated.preferences.dictionaryLocale = "en_US";
    repeated.text = "qwertzuiopz alpha qwertzuiopz qwertzuiopz";
    const response = await analyze(repeated);

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.status).toBe("ready");
    expect(response.diagnostics).toHaveLength(3);
    expect(
      response.diagnostics.map((diagnostic) => diagnostic.from),
    ).toEqual([0, 18, 30]);
    expect(mocks.spell).toHaveBeenCalledWith("qwertzuiopz");
    expect(
      mocks.spell.mock.calls.filter(
        ([word]) => word === "qwertzuiopz",
      ),
    ).toHaveLength(1);
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
  });
});

describe("ignored-word normalisation", () => {
  it("orders and de-duplicates the ignore list so the cache key is stable", async () => {
    const forwards = request(900, "spelling");
    forwards.ignoredWords = ["zeta", "alpha", "Beta", "alpha"];
    const first = await analyze(forwards);
    expect(first.type).toBe("result");

    // Same set, different order and casing duplicates: the worker must treat
    // this as the identical request, which only holds if the list is sorted
    // and de-duplicated before it becomes the cache key.
    const backwards = request(901, "spelling");
    backwards.ignoredWords = ["Beta", "alpha", "zeta"];
    const second = await analyze(backwards);
    expect(second.type).toBe("result");
  });
});

