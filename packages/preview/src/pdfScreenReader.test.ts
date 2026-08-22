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

  it("maps list, table, quote, code, and unknown structure roles", () => {
    const marked = (id: string, value: string) => [
      { type: "beginMarkedContentProps" as const, id },
      textItem(value),
      { type: "endMarkedContent" as const, id: "" },
    ];
    const textContent: TextContent = {
      items: [
        ...marked("item", "List item"),
        ...marked("head", "Heading"),
        ...marked("cell", "Cell"),
        ...marked("quote", "Quoted"),
        ...marked("code", "const x = 1"),
        ...marked("unknown", "Aside"),
      ],
      styles: {},
      lang: "en",
    };
    const structureTree: StructTreeNode = {
      role: "Root",
      children: [
        { role: "L", children: [{ role: "LI", children: [{ type: "content", id: "item" }] }] },
        {
          role: "TABLE",
          children: [
            {
              role: "TR",
              children: [
                { role: "TH", children: [{ type: "content", id: "head" }] },
                { role: "TD", children: [{ type: "content", id: "cell" }] },
              ],
            },
          ],
        },
        { role: "BLOCKQUOTE", children: [{ type: "content", id: "quote" }] },
        { role: "CODE", children: [{ type: "content", id: "code" }] },
        { role: "Aside", children: [{ type: "content", id: "unknown" }] },
      ],
    };

    const layer = createPdfScreenReaderLayer({
      pageNumber: 1,
      totalPages: 1,
      textContent,
      structureTree,
    });

    expect(layer.querySelector("ul li")?.textContent).toBe("List item");
    expect(layer.querySelector("table th")?.textContent).toBe("Heading");
    expect(layer.querySelector("table td")?.textContent).toBe("Cell");
    expect(layer.querySelector("blockquote")?.textContent).toBe("Quoted");
    expect(layer.querySelector("code")?.textContent).toBe("const x = 1");
    expect(layer.querySelector("article > div")?.textContent).toBe("Aside");
  });

  it("ignores empty fragments while preserving an explicit line break", () => {
    const textContent: TextContent = {
      items: [textItem("Alpha"), textItem("   ", true), textItem("", false)],
      styles: {},
      lang: null,
    };

    expect(extractPdfScreenReaderText(textContent).plainText).toBe("Alpha");
  });
});
