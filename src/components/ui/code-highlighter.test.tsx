// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HighlightedCode } from "./code-highlighter";

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
});
