// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";

interface FakeSuggestion {
  kind: () => number;
  get_replacement_text: () => string;
  free: () => void;
}

interface FakeLint {
  rule: string;
  span: () => { start: number; end: number; free: () => void };
  lint_kind: () => string;
  message: () => string;
  suggestions: () => FakeSuggestion[];
  free: () => void;
}

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  close: vi.fn(),
  organized: true,
  setupError: null as unknown,
  defaultConfigError: false,
  importWordsError: false,
  importWords: vi.fn(),
  setLintConfig: vi.fn(),
  lintCalls: vi.fn(),
  linterDispose: vi.fn(),
  lints: (_text: string): FakeLint[] => [],
  loadError: null as unknown,
  spell: vi.fn((_word: string) => true),
  suggest: vi.fn((_word: string): string[] => []),
  hunspellDispose: vi.fn(),
}));

vi.mock("harper.js", () => ({
  Dialect: {
    American: "american",
    British: "british",
    Australian: "australian",
    Canadian: "canadian",
    Indian: "indian",
  },
  LocalLinter: class {
    async setup() {
      if (mocks.setupError !== null) throw mocks.setupError;
    }
    async getDefaultLintConfig() {
      if (mocks.defaultConfigError) throw new Error("no default config");
      return { FakeRule: null, Other: null };
    }
    async setLintConfig(config: Record<string, boolean>) {
      mocks.setLintConfig(config);
    }
    async setDialect() {}
    async clearWords() {}
    async importWords(words: string[]) {
      mocks.importWords(words);
      if (mocks.importWordsError) throw new Error("import failed");
    }
    async lint(text: string) {
      mocks.lintCalls(text);
      return mocks.lints(text);
    }
    get organizedLints() {
      if (!mocks.organized) return undefined;
      return async (text: string) => {
        mocks.lintCalls(text);
        const grouped: Record<string, FakeLint[]> = {};
        for (const lint of mocks.lints(text)) {
          grouped[lint.rule] = [...(grouped[lint.rule] ?? []), lint];
        }
        return grouped;
      };
    }
    dispose() {
      mocks.linterDispose();
    }
  },
}));

vi.mock("harper.js/binary", () => ({ binary: new Uint8Array() }));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => {
    if (mocks.loadError !== null) throw mocks.loadError;
    return {
      mountBuffer: (_bytes: Uint8Array, name?: string) => `/${name}`,
      create: () => ({
        spell: mocks.spell,
        suggest: mocks.suggest,
        dispose: mocks.hunspellDispose,
      }),
    };
  },
}));

function lintAt(
  start: number,
  end: number,
  options: {
    kind?: string;
    rule?: string;
    message?: string;
    suggestions?: FakeSuggestion[];
    spanFree?: () => void;
    free?: () => void;
  } = {},
): FakeLint {
  return {
    rule: options.rule ?? "FakeRule",
    span: () => ({ start, end, free: options.spanFree ?? (() => undefined) }),
    lint_kind: () => options.kind ?? "Style",
    message: () => options.message ?? "Finding",
    suggestions: () => options.suggestions ?? [],
    free: options.free ?? (() => undefined),
  };
}

function lintOn(prose: string, word: string, options: Parameters<typeof lintAt>[2] = {}): FakeLint {
  const start = prose.indexOf(word);
  return lintAt(start, start + word.length, options);
}

function malformedLint(prose: string): FakeLint {
  return lintAt(prose.length + 5, prose.length + 9);
}

let nextId = 0;

function request(
  text: string,
  overrides: {
    mode?: ProofreadingRequest["mode"];
    format?: ProofreadingRequest["format"];
    ignoredWords?: string[];
    suppressions?: string[];
    preferences?: Partial<ProofreadingRequest["preferences"]>;
    identity?: Partial<ProofreadingRequest["identity"]>;
  } = {},
): ProofreadingRequest {
  nextId += 1;
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "proofread",
    requestId: nextId,
    identity: {
      projectId: "project",
      path: "notes.txt",
      revision: nextId,
      requestGeneration: nextId,
      surface: "source",
      ...overrides.identity,
    },
    format: overrides.format ?? "plaintext",
    mode: overrides.mode ?? "grammar",
    text,
    ignoredWords: overrides.ignoredWords ?? [],
    suppressions: overrides.suppressions ?? [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dialect: "american",
      dictionaryLocale: "en_US",
      ...overrides.preferences,
    },
  };
}

