// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { parseLatexLog } from "@oleafly/latex";

vi.mock("@/features/synctex", () => ({ openFileAndGotoLine: vi.fn() }));

const parseLatexLogSpy = vi.hoisted(() => vi.fn());
vi.mock("@oleafly/latex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oleafly/latex")>();
  return {
    ...actual,
    parseLatexLog: (...args: Parameters<typeof actual.parseLatexLog>) => {
      parseLatexLogSpy(...args);
      return actual.parseLatexLog(...args);
    },
  };
});

import { LogPane } from "./LogPane";

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const FIXTURES = join(process.cwd(), "crates", "oleafly-core", "tests", "fixtures", "compile-log");
const TARGET_BYTES = 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

function buildLog(): string {
  const corpus = readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".log"))
    .sort()
    .map((name) => readFileSync(join(FIXTURES, name), "utf8"))
    .join("\n");
  let log = "";
  while (log.length < TARGET_BYTES) log += corpus;
  return log;
}

function chunksOf(log: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < log.length; offset += CHUNK_BYTES) {
    chunks.push(log.slice(offset, offset + CHUNK_BYTES));
  }
  return chunks;
}

describe("LogPane main-thread parse cost", () => {
  it("moves the per-chunk log parse off the main thread", () => {
    const log = buildLog();
    const chunks = chunksOf(log);
    const error = {
      line: 4,
      file: "chapters/methods.tex",
      message: "Undefined control sequence.",
      kind: "error",
      explanation: null,
    };

    let before = 0;
    let accumulated = "";
    for (const chunk of chunks) {
      accumulated += chunk;
      const started = performance.now();
      parseLatexLog(accumulated, "main.tex");
      before += performance.now() - started;
    }
    const beforeParses = parseLatexLogSpy.mock.calls.length;
    const singleStart = performance.now();
    const diagnostics = parseLatexLog(log, "main.tex");
    const single = performance.now() - singleStart;
    parseLatexLogSpy.mockClear();

    useFilesStore.setState({ activePath: "main.tex", mainDoc: "main.tex", tree: [] } as unknown as ReturnType<
      typeof useFilesStore.getState
    >);
    useCompileStore.setState({
      status: "compiling",
      phase: "building",
      log: "",
      errors: [error],
      diagnostics: null,
    } as unknown as ReturnType<typeof useCompileStore.getState>);
    render(<LogPane />);
    accumulated = "";
    const streamStart = performance.now();
    for (const chunk of chunks) {
      accumulated += chunk;
      const next = accumulated;
      act(() => {
        useCompileStore.setState({ log: next });
      });
    }
    const streaming = performance.now() - streamStart;
    act(() => {
      useCompileStore.setState({ status: "error", phase: "idle", diagnostics: diagnostics.slice(0, 50) });
    });
    const afterParses = parseLatexLogSpy.mock.calls.length;

    console.info(
      [
        `log: ${log.length} chars, ${chunks.length} chunks of ${CHUNK_BYTES / 1024} KB, ${diagnostics.length} diagnostics`,
        `before: ${beforeParses} main-thread parses, ${before.toFixed(0)} ms summed (single full parse ${single.toFixed(1)} ms)`,
        `after: ${afterParses} main-thread parses while streaming and applying the result, pane re-render for ${chunks.length} chunks ${streaming.toFixed(0)} ms`,
      ].join("\n"),
    );

    expect(beforeParses).toBe(chunks.length);
    expect(afterParses).toBe(0);
  });
});
