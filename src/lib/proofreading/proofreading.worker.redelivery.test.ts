// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  usedAfterDispose: 0,
}));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => ({
    mountBuffer: (_bytes: Uint8Array, name?: string) => `/${name}`,
    create: () => {
      let disposed = false;
      const guard = () => {
        if (disposed) {
          mocks.usedAfterDispose++;
          throw new Error("memory access out of bounds");
        }
      };
      return {
        spell: (word: string) => {
          guard();
          return word === "ok";
        },
        suggest: () => {
          guard();
          const started = Date.now();
          let spins = 0;
          while (Date.now() - started < 20) spins++;
          return spins < 0 ? ["ok"] : [];
        },
        dispose: () => {
          disposed = true;
        },
      };
    },
  }),
}));

function send(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function deliver() {
  send({
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "dictionary",
    locale: "cs_CZ",
    aff: new Uint8Array([1]),
    dic: new Uint8Array([1]),
  });
}

function request(requestId: number, text: string): ProofreadingRequest {
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
    mode: "spelling",
    text,
    ignoredWords: [],
    suppressions: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dialect: "american",
      dictionaryLocale: "cs_CZ",
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal("postMessage", mocks.postMessage);
  await import("./proofreading.worker");
  deliver();
});

describe("a pack delivered again during a spelling pass", () => {
  it("finishes the pass with the new pack instead of the released one", async () => {
    const words = Array.from(
      { length: 40 },
      (_, index) => `slovo${String.fromCharCode(97 + (index % 26))}${index}`,
    ).join(" ");
    send(request(1, `${words} chyba`));
    await new Promise((resolve) => setTimeout(resolve, 80));
    deliver();

    await vi.waitFor(
      () =>
        expect(
          mocks.postMessage.mock.calls.map(([response]) => response.requestId),
        ).toContain(1),
      { timeout: 10_000 },
    );
    const [response] = mocks.postMessage.mock.calls.find(
      ([posted]) => posted.requestId === 1,
    ) ?? [undefined];
    expect(mocks.usedAfterDispose).toBe(0);
    expect(response.type).toBe("result");
    expect(response.status).toBe("ready");
    expect(response.diagnostics.map((diagnostic: { word: string }) => diagnostic.word))
      .toContain("chyba");
  }, 20_000);
});
