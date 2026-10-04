// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { CompileError, LogDiagnostic } from "@oleafly/backend-port";

vi.mock("@/features/synctex", () => ({ openFileAndGotoLine: vi.fn() }));

import { LogPane } from "./LogPane";

const log = en.log;

function error(overrides: Partial<CompileError>): CompileError {
  return { line: null, file: null, message: "Problem", kind: "error", explanation: null, ...overrides };
}

function pane(
  overrides: Partial<{ log: string; errors: CompileError[]; diagnostics: LogDiagnostic[] | null; status: string; mainDoc: string }>,
  onOpenLocation = vi.fn(),
) {
  render(
    <LogPane
      snapshot={{
        log: "",
        errors: [],
        diagnostics: null,
        status: "error",
        mainDoc: "main.tex",
        ...overrides,
      } as never}
      onOpenLocation={onOpenLocation}
    />,
  );
  return onOpenLocation;
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async (_text: string) => {});
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("error card locations", () => {
  it.each([
    [{ file: "chapters/a.tex" }, "chapters/a.tex"],
    [{ line: 7 }, log.locationLine.replace("{{line}}", "7")],
    [{ line: 7, column: 3 }, log.locationLineColumn.replace("{{line}}", "7").replace("{{column}}", "3")],
  ])("describes %o", async (where, expected) => {
    pane({ errors: [error(where)] });
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("shows no location line when the error has none", () => {
    pane({ errors: [error({ message: "Somewhere" })] });
    const title = screen.getByText("Somewhere");
    expect(title.nextElementSibling).toBeNull();
    expect(screen.queryByRole("button", { name: log.goToLocation })).not.toBeInTheDocument();
  });

  it("opens the exact column when the error has one", () => {
    const open = pane({ errors: [error({ file: "main.tex", line: 4, column: 9 })] });
    fireEvent.click(screen.getByRole("button", { name: log.goToLocation }));
    expect(open).toHaveBeenCalledWith("main.tex", 4, 9);
  });
});

describe("error excerpts", () => {
  const LOG = [
    "(./main.tex",
    "! Undefined control sequence.",
    "l.12 \\foo",
    "         {bar}",
    "",
    "Afterwards.",
    "! Missing $ inserted.",
    "l.20 x^2",
    "! Emergency stop.",
    ")",
  ].join("\n");

  it("stops the excerpt at a blank line and folds it away on request", () => {
    pane({ log: LOG, errors: [error({ message: "Undefined control sequence." })] });
    const toggle = screen.getByRole("button", { name: /Undefined control sequence/u, expanded: true });
    const excerpt = toggle.closest(".rounded-lg")?.querySelector("pre");
    expect(excerpt?.textContent).toContain("l.12");
    expect(excerpt?.textContent).not.toContain("Afterwards");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.closest(".rounded-lg")?.querySelector("pre")).toBeNull();
  });

  it("stops the excerpt at the next error", () => {
    pane({ log: LOG, errors: [error({ message: "Missing $ inserted." })] });
    const toggle = screen.getByRole("button", { name: /Missing \$ inserted/u });
    const excerpt = toggle.closest(".rounded-lg")?.querySelector("pre");
    expect(excerpt?.textContent).toContain("l.20 x^2");
    expect(excerpt?.textContent).not.toContain("Emergency stop");
  });

  it("copies the error with its source details and hints", async () => {
    pane({
      errors: [
        error({
          message: "Unknown variable",
          file: "main.typ",
          line: 3,
          source_line: "#let x = y",
          column: 9,
          hints: ["Define y first"],
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: log.copyError }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Unknown variable");
    expect(copied).toContain(`${log.hint}: Define y first`);
  });
});

describe("raw log colouring", () => {
  it("marks registers, runaway warnings, files, commands and braces", () => {
    pane({
      log: ["(./main.tex", "\\count@=\\count266", "Runaway argument?", "\\begin {document} (./intro.tex)", ")"].join("\n"),
    });
    const raw = screen.getByText(log.rawLogs).closest(".rounded-lg") as HTMLElement;
    expect(raw.querySelector(".text-muted-foreground\\/40")?.textContent).toBe("\\count@=\\count266");
    expect(raw.querySelector(".text-red-400")?.textContent).toBe("Runaway argument?");
    expect([...raw.querySelectorAll(".text-primary")].map((node) => node.textContent)).toContain("(./intro.tex)");
    expect([...raw.querySelectorAll(".text-fuchsia-500")].map((node) => node.textContent)).toEqual(["{", "}"]);
  });
});

describe("structured diagnostics", () => {
  const diagnostic = (overrides: Partial<LogDiagnostic>): LogDiagnostic => ({
    severity: "warning",
    category: "package-warning",
    file: null,
    line: null,
    message: "Something to note",
    ...overrides,
  });

  it("links a located diagnostic and labels partial locations", () => {
    const open = pane({
      diagnostics: [
        diagnostic({ message: "With both", file: "a.tex", line: 2 }),
        diagnostic({ message: "File only", file: "b.tex" }),
        diagnostic({ message: "Line only", line: 8 }),
        diagnostic({ message: "Nowhere" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "a.tex:2" }));
    expect(open).toHaveBeenCalledWith("a.tex", 2);
    expect(screen.getByText("b.tex")).toBeInTheDocument();
    expect(screen.getByText(log.locationLine.replace("{{line}}", "8"))).toBeInTheDocument();
    expect(screen.getByText("Nowhere").nextElementSibling).toBeNull();
  });

  it("folds typesetting and info notes into groups that open on click", () => {
    pane({
      diagnostics: [
        diagnostic({ severity: "typesetting", category: "overfull-box", message: "Overfull box" }),
        diagnostic({ severity: "info", category: "info", message: "Font note" }),
      ],
    });
    expect(screen.queryByText("Overfull box")).not.toBeInTheDocument();
    const group = screen.getByRole("button", { name: new RegExp(log.typesetting, "u") });
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Overfull box")).toBeInTheDocument();
    fireEvent.click(group);
    expect(screen.queryByText("Overfull box")).not.toBeInTheDocument();
  });

  it("hides diagnostics that repeat an error card, after normalising the message", () => {
    pane({
      errors: [
        error({ message: "Package foo Error: Bad option.", line: 3 }),
        error({ message: "Undefined reference x", kind: "warning", line: null }),
      ],
      diagnostics: [
        diagnostic({ severity: "error", category: "error", message: "Package foo: Bad option", line: 3 }),
        diagnostic({ category: "undefined-reference", message: "Undefined reference x", line: 9 }),
        diagnostic({ message: "LaTeX Error: Separate.", line: 1 }),
      ],
    });
    expect(screen.getAllByText(/Bad option/u)).toHaveLength(1);
    expect(screen.getAllByText("Undefined reference x")).toHaveLength(1);
    expect(screen.getByText("LaTeX Error: Separate.")).toBeInTheDocument();
  });

  it("does not parse a Typst log or a log that is still being written", () => {
    pane({ log: "! Undefined control sequence.\nl.1 \\x", mainDoc: "main.typ" });
    expect(screen.queryByText(/^Undefined control sequence/u)).not.toBeInTheDocument();
  });
});

describe("empty and compiling states", () => {
  it("explains where the output will appear", () => {
    pane({ status: "idle" });
    expect(screen.getByText(log.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: log.scrollToTop })).not.toBeInTheDocument();
  });

  it("holds the summary back while compiling", () => {
    pane({ status: "compiling", log: "! Bad.\nl.1 x", errors: [error({ message: "Bad." })] });
    expect(screen.getByText("Bad.")).toBeInTheDocument();
    expect(screen.queryByText(/1 error/u)).not.toBeInTheDocument();
  });
});

describe("scrolling the log", () => {
  it("animates to the top and back to the bottom", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    pane({ log: "line\n".repeat(50) });
    const box = screen.getByTestId("compile-log-scroll");
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 200 });
    box.scrollTop = 800;

    const runFrames = (time: number) => {
      now = time;
      for (const frame of frames.splice(0)) frame(time);
    };
    runFrames(0);

    fireEvent.click(screen.getByRole("button", { name: log.scrollToTop }));
    runFrames(350);
    expect(box.scrollTop).toBeGreaterThan(0);
    expect(box.scrollTop).toBeLessThan(800);
    runFrames(700);
    expect(box.scrollTop).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: log.scrollToBottom }));
    runFrames(1400);
    expect(box.scrollTop).toBe(800);
    vi.restoreAllMocks();
  });

  it("stops following the tail once the reader scrolls up", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { rerender } = render(
      <LogPane snapshot={{ log: "a", errors: [], diagnostics: null, status: "compiling", mainDoc: "main.tex" } as never} />,
    );
    const box = screen.getByTestId("compile-log-scroll");
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 200 });
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(box.scrollTop).toBe(800);

    box.scrollTop = 100;
    fireEvent.scroll(box);
    rerender(
      <LogPane snapshot={{ log: "a\nb", errors: [], diagnostics: null, status: "compiling", mainDoc: "main.tex" } as never} />,
    );
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(box.scrollTop).toBe(100);
    vi.restoreAllMocks();
  });
});
