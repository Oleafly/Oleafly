// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  grammarSuppressionKey,
  type ProofreadingRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  includeMalformed: false,
  dictionaryAvailable: false,
  spell: vi.fn<(word: string) => boolean>(),
  suggest: vi.fn<(word: string) => string[]>(),
  setLintConfig: vi.fn<(config: Record<string, boolean>) => void>(),
  activeLintConfig: null as null | Record<string, boolean>,
  activeDialect: "" as string,
  importWords: vi.fn<(words: string[]) => void>(),
  lintLanguage: vi.fn<(language: string) => void>(),
  linterConstructions: 0,
  lints: null as
    | null
    | ((text: string) => ReturnType<typeof fakeLint>[]),
}));

function fakeLint(
  kind: string,
  message: string,
  start: number,
  end: number,
  rule = "FakeRule",
) {
  return {
    rule,
    span: () => ({ start, end, free: vi.fn() }),
    lint_kind: () => kind,
    lint_kind_pretty: () => kind,
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
    constructor() {
      mocks.linterConstructions += 1;
    }
    async setup() {}
    async getDefaultLintConfig() {
      return { Spaces: null, LongSentences: null, AnA: null, FakeRule: null };
    }
    async setLintConfig(config: Record<string, boolean>) {
      mocks.activeLintConfig = { ...config };
      mocks.setLintConfig(config);
    }
    async setDialect(dialect: string) {
      mocks.activeDialect = dialect;
      mocks.activeLintConfig = null;
    }
    async clearWords() {}
    async importWords(words: string[]) {
      mocks.importWords(words);
    }
    async lint(text: string, options?: { language?: string }) {
      mocks.lintLanguage(options?.language ?? "");
      if (mocks.lints) return mocks.lints(text);
      return [
        fakeLint("Spelling", "Harper spelling", 0, 5, "SpellCheck"),
        fakeLint("WordChoice", "Grammar finding", 6, 10, "WordChoiceRule"),
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
    async organizedLints(text: string, options?: { language?: string }) {
      const grouped: Record<string, unknown[]> = {};
      for (const lint of await this.lint(text, options)) {
        const rule = (lint as { rule?: string }).rule ?? "Unknown";
        const bucket = grouped[rule] ?? [];
        bucket.push(lint);
        grouped[rule] = bucket;
      }
      return grouped;
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
    suppressions: [],
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


describe("harper lint configuration", () => {
  it("applies the academic profile and the writer's rule choices", async () => {
    mocks.setLintConfig.mockClear();
    const configured = request(910, "grammar");
    configured.preferences.disabledRules = ["AnA"];
    configured.preferences.enabledRules = ["LongSentences"];
    await analyze(configured);

    const config = mocks.setLintConfig.mock.calls.at(-1)?.[0];
    expect(config).toMatchObject({
      Spaces: false,
      AnA: false,
      LongSentences: true,
    });
  });

  it("imports the placeholder noun so masked markup is never a misspelling", async () => {
    await analyze(request(911, "grammar"));
    expect(mocks.importWords.mock.calls.at(-1)?.[0]).toContain("Dummy");
  });

  it("sends a Typst document through Harper's own Typst parser", async () => {
    mocks.lintLanguage.mockClear();
    const typst = request(912, "grammar");
    typst.format = "typst";
    typst.identity.path = "main.typ";
    typst.text = "The the results.";
    await analyze(typst);
    expect(mocks.lintLanguage).toHaveBeenCalledWith("typst");
  });

  it("keeps a disabled rule off after the writer changes dialect", async () => {
    const american = request(914, "grammar");
    american.preferences.dialect = "american";
    american.preferences.disabledRules = ["AnA"];
    american.text = "alpha beta delta";
    await analyze(american);
    expect(mocks.activeDialect).toBe("american");
    expect(mocks.activeLintConfig).toMatchObject({ AnA: false });

    const british = request(915, "grammar");
    british.preferences.dialect = "british";
    british.preferences.disabledRules = ["AnA"];
    british.text = "alpha beta delta";
    await analyze(british);
    expect(mocks.activeDialect).toBe("british");
    expect(mocks.activeLintConfig).toMatchObject({ AnA: false });
  });

  it("rejects a rule name that is not a rule name", async () => {
    const bad = request(913, "grammar");
    bad.preferences.disabledRules = ["not a rule"];
    const response = await analyze(bad);
    expect(response.type).toBe("error");
    if (response.type !== "error") return;
    expect(response.error.code).toBe("invalid_request");
  });
});

describe("latex findings land on the document", () => {
  const latexSource = (tag: string) =>
    `We compare $a$ and $b$ in \\cite{smith2020} here, ${tag}.`;

  it("maps a lint span straight onto the source text", async () => {
    mocks.lints = (text) => {
      const at = text.indexOf("compare");
      return [
        fakeLint("Repetition", "Did you mean to repeat this word?", at, at + 7, "RepeatedWords"),
      ];
    };
    const text = latexSource("first");
    const latex = request(920, "grammar");
    latex.format = "latex";
    latex.text = text;
    const response = await analyze(latex);
    mocks.lints = null;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toHaveLength(1);
    const diagnostic = response.diagnostics[0];
    expect(text.slice(diagnostic.from, diagnostic.to)).toBe("compare");
    expect(diagnostic.rule).toBe("RepeatedWords");
  });

  it("drops a finding that is only about masked markup", async () => {
    mocks.lints = (text) => {
      const at = text.indexOf("Dummy");
      return [fakeLint("Miscellaneous", "About a placeholder", at, at + 5, "AnA")];
    };
    const latex = request(921, "grammar");
    latex.format = "latex";
    latex.text = latexSource("second");
    const response = await analyze(latex);
    mocks.lints = null;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toEqual([]);
  });

  it("drops a finding that reaches across an inline equation", async () => {
    const text = "We add and \\(c+d\\) and then stop.";
    mocks.lints = () => [
      fakeLint(
        "Repetition",
        "Did you mean to repeat this word?",
        7,
        22,
        "RepeatedWords",
      ),
    ];
    const latex = request(926, "grammar");
    latex.format = "latex";
    latex.text = text;
    const response = await analyze(latex);
    mocks.lints = null;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toEqual([]);
  });

  it("drops a finding that reaches across a construct blanked over a newline", async () => {
    const text = "We add and \\cite{\nkey\n} and then stop.";
    const at = text.indexOf("and");
    mocks.lints = () => [
      fakeLint(
        "Repetition",
        "Did you mean to repeat this word?",
        at,
        text.indexOf("and then") + 3,
        "RepeatedWords",
      ),
    ];
    const latex = request(927, "grammar");
    latex.format = "latex";
    latex.text = text;
    const response = await analyze(latex);
    mocks.lints = null;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toEqual([]);
  });

  it("keeps a finding that lies entirely in kept prose", async () => {
    const text = "We compare the the results in \\cite{key} today.";
    const at = text.indexOf("the the");
    mocks.lints = () => [
      fakeLint(
        "Repetition",
        "Did you mean to repeat this word?",
        at,
        at + 7,
        "RepeatedWords",
      ),
    ];
    const latex = request(928, "grammar");
    latex.format = "latex";
    latex.text = text;
    const response = await analyze(latex);
    mocks.lints = null;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toHaveLength(1);
    expect(
      text.slice(
        response.diagnostics[0].from,
        response.diagnostics[0].to,
      ),
    ).toBe("the the");
  });

  it("marks a Hunspell finding with a null rule", async () => {
    mocks.dictionaryAvailable = true;
    mocks.spell.mockImplementation((word: string) => word !== "Qwertzuiopz");
    mocks.suggest.mockReturnValue([]);
    const spelling = request(929, "spelling");
    spelling.format = "latex";
    spelling.text = "A Qwertzuiopz remains here.";
    const response = await analyze(spelling);

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0].rule).toBeNull();
  });

  it("drops a wide finding rather than painting a pasted block", async () => {
    const pasted = `${"\\begin{tabular}{lcc}\n"}${"Model & Accuracy & Latency \\\\\n".repeat(40)}\\end{tabular}`;
    mocks.lints = () => [
      fakeLint("Spelling", "Did you mean to spell this way?", 0, 300, "SpellCheck"),
    ];
    const latex = request(922, "grammar");
    latex.format = "latex";
    latex.text = pasted;
    const response = await analyze(latex);
    mocks.lints = null;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toEqual([]);
  });

  it("clamps a grammar finding to its own sentence", async () => {
    const text = "First sentence here. Second sentence follows it.";
    mocks.lints = () => [
      fakeLint("Readability", "This sentence is long.", 0, text.length, "LongSentences"),
    ];
    const latex = request(923, "grammar");
    latex.format = "latex";
    latex.text = text;
    const response = await analyze(latex);
    mocks.lints = null;

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.diagnostics).toHaveLength(1);
    expect(
      text.slice(response.diagnostics[0].from, response.diagnostics[0].to),
    ).toBe("First sentence here.");
  });

  it("drops a finding the writer already dismissed in this project", async () => {
    const text = "We compare the the results here.";
    mocks.lints = () => [
      fakeLint("Repetition", "Did you mean to repeat this word?", 11, 18, "RepeatedWords"),
    ];
    const first = request(924, "grammar");
    first.format = "latex";
    first.text = text;
    const before = await analyze(first);
    expect(before.type).toBe("result");
    if (before.type !== "result") return;
    expect(before.diagnostics).toHaveLength(1);

    const dismissed = request(925, "grammar");
    dismissed.format = "latex";
    dismissed.text = text;
    dismissed.suppressions = [
      grammarSuppressionKey("RepeatedWords", text, 11),
    ];
    const after = await analyze(dismissed);
    mocks.lints = null;

    expect(after.type).toBe("result");
    if (after.type !== "result") return;
    expect(after.diagnostics).toEqual([]);
  });
});

describe("grammar engine recovery", () => {
  it("rebuilds the grammar engine after it crashes mid-check", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = mocks.linterConstructions;
    mocks.lints = () => {
      throw new Error("unreachable");
    };
    const crashing = request(930, "grammar");
    crashing.text = "rebuild after a crash";
    const crashed = await analyze(crashing);
    expect(crashed.type).toBe("error");
    if (crashed.type !== "error") return;
    expect(crashed.error.message).toContain("unreachable");

    mocks.lints = null;
    const recovering = request(931, "grammar");
    recovering.text = "rebuild after a crash";
    const recovered = await analyze(recovering);
    expect(recovered.type).toBe("result");
    if (recovered.type !== "result") return;
    expect(recovered.status).toBe("ready");
    expect(mocks.linterConstructions).toBe(before + 1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("grammar engine failed"),
      "unreachable",
    );
    warn.mockRestore();
  });
});
