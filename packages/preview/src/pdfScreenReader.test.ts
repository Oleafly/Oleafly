// @vitest-environment jsdom

import type {
  StructTreeNode,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import {
  createPdfScreenReaderLayer,
  extractPdfScreenReaderText,
} from "./pdfScreenReader";

function textItem(str: string, hasEOL = false): TextItem {
  return {
    str,
    hasEOL,
    dir: "ltr",
    transform: [1, 0, 0, 1, 0, 0],
    width: str.length,
    height: 12,
    fontName: "sans",
  };
}

describe("PDF screen reader view", () => {
  it("extracts readable fallback text with natural spacing", () => {
    const textContent: TextContent = {
      items: [textItem("Training"), textItem("Compute", true), textItem("Optimal"), textItem(".")],
      styles: {},
      lang: "en",
    };

    expect(extractPdfScreenReaderText(textContent).plainText).toBe(
      "Training Compute\nOptimal.",
    );
  });

  it("preserves tagged headings and reading order", () => {
    const textContent: TextContent = {
      items: [
        { type: "beginMarkedContentProps", id: "heading" },
        textItem("Compute-optimal training"),
        { type: "endMarkedContent", id: "" },
        { type: "beginMarkedContentProps", id: "body" },
        textItem("A concise summary."),
        { type: "endMarkedContent", id: "" },
      ],
      styles: {},
      lang: "en",
    };
    const structureTree: StructTreeNode = {
      role: "Root",
      children: [
        { role: "H1", children: [{ type: "content", id: "heading" }] },
        { role: "P", children: [{ type: "content", id: "body" }] },
      ],
    };

    const layer = createPdfScreenReaderLayer({
      pageNumber: 2,
      totalPages: 12,
      textContent,
      structureTree,
    });

    expect(layer.getAttribute("aria-label")).toBe(
      "Screen reader view, page 2 of 12",
    );
    expect(layer.querySelector("h1")?.textContent).toBe("Compute-optimal training");
    expect(layer.querySelector("p")?.textContent).toBe("A concise summary.");
  });

  it("shows a clear empty state when a page has no extractable text", () => {
    const layer = createPdfScreenReaderLayer({
      pageNumber: 1,
      totalPages: 1,
      textContent: { items: [], styles: {}, lang: null },
    });

    expect(layer.textContent).toContain("No readable text was found on this page.");
  });
});
