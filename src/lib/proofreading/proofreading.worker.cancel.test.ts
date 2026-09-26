// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  suggested: [] as string[],
}));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => ({
    mountBuffer: (_bytes: Uint8Array, name?: string) => `/${name}`,
    create: () => ({
      spell: (word: string) => word === "ok",
      suggest: (word: string) => {
        mocks.suggested.push(word);
        const started = Date.now();
        let spins = 0;
        while (Date.now() - started < 20) spins++;
        return spins < 0 ? [word] : [];
      },
      dispose: () => undefined,
    }),
  }),
}));

function send(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function request(
  requestId: number,
  path: string,
  text: string,
): ProofreadingRequest {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "proofread",
    requestId,
    identity: {
      projectId: "project",
      path,
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

function postedIds(): number[] {
  return mocks.postMessage.mock.calls.map(([response]) => response.requestId);
}

beforeAll(async () => {
  vi.stubGlobal("postMessage", mocks.postMessage);
  await import("./proofreading.worker");
  send({
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "dictionary",
    locale: "cs_CZ",
    aff: new Uint8Array([1]),
    dic: new Uint8Array([1]),
  });
});

describe("cancelling abandoned proofreading", () => {
  it("stops the running analysis of a file the editor left", async () => {
    const words = Array.from(
      { length: 60 },
      (_, index) => `slovo${String.fromCharCode(97 + (index % 26))}${index}`,
    ).join(" ");
    send(request(1, "a.tex", words));
    send({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "cancel",
      surface: "source",
      path: "a.tex",
    });
    send(request(2, "b.tex", "ok chyba"));

    await vi.waitFor(() => expect(postedIds()).toContain(2), {
      timeout: 5_000,
    });
    expect(postedIds()).not.toContain(1);
    expect(mocks.suggested.filter((word) => word.startsWith("slovo")).length)
      .toBeLessThan(10);
  });

  it("drops a queued request for a cancelled surface", async () => {
    mocks.postMessage.mockClear();
    send(request(3, "c.tex", "ok chybaa"));
    send(request(4, "d.tex", "ok chybab"));
    send({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "cancel",
      surface: "source",
      path: "d.tex",
    });

    await vi.waitFor(() => expect(postedIds()).toContain(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postedIds()).not.toContain(4);
  });
});
