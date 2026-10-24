// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/workspace.json" with { type: "json" };
import TerminalFindBar, { type TerminalSearch } from "./TerminalFindBar";

const find = en.terminal.find;

function fakeSearch() {
  let listener: ((index: number, count: number) => void) | null = null;
  const search = {
    findNext: vi.fn((_term: string, _incremental?: boolean) => true),
    findPrevious: vi.fn((_term: string) => true),
    clear: vi.fn(),
    onResults: vi.fn((next: (index: number, count: number) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
  } satisfies TerminalSearch;
  return { search, report: (index: number, count: number) => act(() => listener?.(index, count)) };
}

function input() {
  return screen.getByLabelText(find.label);
}

describe("terminal find bar", () => {
  it("finds as you type, steps with Enter and Shift+Enter, ignores IME Enter, closes on Escape", () => {
    const { search } = fakeSearch();
    const onClose = vi.fn();
    render(<TerminalFindBar search={search} onClose={onClose} />);
    expect(document.activeElement).toBe(input());

    fireEvent.change(input(), { target: { value: "error" } });
    expect(search.findNext).toHaveBeenLastCalledWith("error", true);

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(search.findNext).toHaveBeenLastCalledWith("error", false);
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(search.findPrevious).toHaveBeenLastCalledWith("error");

    const calls = search.findNext.mock.calls.length;
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(search.findNext).toHaveBeenCalledTimes(calls);

    fireEvent.click(screen.getByRole("button", { name: find.previous }));
    fireEvent.click(screen.getByRole("button", { name: find.next }));
    expect(search.findPrevious).toHaveBeenCalledTimes(2);

    fireEvent.change(input(), { target: { value: "" } });
    expect(search.clear).toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows '{{current}} of {{total}}' and 'No matches'", () => {
    const { search, report } = fakeSearch();
    render(<TerminalFindBar search={search} onClose={() => {}} />);
    const status = screen.getByTestId("terminal-find-status");
    expect(status).toHaveTextContent("");

    fireEvent.change(input(), { target: { value: "warn" } });
    report(2, 12);
    expect(status).toHaveTextContent("3 of 12");
    report(-1, 1200);
    expect(status).toHaveTextContent("… of 1,200");
    report(-1, 0);
    expect(status).toHaveTextContent(find.none);
  });

  it("clears the highlights when it closes", () => {
    const { search } = fakeSearch();
    const view = render(<TerminalFindBar search={search} onClose={() => {}} />);
    view.unmount();
    expect(search.clear).toHaveBeenCalled();
  });
});
