import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dialect, LocalLinter, type Lint } from "harper.js";
import { binaryInlined as binary } from "harper.js/binaryInlined";
import {
  markdownToProse,
  maskLatexForProseRegions,
  maskTypstForProseRegions,
  PROSE_PLACEHOLDER,
} from "@oleafly/editor/prose";
import { BUILTIN_PROOFREADING_WORDS } from "@/lib/proofreading/ignored";
import { buildLintConfig } from "@/lib/proofreading/lint-profile";
import { byCodePoint, expectGolden, LINT_FIXTURES, normalizeEndings, readCases, REPO } from "./support";

type ProseCase = { name: string; format: "latex" | "markdown" | "typst"; text: string };

interface RecordedLint {
  rule: string;
  kind: string;
  from: number;
  to: number;
  message: string;
  suggestions: { kind: "replace" | "remove" | "insert_after"; text: string }[];
}

const SUGGESTION_KINDS = ["replace", "remove", "insert_after"] as const;

function prose(format: ProseCase["format"], text: string): string {
  if (format === "markdown") return markdownToProse(text).prose;
  return (format === "latex" ? maskLatexForProseRegions(text) : maskTypstForProseRegions(text)).prose;
}

function suggestions(lint: Lint): RecordedLint["suggestions"] {
  const out: RecordedLint["suggestions"] = [];
  const all = lint.suggestions();
  for (const suggestion of all.slice(0, 8)) {
    const value = Number(suggestion.kind());
    const kind = SUGGESTION_KINDS[value === 1 || value === 2 ? value : 0];
    const text = suggestion.get_replacement_text();
    if (text || kind === "remove") out.push({ kind, text });
  }
  for (const suggestion of all) suggestion.free();
  return out;
}

function record(rule: string, lint: Lint): RecordedLint {
  const span = lint.span();
  const recorded = {
    rule,
    kind: lint.lint_kind(),
    from: span.start,
    to: span.end,
    message: lint.message(),
    suggestions: suggestions(lint),
  };
  span.free();
  lint.free();
  return recorded;
}

describe("Harper golden", () => {
  let linter: LocalLinter;

  beforeAll(async () => {
    linter = new LocalLinter({ binary });
    await linter.setup();
    await linter.setDialect(Dialect.American);
    await linter.setLintConfig(buildLintConfig([], [], Object.keys(await linter.getDefaultLintConfig())));
    const words = [...new Set([PROSE_PLACEHOLDER, ...BUILTIN_PROOFREADING_WORDS])]
      .filter((word) => /^[\p{L}'’-]+$/u.test(word))
      .sort(byCodePoint);
    await linter.clearWords();
    await linter.importWords(words);
    // The first lint builds Harper's lazy dictionary state; keep it out of the cases.
    const warmup = await linter.lint("A short sentence with a Xqzvbnmlkjh word.", { language: "plaintext" });
    for (const lint of warmup) lint.free();
  }, 30_000);

  afterAll(async () => {
    await linter.dispose();
  });

  it("harper_js_and_harper_core_versions_match", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "node_modules/harper.js/package.json"), "utf8")) as {
      version: string;
    };
    const cargo = fs.readFileSync(path.join(REPO, "crates/oleafly-lint/Cargo.toml"), "utf8");
    expect(cargo).toContain(`harper-core = { version = "=${pkg.version}"`);
  });

  it("matches the committed golden", async () => {
    const cases = readCases<ProseCase>(path.join(LINT_FIXTURES, "cases", "prose.json"));
    const out: Record<string, RecordedLint[]> = {};
    for (const testCase of cases) {
      const organized = await linter.organizedLints(prose(testCase.format, normalizeEndings(testCase.text)), {
        language: "plaintext",
      });
      const lints: RecordedLint[] = [];
      for (const [rule, group] of Object.entries(organized)) {
        for (const lint of group) lints.push(record(rule, lint));
      }
      lints.sort(
        (left, right) =>
          left.from - right.from ||
          left.to - right.to ||
          byCodePoint(left.rule, right.rule) ||
          byCodePoint(left.message, right.message),
      );
      out[testCase.name] = lints;
    }
    expectGolden(path.join(LINT_FIXTURES, "expected", "harper.json"), out);
  }, 60_000);
});
