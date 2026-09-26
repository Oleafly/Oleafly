// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
  type ProofreadingResult,
  type ProofreadingSuggestResult,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  clock: 0,
  suggestCost: 400,
  suggested: [] as string[],
  known: new Set([
    "papíru",
    "skládá",
    "well-known",
    "well",
    "polsko",
    "niemiecki",
    "dell'anno",
    "na",
  ]),
}));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => ({
    mountBuffer: (_bytes: Uint8Array, name?: string) => `/${name ?? ""}`,
    create: () => ({
      spell: (word: string) => mocks.known.has(word),
      suggest: (word: string) => {
        mocks.suggested.push(word);
        mocks.clock += mocks.suggestCost;
        if (word === "dell'ano") return ["dell'anno"];
        return [`${word}-fixed`];
      },
      dispose: () => {},
    }),
  }),
}));

let nextId = 100;

function request(text: string): ProofreadingRequest {
  const id = ++nextId;
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "proofread",
    requestId: id,
    identity: {
      projectId: "project",
      path: `doc-${id}.tex`,
      revision: id,
      requestGeneration: id,
      surface: "source",
    },
    format: "latex",
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

function deliver() {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        protocolVersion: PROOFREADING_PROTOCOL_VERSION,
        type: "dictionary",
        locale: "cs_CZ",
        aff: new Uint8Array([1]),
        dic: new Uint8Array([2]),
      },
    }),
  );
}

function responseFor(requestId: number) {
  return mocks.postMessage.mock.calls.find(
    ([response]) => response.requestId === requestId,
  )?.[0];
}

async function analyze(value: ProofreadingRequest): Promise<ProofreadingResult> {
  window.dispatchEvent(new MessageEvent("message", { data: value }));
  await vi.waitFor(() => expect(responseFor(value.requestId)).toBeDefined());
  const response = responseFor(value.requestId);
  expect(response.type).toBe("result");
  return response as ProofreadingResult;
}

async function suggest(word: string): Promise<ProofreadingSuggestResult> {
  const requestId = ++nextId;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        protocolVersion: PROOFREADING_PROTOCOL_VERSION,
        type: "suggest",
        requestId,
        locale: "cs_CZ",
        word,
      },
    }),
  );
  await vi.waitFor(() => expect(responseFor(requestId)).toBeDefined());
  return responseFor(requestId) as ProofreadingSuggestResult;
}

beforeAll(async () => {
  vi.stubGlobal("postMessage", mocks.postMessage);
  vi.spyOn(performance, "now").mockImplementation(() => mocks.clock);
  await import("./proofreading.worker");
  deliver();
});

beforeEach(() => {
  mocks.suggested.length = 0;
  mocks.suggestCost = 400;
});

describe("Hunspell suggestions stay inside a time budget", () => {
  it("defers the suggestions it has no time for and still reports every misspelling", async () => {
    const typos = ["aaone", "aatwo", "aathree", "aafour", "aafive", "aasix"];
    const result = await analyze(request(`na papíru ${typos.join(" ")}`));

    expect(result.status).toBe("ready");
    expect(result.diagnostics.map((diagnostic) => diagnostic.word)).toEqual(typos);
    expect(mocks.suggested).toEqual(typos.slice(0, 4));
    const deferred = result.diagnostics.filter(
      (diagnostic) => diagnostic.suggestionsDeferred,
    );
    expect(deferred.map((diagnostic) => diagnostic.word)).toEqual(["aafive", "aasix"]);
    expect(deferred.every((diagnostic) => diagnostic.suggestions.length === 0)).toBe(true);
    expect(result.diagnostics[0]?.suggestions).toEqual([
      { text: "aaone-fixed", kind: 0 },
    ]);
  });

  it("reuses earlier suggestions on the next pass and spends the new budget on the rest", async () => {
    const typos = ["aaone", "aatwo", "aathree", "aafour", "aafive", "aasix"];
    const result = await analyze(request(`${typos.join(" ")} aaseven`));

    expect(mocks.suggested).toEqual(["aafive", "aasix", "aaseven"]);
    expect(
      result.diagnostics.every(
        (diagnostic) =>
          !diagnostic.suggestionsDeferred && diagnostic.suggestions.length === 1,
      ),
    ).toBe(true);
  });

  it("answers an on-demand request for a deferred word", async () => {
    mocks.suggestCost = 2_000;
    const result = await analyze(request("bbone bbtwo"));
    expect(result.diagnostics[1]).toMatchObject({
      word: "bbtwo",
      suggestionsDeferred: true,
    });

    const answer = await suggest("bbtwo");
    expect(answer).toMatchObject({
      type: "suggestions",
      locale: "cs_CZ",
      word: "bbtwo",
      suggestions: [{ text: "bbtwo-fixed", kind: 0 }],
    });
    await suggest("bbtwo");
    expect(mocks.suggested).toEqual(["bbone", "bbtwo"]);
  });

  it("returns no suggestions for a word the dictionary accepts", async () => {
    expect((await suggest("papíru")).suggestions).toEqual([]);
    expect(mocks.suggested).toEqual([]);
  });
});

describe("dictionary lookups follow the writer's text", () => {
  it("accepts decomposed accents", async () => {
    const result = await analyze(request("papi\u0301ru skla\u0301da\u0301"));
    expect(result.diagnostics).toEqual([]);
  });

  it("checks a hyphenated compound whole before blaming its parts", async () => {
    const result = await analyze(
      request("well-known polsko-niemiecki wel-known"),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.word)).toEqual([
      "wel",
      "known",
    ]);
  });

  it("retries typographic apostrophes and keeps them in suggestions", async () => {
    const result = await analyze(request("dell’anno dell’ano"));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      word: "dell’ano",
      suggestions: [{ text: "dell’anno", kind: 0 }],
    });
  });
});
