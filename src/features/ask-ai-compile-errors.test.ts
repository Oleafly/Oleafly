import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompileError } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  errors: [] as CompileError[],
  ensure: vi.fn(async () => true),
  handoff: vi.fn(),
}));

vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ errors: mocks.errors }) },
}));
vi.mock("@/features/assistant-handoff", () => ({
  ensureAiProviderOrOpenSettings: mocks.ensure,
  handoffToAssistant: mocks.handoff,
}));

import { askAiAboutCompileErrors } from "./ask-ai-compile-errors";

function prompt(): string {
  expect(mocks.handoff).toHaveBeenCalledOnce();
  return mocks.handoff.mock.calls[0][0] as string;
}

describe("askAiAboutCompileErrors", () => {
  beforeEach(() => {
    mocks.handoff.mockClear();
    mocks.ensure.mockClear();
    mocks.errors = [];
  });

  it("passes the Typst position, source excerpt and hints to the assistant", async () => {
    mocks.errors = [
      {
        line: 3,
        file: "chapters/intro.typ",
        message: "unknown variable: foo",
        kind: "error",
        explanation: "Typst does not know this name.",
        column: 8,
        end_column: 11,
        source_line: "Hello #foo world.",
        hints: ["if you meant to display multiple letters as is, try adding spaces between each letter: `f o o`"],
      },
      {
        line: 1,
        file: "main.typ",
        message: "unknown font family: x",
        kind: "warning",
        explanation: null,
        column: 17,
        end_column: 20,
        source_line: '#set text(font: "x")',
      },
    ];
    await askAiAboutCompileErrors();
    const text = prompt();
    expect(text).toContain("- chapters/intro.typ:3:8: unknown variable: foo");
    expect(text).toContain("    3 | Hello #foo world.\n      |        ^^^");
    expect(text).toContain("    hint: if you meant to display multiple letters as is");
    expect(text).not.toContain("unknown font family");
    expect(mocks.handoff.mock.calls[0][1]).toEqual({ autoSend: false });
  });

  it("keeps the LaTeX format for errors without columns", async () => {
    mocks.errors = [
      { line: 42, file: "main.tex", message: "Undefined control sequence.", kind: "error", explanation: null },
      { line: null, file: null, message: "Emergency stop.", kind: "error", explanation: null },
    ];
    await askAiAboutCompileErrors();
    const text = prompt();
    expect(text).toContain("- main.tex:42: Undefined control sequence.\n- Emergency stop.");
    expect(text).not.toContain(" | ");
  });

  it("does nothing until an AI provider is configured", async () => {
    mocks.ensure.mockResolvedValueOnce(false);
    await askAiAboutCompileErrors();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });
});
