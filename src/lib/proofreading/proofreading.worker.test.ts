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
    throw new Error("Requested dictionary unavailable");
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
});
