import { describe, expect, it } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  isProofreadingWorkerResponse,
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
