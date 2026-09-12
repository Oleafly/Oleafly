import { describe, expect, it } from "vitest";
import {
  PROOFREADING_LIMITS,
  PROOFREADING_PROTOCOL_VERSION,
  PROOFREADING_RENDER_LIMITS,
  createGrammarSuppressionKeyer,
  grammarSuppressionKey,
  guardProofreadingDiagnostics,
  isProofreadingWorkerResponse,
  proofreadingContextSentence,
  proofreadingSuppressionDigest,
  type ProofreadingDiagnostic,
  type ProofreadingResult,
} from "./proofreading";

function result(
  overrides: Partial<ProofreadingResult> = {},
): ProofreadingResult {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: 1,
    identity: {
      projectId: "project",
      path: "main.typ",
      revision: 4,
      requestGeneration: 2,
      surface: "source",
    },
    status: "ready",
    diagnostics: [],
    ...overrides,
  };
}

describe("proofreading worker protocol", () => {
  it("reports the exact active dictionary locale", () => {
    expect(
      isProofreadingWorkerResponse(
        result({ activeDictionaryLocale: "en_GB" }),
      ),
    ).toBe(true);
    expect(
      isProofreadingWorkerResponse(
        result({ activeDictionaryLocale: "../en_GB" }),
      ),
    ).toBe(false);
  });

  it("accepts a complete result beyond the former 500-finding cutoff", () => {
    const diagnostics = Array.from({ length: 501 }, (_, index) => ({
      from: index * 2,
      to: index * 2 + 1,
      message: "Issue",
      kind: "Spelling",
      source: "hunspell" as const,
      word: "x",
      suggestions: [],
      rule: null,
    }));
    expect(
      isProofreadingWorkerResponse(result({ diagnostics })),
    ).toBe(true);
  });

  it("accepts recovered findings only when the result is explicitly partial", () => {
    const diagnostic = {
      from: 0,
      to: 1,
      message: "Recovered issue",
      kind: "Grammar",
      source: "harper" as const,
      word: "A",
      suggestions: [],
      rule: null,
    };
    expect(
      isProofreadingWorkerResponse(
        result({
          status: "partial",
          diagnostics: [diagnostic],
          message: "One engine did not finish.",
        }),
      ),
    ).toBe(true);
    expect(
      isProofreadingWorkerResponse(
        result({
          status: "unsupported",
          diagnostics: [diagnostic],
        }),
      ),
    ).toBe(false);
  });
});

function diagnostic(
  overrides: Partial<ProofreadingDiagnostic> = {},
): ProofreadingDiagnostic {
  return {
    from: 0,
    to: 4,
    message: "Finding",
    kind: "Spelling",
    source: "harper",
    word: "word",
    suggestions: [],
    rule: null,
    ...overrides,
  };
}

describe("proofreading diagnostic protocol", () => {
  it("accepts a rule name and a null rule", () => {
    for (const rule of ["RepeatedWords", null]) {
      expect(
        isProofreadingWorkerResponse(
          result({ diagnostics: [diagnostic({ rule })] }),
        ),
      ).toBe(true);
    }
  });

  it("rejects a diagnostic that omits the rule field", () => {
    const { rule: _rule, ...withoutRule } = diagnostic();
    expect(
      isProofreadingWorkerResponse(
        result({ diagnostics: [withoutRule as ProofreadingDiagnostic] }),
      ),
    ).toBe(false);
  });

  it("rejects a rule name longer than the protocol allows", () => {
    expect(
      isProofreadingWorkerResponse(
        result({ diagnostics: [diagnostic({ rule: "R".repeat(200) })] }),
      ),
    ).toBe(false);
  });
});

