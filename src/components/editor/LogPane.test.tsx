// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

const openFileAndGotoLine = vi.fn();
vi.mock("@/features/synctex", () => ({
  openFileAndGotoLine: (...args: unknown[]) => openFileAndGotoLine(...args),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, getConfig: vi.fn().mockResolvedValue({}) };
});

import { LogPane } from "./LogPane";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const SUCCESS_LOG = "This is pdfTeX, Version 3.14\n(./main.tex\nOutput written on main.pdf.\n)";

const ERROR_LOG = [
  "This is pdfTeX, Version 3.14",
  "(./main.tex",
  "! Undefined control sequence.",
  "l.42 \\notacommand",
  "",
  "Your command was ignored.",
  ")",
].join("\n");

function setCompileState(overrides: Partial<ReturnType<typeof useCompileStore.getState>>) {
  useCompileStore.setState({
    status: "idle",
    phase: "idle",
    log: "",
    errors: [],
    pdfBytes: null,
    lastCompiledAt: null,
    compileTimeMs: null,
    autoCompile: false,
    ...overrides,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
}

describe("LogPane", () => {
  beforeEach(() => {
    openFileAndGotoLine.mockClear();
    useFilesStore.setState({ activePath: "main.tex", tree: [] } as unknown as ReturnType<
      typeof useFilesStore.getState
    >);
  });

  it("shows the raw log immediately for a successful compile with no errors", () => {
    setCompileState({ status: "success", log: SUCCESS_LOG, errors: [] });
    render(<LogPane />);
    expect(screen.getByText(/Output written on main\.pdf/)).toBeInTheDocument();
  });

  it("shows an error card with the explanation, location, and a collapsed raw log by default when there are errors", () => {
    setCompileState({
      status: "error",
      log: ERROR_LOG,
      errors: [
        {
          line: 42,
          file: "main.tex",
          message: "Undefined control sequence.",
          kind: "error",
          explanation: "LaTeX does not recognize this command.",
        },
      ],
    });
    render(<LogPane />);
    expect(screen.getByText("LaTeX does not recognize this command.")).toBeInTheDocument();
    expect(screen.getByText("main.tex · line 42")).toBeInTheDocument();
    expect(screen.queryByText("This is pdfTeX, Version 3.14")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Raw logs"));
    expect(screen.getByText("This is pdfTeX, Version 3.14")).toBeInTheDocument();
  });

  it("expands the error card's raw excerpt by default and shows the offending line", () => {
    setCompileState({
      status: "error",
      log: ERROR_LOG,
      errors: [
        {
          line: 42,
          file: "main.tex",
          message: "Undefined control sequence.",
          kind: "error",
          explanation: "LaTeX does not recognize this command.",
        },
      ],
    });
    render(<LogPane />);
    expect(screen.getByText(/\\notacommand/)).toBeInTheDocument();
  });

  it("jumps to the code location when the crosshair button is clicked", () => {
    setCompileState({
      status: "error",
      log: ERROR_LOG,
      errors: [
        {
          line: 42,
          file: "main.tex",
          message: "Undefined control sequence.",
          kind: "error",
          explanation: "LaTeX does not recognize this command.",
        },
      ],
    });
    render(<LogPane />);
    fireEvent.click(screen.getByLabelText("Go to code location"));
    expect(openFileAndGotoLine).toHaveBeenCalledWith("main.tex", 42);
  });

  it("still shows Ask AI and Copy log for a failed compile", () => {
    setCompileState({
      status: "error",
      log: ERROR_LOG,
      errors: [
        { line: 42, file: "main.tex", message: "Undefined control sequence.", kind: "error", explanation: null },
      ],
    });
    render(<LogPane />);
    expect(screen.getByText("Ask AI", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Copy log")).toBeInTheDocument();
  });
});
