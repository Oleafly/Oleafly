// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearHighlightCache, HighlightedCode } from "./code-highlighter";

const highlightCode = vi.hoisted(() => vi.fn());

vi.mock("@codemirror/language", () => ({
  StreamLanguage: {
    define: () => ({ parser: { parse: () => ({}) } }),
  },
}));

vi.mock("@codemirror/legacy-modes/mode/javascript", () => ({
  javascript: {},
}));

vi.mock("@lezer/highlight", () => ({
  classHighlighter: {},
  highlightCode,
}));

describe("HighlightedCode", () => {
  beforeEach(() => {
    highlightCode.mockClear();
    clearHighlightCache();
  });

  it("swaps in a highlighted block as one insertion instead of one per token", async () => {
    highlightCode.mockImplementation(
      (
        source: string,
        _tree: unknown,
        _highlighter: unknown,
        emit: (text: string, classes: string) => void,
        lineBreak: () => void,
      ) => {
        for (const line of source.split("\n")) {
          emit(line, "tok-keyword");
          lineBreak();
        }
      },
    );
    const source = Array.from({ length: 400 }, (_, index) => `const line${index} = ${index};`).join("\n");
    const { container } = render(
      <pre>
        <HighlightedCode language="javascript" source={source} />
      </pre>,
    );
    const pre = container.querySelector("pre") as HTMLElement;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(pre, { childList: true, subtree: true });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(pre.querySelectorAll(".tok-keyword")).toHaveLength(400);
    expect(pre.querySelector("code")?.textContent).toBe(`${source}\n`);
    expect(records.length).toBeLessThanOrEqual(2);
  });

  it("leaves very large code blocks raw", async () => {
    const source = `const ${"x".repeat(50_000)}`;
    const { container } = render(
      <HighlightedCode language="javascript" source={source} />,
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(highlightCode).not.toHaveBeenCalled();
    expect(container.querySelector("code")?.textContent).toBe(source);
  });

  it("never paints tokens from the previous source while a new source loads", async () => {
    highlightCode.mockImplementation(
      (source: string, _tree: unknown, _highlighter: unknown, emit: (text: string, classes: string) => void) => {
        emit(source, "tok-keyword");
      },
    );
    const { container, rerender } = render(
      <HighlightedCode language="javascript" source="oldSource" />,
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(container.querySelector(".tok-keyword")).toHaveTextContent("oldSource");

    rerender(<HighlightedCode language="javascript" source="newSource" />);

    expect(container.querySelector("code")?.textContent).toBe("newSource");
    expect(container.querySelector(".tok-keyword")).toBeNull();
  });

  it("reuses highlighted tokens across remounts without running the highlighter again", async () => {
    highlightCode.mockImplementation(
      (source: string, _tree: unknown, _highlighter: unknown, emit: (text: string, classes: string) => void) => {
        emit(source, "tok-keyword");
      },
    );
    const first = render(
      <HighlightedCode language="javascript" source="const answer = 42;" />,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(first.container.querySelector(".tok-keyword")).toHaveTextContent("const answer = 42;");
    first.unmount();

    const second = render(
      <HighlightedCode language="javascript" source="const answer = 42;" />,
    );

    expect(second.container.querySelector(".tok-keyword")).toHaveTextContent("const answer = 42;");
    expect(highlightCode).toHaveBeenCalledTimes(1);
  });
});
