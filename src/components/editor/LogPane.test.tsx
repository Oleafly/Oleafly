// @vitest-environment jsdom
import { describe, expect, expectTypeOf, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import type { LogDiagnostic as LatexLogDiagnostic } from "@oleafly/latex";
import type { LogDiagnostic as PortLogDiagnostic } from "@oleafly/backend-port";

const openFileAndGotoLine = vi.fn();
vi.mock("@/features/synctex", () => ({
  openFileAndGotoLine: (...args: unknown[]) => openFileAndGotoLine(...args),
}));

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

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
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
    diagnostics: null,
    pdfBytes: null,
    lastCompiledAt: null,
    compileTimeMs: null,
    autoCompile: false,
    ...overrides,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
}

const REFERENCE_WARNING: PortLogDiagnostic = {
  severity: "warning",
  category: "undefined-reference",
  file: "./main.tex",
  line: 10,
  message: "Cannot find reference `fig:x`.",
};

const OVERFULL_BOX: PortLogDiagnostic = {
  severity: "typesetting",
  category: "overfull-box",
  file: "./main.tex",
  line: 21,
  message: "Overfull \\hbox (15.36pt too wide)",
};

const WARNING_LOG = [
  "(./main.tex",
  "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 10.",
  ")",
].join("\n");

describe("LogPane", () => {
  beforeEach(() => {
    openFileAndGotoLine.mockClear();
    parseLatexLogSpy.mockClear();
    useFilesStore.setState({ activePath: "main.tex", mainDoc: "main.tex", tree: [] } as unknown as ReturnType<
      typeof useFilesStore.getState
    >);
  });

  it("keeps the backend and package diagnostic contracts identical", () => {
    expectTypeOf<PortLogDiagnostic>().toEqualTypeOf<LatexLogDiagnostic>();
  });

  it("renders grouped diagnostics from the store without parsing the log", () => {
    setCompileState({
      status: "error",
      log: WARNING_LOG,
      errors: [],
      diagnostics: [REFERENCE_WARNING, OVERFULL_BOX],
    });
    render(<LogPane />);
    expect(screen.getByText("Cannot find reference `fig:x`.")).toBeInTheDocument();
    expect(screen.getByText("Typesetting")).toBeInTheDocument();
    expect(parseLatexLogSpy).not.toHaveBeenCalled();
  });

  it("parses the finished log once when the backend sent no diagnostics", () => {
    setCompileState({ status: "error", log: WARNING_LOG, errors: [], diagnostics: null });
    render(<LogPane />);
    expect(screen.getByText("Cannot find reference `fig:x`.")).toBeInTheDocument();
    expect(parseLatexLogSpy).toHaveBeenCalledTimes(1);
    expect(parseLatexLogSpy).toHaveBeenCalledWith(WARNING_LOG, "main.tex");
    act(() => {
      useCompileStore.setState({ lastCompiledAt: 5 });
    });
    expect(parseLatexLogSpy).toHaveBeenCalledTimes(1);
  });

  it("does not parse the streaming log while a compile is running", () => {
    setCompileState({ status: "compiling", log: "(./main.tex", errors: [], diagnostics: null });
    render(<LogPane />);
    act(() => {
      useCompileStore.setState({ log: WARNING_LOG });
    });
    expect(parseLatexLogSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Cannot find reference `fig:x`.")).not.toBeInTheDocument();
    act(() => {
      useCompileStore.setState({ status: "error", diagnostics: [REFERENCE_WARNING] });
    });
    expect(screen.getByText("Cannot find reference `fig:x`.")).toBeInTheDocument();
    expect(parseLatexLogSpy).not.toHaveBeenCalled();
  });

  it("shows the raw log immediately for a successful compile with no errors", () => {
    setCompileState({ status: "success", log: SUCCESS_LOG, errors: [] });
    render(<LogPane />);
    expect(screen.getByText(/Output written on main\.pdf/)).toBeInTheDocument();
  });

  it("shows scroll-to-top and scroll-to-bottom buttons when the raw log is open", () => {
    setCompileState({ status: "success", log: SUCCESS_LOG, errors: [] });
    render(<LogPane />);
    expect(screen.getByLabelText("Scroll to top")).toBeInTheDocument();
    expect(screen.getByLabelText("Scroll to bottom")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Scroll to bottom"));
    fireEvent.click(screen.getByLabelText("Scroll to top"));
  });

  it("never scrolls the streaming log into the blank region below its content", async () => {
    setCompileState({ status: "compiling", log: "first chunk", errors: [] });
    render(<LogPane />);
    const box = screen.getByTestId("compile-log-scroll");
    let scrollTop = 0;
    Object.defineProperties(box, {
      clientHeight: { configurable: true, get: () => 400 },
      scrollHeight: { configurable: true, get: () => 1_200 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    act(() => {
      useCompileStore.setState({ log: "first chunk\nsecond chunk" });
    });

    await waitFor(() => expect(scrollTop).toBe(800));
  });

  it("does not yank the viewport away when the user scrolls up during a compile", async () => {
    setCompileState({ status: "compiling", log: "first chunk", errors: [] });
    render(<LogPane />);
    const box = screen.getByTestId("compile-log-scroll");
    let scrollTop = 800;
    let scrollHeight = 1_200;
    Object.defineProperties(box, {
      clientHeight: { configurable: true, get: () => 400 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    scrollTop = 200;
    fireEvent.scroll(box);
    scrollHeight = 1_300;
    act(() => {
      useCompileStore.setState({ log: "first chunk\nsecond chunk" });
    });

    await waitFor(() => expect(scrollTop).toBe(200));
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

  it("still shows Copy log (on the raw logs section) for a failed compile", () => {
    setCompileState({
      status: "error",
      log: ERROR_LOG,
      errors: [
        { line: 42, file: "main.tex", message: "Undefined control sequence.", kind: "error", explanation: null },
      ],
    });
    render(<LogPane />);
    expect(screen.getByText("Copy log")).toBeInTheDocument();
  });

  it("copies an individual error's text when its copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
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
    fireEvent.click(screen.getByLabelText("Copy error"));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("LaTeX does not recognize this command.");
  });
});
