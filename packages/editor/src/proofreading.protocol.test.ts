import { describe, expect, it } from "vitest";
import {
  isProofreadingSuggestResult,
  isProofreadingWorkerResponse,
  isSpellingDiagnosticKind,
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingIdentity,
  sameProofreadingIdentity,
} from "./proofreading";

const IDENTITY: ProofreadingIdentity = {
  projectId: "project",
  path: "main.tex",
  revision: 3,
  requestGeneration: 1,
  surface: "source",
};

const DIAGNOSTIC = {
  from: 0,
  to: 4,
  message: "Did you mean this?",
  kind: "Spelling",
  source: "hunspell",
  word: "teh",
  suggestions: [{ text: "the", kind: 0 }],
  rule: null,
};

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: 1,
    identity: IDENTITY,
    status: "ready",
    diagnostics: [DIAGNOSTIC],
    ...overrides,
  };
}

function error(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "error",
    requestId: 2,
    identity: IDENTITY,
    error: { code: "analysis_failed", message: "boom", retryable: true },
    ...overrides,
  };
}

describe("proofreading identities", () => {
  it("compares every identity field", () => {
    expect(sameProofreadingIdentity(IDENTITY, { ...IDENTITY })).toBe(true);
    for (const change of [
      { projectId: null },
      { path: "other.tex" },
      { revision: 4 },
      { requestGeneration: 2 },
      { surface: "visual" as const },
    ]) {
      expect(sameProofreadingIdentity(IDENTITY, { ...IDENTITY, ...change }), JSON.stringify(change)).toBe(false);
    }
  });

  it("treats a missing kind as spelling", () => {
    expect(isSpellingDiagnosticKind(undefined)).toBe(true);
    expect(isSpellingDiagnosticKind("Spelling")).toBe(true);
    expect(isSpellingDiagnosticKind("Grammar")).toBe(false);
  });
});

describe("isProofreadingWorkerResponse", () => {
  it("accepts well-formed results and errors", () => {
    expect(isProofreadingWorkerResponse(result())).toBe(true);
    expect(isProofreadingWorkerResponse(result({ identity: { ...IDENTITY, projectId: null } }))).toBe(true);
    expect(
      isProofreadingWorkerResponse(
        result({ message: "ok", activeDictionaryLocale: "en_GB", truncated: false, status: "partial" }),
      ),
    ).toBe(true);
    expect(isProofreadingWorkerResponse(result({ status: "too_large", diagnostics: [] }))).toBe(true);
    expect(isProofreadingWorkerResponse(error())).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "result"],
    ["another protocol version", result({ protocolVersion: 1 })],
    ["an unknown type", result({ type: "progress" })],
    ["a fractional request id", result({ requestId: 1.5 })],
    ["a zero request id", result({ requestId: 0 })],
    ["a missing identity", result({ identity: null })],
    ["a numeric project id", result({ identity: { ...IDENTITY, projectId: 7 } })],
    ["a very long project id", result({ identity: { ...IDENTITY, projectId: "p".repeat(257) } })],
    ["a very long path", result({ identity: { ...IDENTITY, path: "a".repeat(2_049) } })],
    ["a negative revision", result({ identity: { ...IDENTITY, revision: -1 } })],
    ["a zero generation", result({ identity: { ...IDENTITY, requestGeneration: 0 } })],
    ["an unknown surface", result({ identity: { ...IDENTITY, surface: "print" } })],
    ["an unknown status", result({ status: "busy" })],
    ["findings on a skipped document", result({ status: "unsupported" })],
    ["diagnostics that are not a list", result({ diagnostics: {} })],
    ["a numeric message", result({ message: 5 })],
    ["a very long message", result({ message: "m".repeat(2_049) })],
    ["a malformed dictionary locale", result({ activeDictionaryLocale: "english" })],
    ["a numeric dictionary locale", result({ activeDictionaryLocale: 1 })],
    ["a string truncation flag", result({ truncated: "no" })],
    ["an unknown error code", error({ error: { code: "crash", message: "x", retryable: true } })],
    ["an error without a retry flag", error({ error: { code: "analysis_failed", message: "x" } })],
    ["an error with a long message", error({ error: { code: "analysis_failed", message: "e".repeat(1_025), retryable: false } })],
    ["an error without details", error({ error: null })],
  ])("rejects %s", (_name, value) => {
    expect(isProofreadingWorkerResponse(value)).toBe(false);
  });

  it.each([
    ["not an object", 7],
    ["a numeric rule", { ...DIAGNOSTIC, rule: 1 }],
    ["a fractional start", { ...DIAGNOSTIC, from: 0.5 }],
    ["a negative start", { ...DIAGNOSTIC, from: -1 }],
    ["an empty range", { ...DIAGNOSTIC, to: 0 }],
    ["a string end", { ...DIAGNOSTIC, to: "4" }],
    ["a missing message", { ...DIAGNOSTIC, message: undefined }],
    ["a very long message", { ...DIAGNOSTIC, message: "m".repeat(4_097) }],
    ["a very long kind", { ...DIAGNOSTIC, kind: "k".repeat(257) }],
    ["an unknown source", { ...DIAGNOSTIC, source: "other" }],
    ["a numeric word", { ...DIAGNOSTIC, word: 1 }],
    ["too many suggestions", { ...DIAGNOSTIC, suggestions: Array.from({ length: 9 }, () => ({ text: "a", kind: 0 })) }],
    ["a string deferral flag", { ...DIAGNOSTIC, suggestionsDeferred: "yes" }],
    ["a suggestion with an unknown kind", { ...DIAGNOSTIC, suggestions: [{ text: "the", kind: 3 }] }],
    ["a suggestion that is not an object", { ...DIAGNOSTIC, suggestions: ["the"] }],
    ["a very long suggestion", { ...DIAGNOSTIC, suggestions: [{ text: "s".repeat(4_097), kind: 0 }] }],
  ])("rejects a diagnostic with %s", (_name, diagnostic) => {
    expect(isProofreadingWorkerResponse(result({ diagnostics: [diagnostic] }))).toBe(false);
  });

  it("accepts a deferred suggestion flag and a rule name", () => {
    expect(
      isProofreadingWorkerResponse(
        result({ diagnostics: [{ ...DIAGNOSTIC, suggestionsDeferred: true, rule: "SpellCheck", source: "harper" }] }),
      ),
    ).toBe(true);
  });
});

describe("isProofreadingSuggestResult", () => {
  const suggestions = {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "suggestions",
    requestId: 4,
    locale: "de_DE",
    word: "Hause",
    suggestions: [{ text: "Haus", kind: 0 }],
  };

  it("accepts a well-formed suggestion result", () => {
    expect(isProofreadingSuggestResult(suggestions)).toBe(true);
  });

  it.each([
    ["null", null],
    ["another type", { ...suggestions, type: "result" }],
    ["a zero request id", { ...suggestions, requestId: 0 }],
    ["a malformed locale", { ...suggestions, locale: "german" }],
    ["a very long word", { ...suggestions, word: "w".repeat(129) }],
    ["too many suggestions", { ...suggestions, suggestions: Array.from({ length: 9 }, () => ({ text: "a", kind: 0 })) }],
    ["a malformed suggestion", { ...suggestions, suggestions: [{ text: 1, kind: 0 }] }],
  ])("rejects %s", (_name, value) => {
    expect(isProofreadingSuggestResult(value)).toBe(false);
  });
});
