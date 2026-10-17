// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompileError, LogDiagnostic } from "@oleafly/backend-port";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";

vi.mock("@/features/synctex", () => ({ openFileAndGotoLine: vi.fn() }));

import { LogPane } from "./LogPane";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

type Snapshot = {
  log: string;
  errors: CompileError[];
  diagnostics: LogDiagnostic[] | null;
  status: string;
  mainDoc: string;
};

function snapshot(overrides: Partial<Snapshot>): Snapshot {
  return { log: "", errors: [], diagnostics: null, status: "success", mainDoc: "main.tex", ...overrides };
}

function pane(overrides: Partial<Snapshot>) {
  return render(<LogPane snapshot={snapshot(overrides) as never} onOpenLocation={vi.fn()} />);
}

function longLog(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `log line ${index}`).join("\n");
}

function warning(index: number, overrides: Partial<LogDiagnostic> = {}): LogDiagnostic {
  return {
    severity: "warning",
    category: "package-warning",
    file: "main.tex",
    line: index + 1,
    message: `Warning number ${index}`,
    ...overrides,
  };
}

function copyEvent() {
  const setData = vi.fn();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { setData, getData: () => "", clearData: vi.fn() },
  });
  return { event, setData };
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  resetDisplayHomes();
  vi.restoreAllMocks();
});

describe("a very long raw log", () => {
  it("renders the beginning of the log without putting every line in the page", () => {
    pane({ log: longLog(20_000) });
    expect(screen.getByText("log line 0")).toBeInTheDocument();
    expect(screen.queryByText("log line 19999")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-testid=compile-log-raw] *").length).toBeLessThan(2_000);
  });

  it("marks the log as the select-all scope and its text as selectable", () => {
    pane({ log: longLog(10) });
    expect(screen.getByTestId("compile-log-scroll")).toHaveAttribute("data-select-all-scope");
    expect(screen.getByTestId("compile-log-raw")).toHaveClass("select-text");
  });

  it("copies the whole raw log, with real paths, when everything in the log is selected", () => {
    setDisplayHomes(["/Users/ada"]);
    const log = `${longLog(20_000)}\n(/Users/ada/.oleafly/tinytex/article.cls\r\nend`;
    pane({ log });
    const scroller = screen.getByTestId("compile-log-scroll");
    document.getSelection()?.selectAllChildren(scroller);
    const { event, setData } = copyEvent();
    (scroller.firstElementChild as HTMLElement).dispatchEvent(event);
    expect(setData).toHaveBeenCalledWith("text/plain", log);
    expect(event.defaultPrevented).toBe(true);
  });

  it("copies the whole log even when the log text itself receives the copy event", () => {
    const log = longLog(5_000);
    pane({ log });
    const scroller = screen.getByTestId("compile-log-scroll");
    const line = scroller.querySelector(".cm-line") as HTMLElement;
    const caret = document.createRange();
    caret.setStart(line.firstChild as Text, 2);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(caret);
    document.dispatchEvent(new Event("selectionchange"));
    document.getSelection()?.selectAllChildren(scroller);
    const { event, setData } = copyEvent();
    line.dispatchEvent(event);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith("text/plain", log);
  });

  it("copies only the selected part when part of the log is selected", () => {
    pane({ log: longLog(20) });
    const line = screen.getByText("log line 3");
    const range = document.createRange();
    range.setStart(line.firstChild as Text, 0);
    range.setEnd(line.firstChild as Text, 3);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const { event, setData } = copyEvent();
    line.dispatchEvent(event);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith("text/plain", "log");
  });

  it("shows streamed text as it arrives", () => {
    const view = pane({ status: "compiling", log: "first line" });
    view.rerender(
      <LogPane snapshot={snapshot({ status: "compiling", log: "first line\nsecond line" }) as never} onOpenLocation={vi.fn()} />,
    );
    expect(screen.getByText("first line")).toBeInTheDocument();
    expect(screen.getByText("second line")).toBeInTheDocument();
  });
});

describe("a long problems list", () => {
  it("renders the first warnings without putting thousands of cards in the page", () => {
    pane({ status: "error", log: "x", diagnostics: Array.from({ length: 5_000 }, (_, index) => warning(index)) });
    expect(screen.getByText("Warning number 0")).toBeInTheDocument();
    expect(screen.queryByText("Warning number 4999")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Warning number /).length).toBeLessThan(200);
  });

  it("opens a long typesetting group without rendering every box", () => {
    pane({
      status: "error",
      log: "x",
      diagnostics: Array.from({ length: 5_000 }, (_, index) =>
        warning(index, { severity: "typesetting", category: "overfull-box", message: `Overfull box ${index}` }),
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: /Typesetting/u }));
    expect(screen.getByText("Overfull box 0")).toBeInTheDocument();
    expect(screen.queryByText("Overfull box 4999")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Overfull box /).length).toBeLessThan(200);
  });
});

describe("scrolling to the end", () => {
  it("lands on the real bottom when the content grows during the animation", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    pane({ log: longLog(50) });
    const box = screen.getByTestId("compile-log-scroll");
    let scrollHeight = 1_000;
    let scrollTop = 0;
    Object.defineProperties(box, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => 200 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    const runFrames = (time: number) => {
      now = time;
      act(() => {
        for (const frame of frames.splice(0)) frame(time);
      });
    };
    runFrames(0);
    fireEvent.click(screen.getByRole("button", { name: "Scroll to bottom" }));
    runFrames(350);
    scrollHeight = 1_500;
    runFrames(800);
    runFrames(900);
    expect(scrollTop).toBe(1_300);
  });
});