function send(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function until(assertion: () => void): Promise<void> {
  return vi.waitFor(assertion, { interval: 1 });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function responseFor(requestId: number) {
  return mocks.postMessage.mock.calls.find(
    ([response]) => response.type !== "suggestions" && response.requestId === requestId,
  )?.[0] as ProofreadingWorkerResponse | undefined;
}

async function analyze(value: unknown): Promise<ProofreadingWorkerResponse> {
  const { requestId } = value as { requestId: number };
  send(value);
  await until(() => expect(responseFor(requestId)).toBeDefined());
  return responseFor(requestId) as ProofreadingWorkerResponse;
}

async function result(value: ProofreadingRequest) {
  const response = await analyze(value);
  if (response.type !== "result") throw new Error(`expected a result, got ${JSON.stringify(response)}`);
  return response;
}

async function failure(value: unknown) {
  const response = await analyze(value);
  if (response.type !== "error") throw new Error(`expected an error, got ${JSON.stringify(response)}`);
  return response;
}

function deliver(locale: string) {
  send({
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "dictionary",
    locale,
    aff: new Uint8Array([1]),
    dic: new Uint8Array([1]),
  });
}

function suggestionsPosted() {
  return mocks.postMessage.mock.calls
    .map(([response]) => response)
    .filter((response) => response.type === "suggestions");
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

beforeAll(async () => {
  vi.stubGlobal("postMessage", mocks.postMessage);
  vi.stubGlobal("close", mocks.close);
  await import("./proofreading.worker");
  deliver("en_US");
});

afterEach(() => {
  mocks.lints = () => [];
  mocks.organized = true;
  mocks.spell.mockImplementation(() => true);
  mocks.suggest.mockImplementation(() => []);
  mocks.loadError = null;
  mocks.importWordsError = false;
});

describe("grammar engine start-up failures", () => {
  it("reports a failed start and caps a very long reason", async () => {
    mocks.setupError = new Error("x".repeat(1_100));
    const response = await failure(request("alpha beta"));
    expect(response.error.code).toBe("analysis_failed");
    expect(response.error.retryable).toBe(true);
    expect(response.error.message).toHaveLength(1_024);
    expect(response.error.message.startsWith("Grammar checking failed: xxx")).toBe(true);
    expect(response.error.message.endsWith("…")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("explains a start failure that is not an error object and logs it once", async () => {
    mocks.setupError = "wasm missing";
    const first = await failure(request("alpha gamma"));
    const second = await failure(request("alpha delta"));
    expect(first.error.message).toBe("Grammar checking could not finish.");
    expect(second.error.message).toBe("Grammar checking could not finish.");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      "Proofreading: the grammar engine failed and will be rebuilt on the next check.",
      "wasm missing",
    );
  });

  it("reports a combined check as failed when neither engine starts", async () => {
    mocks.setupError = new Error("no grammar");
    const response = await failure(
      request("alpha beta", { mode: "combined", preferences: { dictionaryLocale: "en_NZ" } }),
    );
    expect(response.error).toEqual({
      code: "analysis_failed",
      message: "Grammar and spelling checking could not finish.",
      retryable: true,
    });
  });

  it("keeps spelling results when only grammar fails in a combined check", async () => {
    mocks.setupError = new Error("no grammar");
    mocks.spell.mockImplementation((word) => word !== "betx");
    const response = await result(request("alpha betx", { mode: "combined" }));
    expect(response.status).toBe("partial");
    expect(response.message).toBe(
      "Partial proofreading: grammar checking did not finish. Valid findings are still shown.",
    );
    expect(response.activeDictionaryLocale).toBe("en_US");
    expect(response.diagnostics.map((d) => [d.word, d.source])).toEqual([["betx", "hunspell"]]);
    mocks.setupError = null;
  });
});

describe("grammar engine set-up", () => {
  it("applies the whole academic profile when Harper cannot list its rules", async () => {
    mocks.defaultConfigError = true;
    const response = await result(request("alpha beta epsilon"));
    expect(response.status).toBe("ready");
    const config = mocks.setLintConfig.mock.calls.at(-1)?.[0] as Record<string, boolean>;
    expect(config).toMatchObject({ Spaces: false, LongSentences: false, BoringWords: false });
    mocks.defaultConfigError = false;
  });

  it("imports the ignore list again after Harper refused it", async () => {
    mocks.importWordsError = true;
    const before = mocks.importWords.mock.calls.length;
    await result(request("alpha beta zeta one", { ignoredWords: ["zeta"] }));
    await result(request("alpha beta zeta two", { ignoredWords: ["zeta"] }));
    expect(mocks.importWords.mock.calls.length).toBe(before + 2);
    expect(mocks.importWords.mock.calls.at(-1)?.[0]).toContain("zeta");

    mocks.importWordsError = false;
    await result(request("alpha beta zeta three", { ignoredWords: ["zeta"] }));
    await result(request("alpha beta zeta four", { ignoredWords: ["zeta"] }));
    expect(mocks.importWords.mock.calls.length).toBe(before + 3);
  });

  it("falls back to plain linting without rule names when grouped lints are missing", async () => {
    mocks.organized = false;
    mocks.lints = (prose) => [lintOn(prose, "beta", { rule: "Grouped" })];
    const response = await result(request("alpha beta eta"));
    expect(response.diagnostics).toEqual([
      expect.objectContaining({ word: "beta", source: "harper", rule: null }),
    ]);
  });
});

describe("grammar findings", () => {
  it("maps Harper suggestion kinds and frees every engine object", async () => {
    const frees = { suggestion: vi.fn(), throwing: vi.fn(() => { throw new Error("freed"); }) };
    const suggestion = (kind: number, text: string, free: () => void = frees.suggestion): FakeSuggestion => ({
      kind: () => kind,
      get_replacement_text: () => text,
      free,
    });
    mocks.lints = (prose) => [
      lintOn(prose, "beta", {
        suggestions: [
          suggestion(0, "better"),
          suggestion(1, ""),
          suggestion(2, "betas", frees.throwing),
          suggestion(7, "bet"),
          suggestion(0, ""),
        ],
        spanFree: frees.throwing,
        free: frees.throwing,
      }),
    ];
    const response = await result(request("alpha beta theta"));
    expect(response.diagnostics[0].suggestions).toEqual([
      { text: "better", kind: 0 },
      { text: "", kind: 1 },
      { text: "betas", kind: 2 },
      { text: "bet", kind: 0 },
    ]);
    expect(frees.suggestion).toHaveBeenCalledTimes(4);
    expect(frees.throwing).toHaveBeenCalledTimes(3);
  });

  it("hides regional and word-choice findings the writer turned off", async () => {
    mocks.lints = (prose) => [
      lintOn(prose, "alpha", { kind: "Regionalism" }),
      lintOn(prose, "beta", { kind: "Word Choice" }),
      lintOn(prose, "iota", { kind: "Style" }),
    ];
    const response = await result(
      request("alpha beta iota", { preferences: { showRegionalism: false, showWordChoice: false } }),
    );
    expect(response.diagnostics.map((d) => [d.word, d.kind])).toEqual([["iota", "Style"]]);
  });

  it("skips findings on ignored words and on bare punctuation", async () => {
    mocks.lints = (prose) => [
      lintOn(prose, "beta"),
      lintOn(prose, "!!"),
      lintOn(prose, "kappa"),
    ];
    const response = await result(request("alpha beta !! kappa", { ignoredWords: ["Beta"] }));
    expect(response.diagnostics.map((d) => d.word)).toEqual(["kappa"]);
  });

  it("orders findings that start together by their end", async () => {
    mocks.lints = () => [lintAt(0, 10), lintAt(0, 5)];
    const response = await result(request("alpha beta lambda"));
    expect(response.diagnostics.map((d) => [d.from, d.to])).toEqual([
      [0, 5],
      [0, 10],
    ]);
  });

  it("counts several malformed findings in a grammar-only check", async () => {
    mocks.lints = (prose) => [lintOn(prose, "beta"), malformedLint(prose), malformedLint(prose)];
    const response = await result(request("alpha beta mu"));
    expect(response.status).toBe("partial");
    expect(response.message).toBe("2 malformed grammar findings were skipped. All valid findings are shown.");
    expect(response.diagnostics.map((d) => d.word)).toEqual(["beta"]);
  });

  it("does not run Harper on a document with no prose", async () => {
    mocks.lintCalls.mockClear();
    const response = await result(request("https://example.com/paper"));
    expect(response).toMatchObject({ status: "ready", diagnostics: [] });
    expect(mocks.lintCalls).not.toHaveBeenCalled();
  });

  it("maps plaintext findings back over dropped spaces and links", async () => {
    mocks.lints = (prose) => [lintOn(prose, "beta"), lintOn(prose, "nu")];
    const text = "  alpha , beta https://example.com/x nu";
    const response = await result(request(text));
    expect(response.diagnostics.map((d) => [d.word, d.from])).toEqual([
      ["beta", text.indexOf("beta")],
      ["nu", text.indexOf("nu")],
    ]);
    expect(mocks.lintCalls).toHaveBeenLastCalledWith("alpha, beta nu");
  });

  it("checks Markdown grammar on the prose it renders", async () => {
    mocks.lints = (prose) => [lintOn(prose, "omicron")];
    const text = "# Heading\n\nSome **omicron** prose.";
    const response = await result(request(text, { format: "markdown" }));
    expect(response.diagnostics.map((d) => [d.word, d.from])).toEqual([["omicron", text.indexOf("omicron")]]);
  });

  it("keys the cache on the suppression set regardless of order", async () => {
    mocks.lintCalls.mockClear();
    mocks.lints = (prose) => [lintOn(prose, "pi")];
    const first = await result(request("alpha pi", { suppressions: ["b-key", "a-key"] }));
    const second = await result(request("alpha pi", { suppressions: ["a-key", "b-key"] }));
    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(mocks.lintCalls).toHaveBeenCalledTimes(1);
  });
});

describe("combined checks", () => {
  it("reports malformed grammar findings next to spelling results", async () => {
    mocks.spell.mockImplementation((word) => word !== "rhoo");
    mocks.lints = (prose) => [lintOn(prose, "rhoo"), malformedLint(prose)];
    const response = await result(request("alpha rhoo", { mode: "combined" }));
    expect(response.status).toBe("partial");
    expect(response.message).toBe(
      "Partial proofreading: 1 malformed grammar finding was skipped. Valid findings are still shown.",
    );
    expect(response.diagnostics.map((d) => [d.word, d.source])).toEqual([
      ["rhoo", "harper"],
      ["rhoo", "hunspell"],
    ]);
  });

  it("names the default dictionary when it cannot start", async () => {
    mocks.loadError = "no wasm";
    deliver("en_US");
    const response = await result(
      request("alpha sigma", { mode: "combined", preferences: { dictionaryLocale: undefined } }),
    );
    expect(response.status).toBe("partial");
    expect(response.message).toBe(
      "Partial proofreading: the requested en_US spelling dictionary could not start. Valid findings are still shown.",
    );
    expect(response.activeDictionaryLocale).toBeUndefined();
  });

  it("explains a spelling-only start failure that is not an error object", async () => {
    mocks.loadError = "no wasm";
    deliver("en_US");
    const response = await failure(
      request("alpha tau", { mode: "spelling", preferences: { dictionaryLocale: undefined } }),
    );
    expect(response.error).toEqual({
      code: "initialization_failed",
      message: "The requested en_US spelling dictionary could not start.",
      retryable: true,
    });
  });

  it("spell checks with the default dictionary when no locale is set", async () => {
    deliver("en_US");
    mocks.spell.mockImplementation((word) => word !== "upsilonn");
    const response = await result(
      request("alpha upsilonn", { mode: "spelling", preferences: { dictionaryLocale: undefined } }),
    );
    expect(response.status).toBe("ready");
    expect(response.activeDictionaryLocale).toBe("en_US");
    expect(response.diagnostics.map((d) => d.word)).toEqual(["upsilonn"]);
  });
});

describe("request validation", () => {
  it("pauses on a document over the character limit", async () => {
    const response = await result(request("a".repeat(500_001), { mode: "spelling" }));
    expect(response.status).toBe("too_large");
    expect(response.diagnostics).toEqual([]);
    expect(response.message).toBe(
      `Proofreading paused for this ${(500_001).toLocaleString()}-character document (limit ${(500_000).toLocaleString()}).`,
    );
  });

  it("rejects a request with an invalid id", async () => {
    const value = { ...request("alpha"), requestId: 0 };
    const response = await failure(value);
    expect(response.error).toEqual({
      code: "invalid_request",
      message: "Malformed proofreading request.",
      retryable: false,
    });
  });

  it.each([
    ["a numeric project", { projectId: 5 }],
    ["an overlong project", { projectId: "p".repeat(257) }],
    ["a numeric path", { path: 7 }],
    ["an overlong path", { path: "p".repeat(2_049) }],
    ["a negative revision", { revision: -1 }],
    ["a zero generation", { requestGeneration: 0 }],
    ["an unknown surface", { surface: "preview" }],
  ])("rejects an identity with %s", async (_label, identity) => {
    const response = await failure(request("alpha", { identity: identity as never }));
    expect(response.error.message).toBe("Malformed proofreading identity.");
  });

  it("checks a file outside any project", async () => {
    const response = await result(request("alpha phi", { identity: { projectId: null } }));
    expect(response.status).toBe("ready");
    expect(response.identity.projectId).toBeNull();
  });
});

describe("worker messages", () => {
  it("ignores malformed messages and cancels that name no valid lane", async () => {
    send(null);
    send({ type: "proofread" });
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "unknown" });
    const value = request("alpha chi");
    send(value);
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "cancel", surface: "preview" });
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "cancel", surface: "source", path: 5 });
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "cancel", surface: "source", path: "other.txt" });
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "cancel", surface: "visual" });
    await until(() => expect(responseFor(value.requestId)).toBeDefined());
    expect(responseFor(value.requestId)).toMatchObject({ type: "result", status: "ready" });
  });

  it("drops a running check when its lane is cancelled", async () => {
    const value = request("alpha psi");
    send(value);
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "cancel", surface: "source" });
    const marker = request("alpha omega", { identity: { path: "marker.txt" } });
    await analyze(marker);
    await flush();
    expect(responseFor(value.requestId)).toBeUndefined();
  });

  it("drops a queued check for a file the editor left", async () => {
    const running = request("alpha queued one", { identity: { path: "first.txt" } });
    const queued = request("alpha queued two", { identity: { path: "second.txt" } });
    send(running);
    send(queued);
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "cancel", surface: "source", path: "second.txt" });
    await until(() => expect(responseFor(running.requestId)).toBeDefined());
    await analyze(request("alpha queued marker", { identity: { path: "marker.txt" } }));
    expect(responseFor(queued.requestId)).toBeUndefined();
  });

  it("accepts a request without a suppression list", async () => {
    const value = { ...request("alpha nosuppress"), suppressions: undefined };
    const response = await result(value);
    expect(response.status).toBe("ready");
  });

  it("ignores a dictionary delivery without byte arrays", async () => {
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "dictionary", locale: "nl_NL", aff: "x", dic: "y" });
    const response = await failure(request("hallo", { mode: "spelling", preferences: { dictionaryLocale: "nl_NL" } }));
    expect(response.error).toMatchObject({ code: "initialization_failed", retryable: false });
  });

  it("answers only valid suggestion requests and survives a missing dictionary", async () => {
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "suggest", requestId: 0, locale: "en_US", word: "teh" });
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "suggest", requestId: 9_001, locale: "xx_YY", word: "teh" });
    await until(() => expect(suggestionsPosted()).toHaveLength(1));
    expect(suggestionsPosted()[0]).toMatchObject({ requestId: 9_001, locale: "xx_YY", suggestions: [] });
  });

  it("drops duplicate and empty dictionary suggestions", async () => {
    mocks.spell.mockImplementation(() => false);
    mocks.suggest.mockImplementation(() => ["the", "", "the", "tea"]);
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "suggest", requestId: 9_002, locale: "en_US", word: "thw" });
    await until(() =>
      expect(suggestionsPosted().find((posted) => posted.requestId === 9_002)).toBeDefined(),
    );
    expect(suggestionsPosted().find((posted) => posted.requestId === 9_002)?.suggestions).toEqual([
      { text: "the", kind: 0 },
      { text: "tea", kind: 0 },
    ]);
  });

  it("forgets the oldest suggestions once the cache is full", async () => {
    mocks.spell.mockImplementation(() => false);
    mocks.suggest.mockImplementation((word) => [`${word}s`]);
    const before = suggestionsPosted().length;
    for (let index = 0; index <= 4_000; index++) {
      send({
        protocolVersion: PROOFREADING_PROTOCOL_VERSION,
        type: "suggest",
        requestId: 10_000 + index,
        locale: "en_US",
        word: `w${index.toString(36)}x`,
      });
    }
    await until(() => expect(suggestionsPosted().length).toBe(before + 4_001));
    mocks.suggest.mockClear();
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "suggest", requestId: 20_000, locale: "en_US", word: "w0x" });
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "suggest", requestId: 20_001, locale: "en_US", word: `w${(4_000).toString(36)}x` });
    await until(() => expect(suggestionsPosted().length).toBe(before + 4_003));
    expect(mocks.suggest.mock.calls.map(([word]) => word)).toEqual(["w0x"]);
  });

  it("keeps a redelivered pack when the earlier load fails", async () => {
    deliver("cs_CZ");
    mocks.loadError = new Error("broken pack");
    const value = request("ahoj", { mode: "spelling", preferences: { dictionaryLocale: "cs_CZ" } });
    send(value);
    deliver("cs_CZ");
    await until(() => expect(responseFor(value.requestId)).toBeDefined());
    expect(responseFor(value.requestId)).toMatchObject({
      type: "error",
      error: { code: "initialization_failed", message: "broken pack" },
    });
    mocks.loadError = null;
    mocks.spell.mockImplementation((word) => word !== "ahjo");
    const response = await result(request("ahjo", { mode: "spelling", preferences: { dictionaryLocale: "cs_CZ" } }));
    expect(response.diagnostics.map((d) => d.word)).toEqual(["ahjo"]);
  });

  it("swallows a dictionary that fails to dispose when it is replaced or evicted", async () => {
    mocks.hunspellDispose.mockImplementation(() => {
      throw new Error("already freed");
    });
    deliver("cs_CZ");
    deliver("de_DE");
    deliver("fr_FR");
    for (const locale of ["de_DE", "fr_FR"]) {
      const response = await result(request("wort", { mode: "spelling", preferences: { dictionaryLocale: locale } }));
      expect(response.status).toBe("ready");
    }
    await flush();
    expect(mocks.hunspellDispose).toHaveBeenCalled();
    mocks.hunspellDispose.mockReset();
  });
});

describe("disposal", () => {
  it("releases every engine, closes the worker and ignores later messages", async () => {
    const pendingSuggest = { protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "suggest", requestId: 30_000, locale: "de_DE", word: "wrot" };
    const before = mocks.postMessage.mock.calls.length;
    mocks.hunspellDispose.mockImplementation(() => {
      throw new Error("already freed");
    });
    send(pendingSuggest);
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "dispose" });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    send(request("alpha after"));
    send({ protocolVersion: PROOFREADING_PROTOCOL_VERSION, type: "dispose" });
    await flush();
    await flush();
    expect(mocks.postMessage.mock.calls.length).toBe(before);
    expect(mocks.linterDispose).toHaveBeenCalled();
    expect(mocks.hunspellDispose).toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
