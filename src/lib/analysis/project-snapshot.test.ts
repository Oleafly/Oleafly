import { describe, expect, it } from "vitest";
import type { ProjectIndex } from "@/lib/index/types";
import {
  normalizeAnalysisFailure,
  normalizeDiagnostics,
  normalizeProjectIndex,
} from "./project-snapshot";

describe("normalizeDiagnostics", () => {
  it("treats a diagnostic without severity as an error from the language service", () => {
    const [normalized] = normalizeDiagnostics(
      "file:///p/main.tex",
      [
        {
          range: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 4 },
          },
          message: "Undefined control sequence",
        },
      ],
      { projectRevision: 5 },
    );
    expect(normalized).toEqual({
      id: "file:///p/main.tex:2:1:2:4:language-service::0",
      uri: "file:///p/main.tex",
      range: {
        start: { line: 2, character: 1 },
        end: { line: 2, character: 4 },
      },
      severity: "error",
      message: "Undefined control sequence",
      source: "language-service",
      projectRevision: 5,
    });
  });
});

describe("normalizeAnalysisFailure", () => {
  it("keeps the code and structured reason of an error", () => {
    const error = Object.assign(new Error("boom"), {
      code: "transport_closed",
      analysisReason: { key: "processExited" as const },
    });
    expect(normalizeAnalysisFailure(error, false)).toEqual({
      name: "Error",
      message: "boom",
      code: "transport_closed",
      reason: { key: "processExited" },
      retryable: false,
    });
  });

  it("stringifies values that are not errors", () => {
    expect(normalizeAnalysisFailure("plain failure")).toEqual({
      name: "Error",
      message: "plain failure",
      retryable: true,
    });
    expect(normalizeAnalysisFailure(42, false)).toEqual({
      name: "Error",
      message: "42",
      retryable: false,
    });
  });
});

describe("normalizeProjectIndex", () => {
  function index(name: string): ProjectIndex {
    const symbol = {
      kind: "label" as const,
      name,
      file: "main.tex",
      line: 1,
      from: 0,
      to: name.length,
      nameFrom: 0,
      nameTo: name.length,
    };
    return {
      defs: [symbol],
      uses: [],
      symbolAt: () => null,
      definitionFor: () => null,
      references: () => [],
      allReferences: () => [],
      renamePlan: () => ({ edits: [], conflicts: [] }) as never,
    } as unknown as ProjectIndex;
  }

  it("converts an index once and hands back the same data for it", () => {
    const first = index("intro");
    const normalized = normalizeProjectIndex(first);
    expect(normalizeProjectIndex(first)).toBe(normalized);
    expect(normalized.definitions.map((symbol) => symbol.name)).toEqual(["intro"]);

    const next = normalizeProjectIndex(index("methods"));
    expect(next).not.toBe(normalized);
    expect(next.definitions.map((symbol) => symbol.name)).toEqual(["methods"]);
  });
});
