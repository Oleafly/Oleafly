// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer, {
  clearMarkdownDocumentCache,
  isMarkdownDocumentCached,
} from "./markdown-renderer";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

afterEach(() => clearMarkdownDocumentCache());

describe("streaming markdown and the document cache", () => {
  it("keeps the live tail out of the document cache until the message settles", () => {
    const settled = "First paragraph.\n\n";
    const deltas = ["Second par", "Second paragraph gro", "Second paragraph grows here."];
    const view = render(<MarkdownRenderer streaming>{settled + deltas[0]}</MarkdownRenderer>);
    for (const delta of deltas.slice(1)) {
      view.rerender(<MarkdownRenderer streaming>{settled + delta}</MarkdownRenderer>);
    }
    for (const delta of deltas) {
      expect(isMarkdownDocumentCached(delta)).toBe(false);
      expect(isMarkdownDocumentCached(settled + delta)).toBe(false);
    }
    view.unmount();

    const full = settled + deltas[2];
    render(<MarkdownRenderer>{full}</MarkdownRenderer>);
    expect(isMarkdownDocumentCached(full)).toBe(true);
  });
});