describe("guardProofreadingDiagnostics", () => {
  it("drops a spelling finding wider than a word", () => {
    const text = "x".repeat(200);
    expect(
      guardProofreadingDiagnostics(
        [
          diagnostic({
            to: PROOFREADING_RENDER_LIMITS.spellingSpan + 1,
          }),
        ],
        text,
      ),
    ).toEqual([]);
  });

  it("keeps a spelling finding at the limit", () => {
    const text = "x".repeat(200);
    expect(
      guardProofreadingDiagnostics(
        [diagnostic({ to: PROOFREADING_RENDER_LIMITS.spellingSpan })],
        text,
      ),
    ).toHaveLength(1);
  });

  it("drops a spelling finding that crosses a line", () => {
    expect(
      guardProofreadingDiagnostics(
        [diagnostic({ from: 0, to: 9 })],
        "one\ntwo\nthree",
      ),
    ).toEqual([]);
  });

  it("clamps a grammar finding to the end of its sentence", () => {
    const text = "First one here. Second one follows. Third one ends.";
    const [guarded] = guardProofreadingDiagnostics(
      [
        diagnostic({
          from: 0,
          to: text.length,
          kind: "Readability",
          rule: "LongSentences",
        }),
      ],
      text,
    );
    expect(text.slice(guarded.from, guarded.to)).toBe("First one here.");
    expect(guarded.word).toBe("First one here.");
  });

  it("caps a grammar finding at the span limit when there is no sentence end", () => {
    const text = "word ".repeat(200);
    const [guarded] = guardProofreadingDiagnostics(
      [diagnostic({ from: 0, to: text.length, kind: "Repetition" })],
      text,
    );
    expect(guarded.to - guarded.from).toBe(
      PROOFREADING_RENDER_LIMITS.grammarSpan,
    );
  });

  it("caps how often the same word can be reported", () => {
    const text = "teh ".repeat(60);
    const many = Array.from({ length: 60 }, (_value, index) =>
      diagnostic({ from: index * 4, to: index * 4 + 3, word: "teh" }),
    );
    expect(guardProofreadingDiagnostics(many, text)).toHaveLength(
      PROOFREADING_RENDER_LIMITS.sameWordDiagnostics,
    );
  });

  it("drops the suggestions of a clamped grammar finding", () => {
    const text = `The the ${"filler ".repeat(80)}tail.`;
    const [guarded] = guardProofreadingDiagnostics(
      [
        diagnostic({
          from: 0,
          to: text.length,
          kind: "Repetition",
          rule: "RepeatedWords",
          suggestions: [{ text: "The", kind: 0 }],
        }),
      ],
      text,
    );
    expect(guarded.to).toBeLessThan(text.length);
    expect(guarded.suggestions).toEqual([]);
  });

  it("keeps the suggestions of an unclamped grammar finding", () => {
    const text = "The the pair.";
    const [guarded] = guardProofreadingDiagnostics(
      [
        diagnostic({
          from: 0,
          to: 7,
          kind: "Repetition",
          rule: "RepeatedWords",
          suggestions: [{ text: "The", kind: 0 }],
        }),
      ],
      text,
    );
    expect(guarded.suggestions).toEqual([{ text: "The", kind: 0 }]);
  });

  it("never reads past the grammar span cap", () => {
    const text = Array.from(
      { length: 80_000 },
      (_value, index) => `w${index}`,
    ).join(" ");
    expect(text.length).toBeGreaterThan(450_000);
    const started = performance.now();
    const guarded = guardProofreadingDiagnostics(
      Array.from({ length: 1_000 }, (_value, index) =>
        diagnostic({
          from: index * 400,
          to: text.length,
          kind: "Repetition",
        }),
      ),
      text,
    );
    expect(guarded).toHaveLength(1_000);
    for (const entry of guarded) {
      expect(entry.to - entry.from).toBeLessThanOrEqual(
        PROOFREADING_RENDER_LIMITS.grammarSpan,
      );
    }
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("leaves a normal finding untouched", () => {
    const text = "a teh word";
    const input = [diagnostic({ from: 2, to: 5, word: "teh" })];
    expect(guardProofreadingDiagnostics(input, text)[0]).toBe(input[0]);
  });
});

describe("grammarSuppressionKey", () => {
  it("digests the sentence instead of storing it", () => {
    const text = "First one here. The the second one.  Third.";
    const at = text.indexOf("The the");
    const key = grammarSuppressionKey("RepeatedWords", text, at);
    expect(key).toMatch(/^RepeatedWords:[0-9a-f]{8}$/u);
    expect(key).not.toContain("second");
  });

  it("stays inside the storage cap for a very long sentence", () => {
    const text = `${"word ".repeat(4_000)}done.`;
    expect(
      grammarSuppressionKey("LongSentences", text, 10).length,
    ).toBeLessThanOrEqual(PROOFREADING_LIMITS.suppressionCharacters);
  });

  it("gives two different long sentences two different keys", () => {
    const first = `${"alpha ".repeat(60)}tail one.`;
    const second = `${"alpha ".repeat(60)}tail two.`;
    expect(grammarSuppressionKey("R", first, 0)).not.toBe(
      grammarSuppressionKey("R", second, 0),
    );
  });

  it("survives an edit elsewhere in the paragraph", () => {
    const before = "Intro line. The the second one. Outro line.";
    const after = "A different intro. The the second one. Outro line.";
    expect(
      grammarSuppressionKey(
        "RepeatedWords",
        before,
        before.indexOf("The the"),
      ),
    ).toBe(
      grammarSuppressionKey(
        "RepeatedWords",
        after,
        after.indexOf("The the"),
      ),
    );
  });

  it("names a rule-less finding without colliding with a real rule", () => {
    expect(grammarSuppressionKey(null, "Only one.", 0)).toBe(
      `*:${proofreadingSuppressionDigest("only one.")}`,
    );
  });

  it("keeps the same key when a soft line break moves", () => {
    const wrapped = "The the second\none of the pair.";
    const reflowed = "The the\nsecond one of the pair.";
    expect(grammarSuppressionKey("R", wrapped, 0)).toBe(
      grammarSuppressionKey("R", reflowed, 0),
    );
  });

  it("stops at a blank line rather than a single newline", () => {
    expect(proofreadingContextSentence("one\ntwo\n\nthree", 0)).toBe(
      "one two",
    );
    expect(proofreadingContextSentence("one\ntwo three", 0)).toBe(
      "one two three",
    );
  });

  it("collapses whitespace so reflowed prose keeps the same sentence", () => {
    expect(proofreadingContextSentence("The   the\n  word.", 0)).toBe(
      "the the word.",
    );
  });
});

describe("createGrammarSuppressionKeyer", () => {
  it("gives every finding in one sentence the same key", () => {
    const text = "The the second one of the the pair.";
    const keyer = createGrammarSuppressionKeyer(text);
    expect(keyer("R", 0)).toBe(keyer("R", 20));
    expect(keyer("R", 0)).toBe(grammarSuppressionKey("R", text, 20));
  });

  it("changes key across a sentence boundary", () => {
    const text = "First one here. Second one follows.";
    const keyer = createGrammarSuppressionKeyer(text);
    expect(keyer("R", 0)).not.toBe(keyer("R", 20));
  });

  it("keys a thousand findings in a 450 KB document quickly", () => {
    const text = "word ".repeat(95_000);
    expect(text.length).toBeGreaterThan(450_000);
    const offsets = Array.from(
      { length: 1_000 },
      (_value, index) => index * 400,
    );
    const started = performance.now();
    const keyer = createGrammarSuppressionKeyer(text);
    const keys = offsets.map((from) => keyer("LongSentences", from));
    const elapsed = performance.now() - started;
    expect(keys).toHaveLength(1_000);
    expect(new Set(keys).size).toBe(1);
    expect(elapsed).toBeLessThan(100);
  });

  it("keys a thousand findings that alternate between two long sentences quickly", () => {
    const opening = "word ".repeat(47_500);
    const closing = "term ".repeat(47_500);
    const text = `${opening}. ${closing}.`;
    expect(text.length).toBeGreaterThan(450_000);
    const first = Array.from(
      { length: 500 },
      (_value, index) => index * 400,
    );
    const secondStart = opening.length + 2;
    const second = Array.from(
      { length: 500 },
      (_value, index) => secondStart + index * 400,
    );
    const findings = first.flatMap((from, index) => [
      { rule: `Rule${index % 5}`, from },
      { rule: `Rule${index % 5}`, from: second[index] },
    ]);
    findings.sort((left, right) => left.rule.localeCompare(right.rule));
    const started = performance.now();
    const keyer = createGrammarSuppressionKeyer(text);
    const keys = findings.map((finding) =>
      keyer(finding.rule, finding.from),
    );
    const elapsed = performance.now() - started;
    expect(keys).toHaveLength(1_000);
    expect(new Set(keys).size).toBe(10);
    expect(elapsed).toBeLessThan(100);
  });

  it("reuses an earlier sentence when findings arrive out of order", () => {
    const text = "First one here. Second one follows. Third one ends.";
    const keyer = createGrammarSuppressionKeyer(text);
    const third = keyer("R", text.indexOf("Third"));
    const first = keyer("R", 0);
    expect(keyer("R", text.indexOf("Third") + 2)).toBe(third);
    expect(keyer("R", 2)).toBe(first);
    expect(first).toBe(grammarSuppressionKey("R", text, 0));
    expect(third).toBe(
      grammarSuppressionKey("R", text, text.indexOf("Third")),
    );
    expect(first).not.toBe(third);
  });
});
