import path from "node:path";
import type { Diagnostic } from "@codemirror/lint";
import { afterAll, beforeAll, describe, it } from "vitest";
import { lintBibtexText, lintLatexText, setEditorTranslator } from "@oleafly/editor";
import { markdownToProse, maskLatexForProseRegions, maskTypstForProseRegions } from "@oleafly/editor/prose";
import { installEnglishEditorMessages } from "../../../../packages/editor/src/test-messages";
import { byCodePoint, compressMap, expectGolden, LINT_FIXTURES, normalizeEndings, readCases } from "./support";

type TextCase = { name: string; text: string };
type ProseCase = TextCase & { format: "latex" | "markdown" | "typst" };

interface RecordedDiagnostic {
  from: number;
  to: number;
  severity: string;
  key: string;
  params: Record<string, unknown>;
}

const cases = <T extends { name: string }>(suite: string) =>
  readCases<T>(path.join(LINT_FIXTURES, "cases", `${suite}.json`));
const expected = (name: string) => path.join(LINT_FIXTURES, "expected", `${name}.json`);

function canonicalParams(params: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(params).sort(([left], [right]) => byCodePoint(left, right))));
}

function recorded(diagnostics: readonly Diagnostic[]): RecordedDiagnostic[] {
  return diagnostics
    .map((diagnostic) => {
      const { key, params } = JSON.parse(diagnostic.message) as Pick<RecordedDiagnostic, "key" | "params">;
      return { from: diagnostic.from, to: diagnostic.to, severity: diagnostic.severity, key, params };
    })
    .sort(
      (left, right) =>
        left.from - right.from ||
        left.to - right.to ||
        byCodePoint(left.key, right.key) ||
        byCodePoint(canonicalParams(left.params), canonicalParams(right.params)),
    );
}

function proseRecord(format: ProseCase["format"], text: string) {
  if (format === "markdown") {
    const { prose, map } = markdownToProse(text);
    return { prose, map: compressMap(map) };
  }
  const { prose, masked } = format === "latex" ? maskLatexForProseRegions(text) : maskTypstForProseRegions(text);
  return { prose, masked: masked.map((span) => [span.from, span.to]) };
}

describe("lint goldens", () => {
  beforeAll(() => {
    setEditorTranslator((key, params) => JSON.stringify({ key, params: params ?? {} }));
  });

  afterAll(() => {
    installEnglishEditorMessages();
  });

  it("LaTeX linter matches the committed golden", () => {
    const out: Record<string, RecordedDiagnostic[]> = {};
    for (const testCase of cases<TextCase>("latex")) {
      out[testCase.name] = recorded(lintLatexText(normalizeEndings(testCase.text)));
    }
    expectGolden(expected("latex"), out);
  });

  it("BibTeX linter matches the committed golden", () => {
    const out: Record<string, RecordedDiagnostic[]> = {};
    for (const testCase of cases<TextCase>("bibtex")) {
      out[testCase.name] = recorded(lintBibtexText(normalizeEndings(testCase.text)));
    }
    expectGolden(expected("bibtex"), out);
  });

  it("prose masks match the committed golden", () => {
    const out: Record<string, unknown> = {};
    for (const testCase of cases<ProseCase>("prose")) {
      out[testCase.name] = proseRecord(testCase.format, normalizeEndings(testCase.text));
    }
    expectGolden(expected("masks"), out);
  });
});
