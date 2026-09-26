// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  suggested: [] as string[],
  spelled: [] as string[],
}));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => ({
    mountBuffer: (_bytes: Uint8Array, name?: string) => `/${name}`,
    create: () => ({
      spell: (word: string) => {
        mocks.spelled.push(word);
        return word === "ok";
      },
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

function letters(index: number): string {
  return (
    String.fromCharCode(97 + (index % 26)) +
    String.fromCharCode(97 + Math.floor(index / 26))
  );
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

  it("finishes a running analysis when the newer request has the same text", async () => {
    mocks.postMessage.mockClear();
    mocks.spelled.length = 0;
    const words = Array.from(
      { length: 60 },
      (_, index) => `znovu${letters(index)}`,
    ).join(" ");
    send(request(5, "e.tex", words));
    send(request(6, "e.tex", words));

    await vi.waitFor(() => expect(postedIds()).toContain(6), {
      timeout: 5_000,
    });
    expect(postedIds()).not.toContain(5);
    expect(mocks.spelled.filter((word) => word === "znovuaa")).toHaveLength(1);
  });

  it("still abandons a running analysis once the text changes", async () => {
    mocks.postMessage.mockClear();
    mocks.spelled.length = 0;
    const words = Array.from(
      { length: 60 },
      (_, index) => `zmena${letters(index)}`,
    ).join(" ");
    send(request(7, "f.tex", words));
    send(request(8, "f.tex", `${words} ok`));

    await vi.waitFor(() => expect(postedIds()).toContain(8), {
      timeout: 5_000,
    });
    expect(postedIds()).not.toContain(7);
    expect(
      mocks.spelled.filter((word) => word.startsWith("zmena")).length,
    ).toBeLessThan(120);
  });
});
