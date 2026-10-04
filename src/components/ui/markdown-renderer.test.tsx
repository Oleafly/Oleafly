// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMarkdownDocumentCache,
  isMarkdownDocumentCached,
  renderMarkdownDocument,
} from "./markdown-renderer";

function renderDocument(source: string, inverted = false) {
  return render(<div>{renderMarkdownDocument(source, inverted, false)}</div>);
}

beforeEach(() => {
  clearMarkdownDocumentCache();
});

describe("markdown documents", () => {
  it("renders headings, lists, emphasis and a rule", () => {
    const { container } = renderDocument(
      ["# Title", "## Section", "### Detail", "", "- first", "- *second*", "", "1. one", "", "---", "", "~~gone~~"].join("\n"),
    );

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Detail" })).toBeTruthy();
    const [bullets, numbered] = screen.getAllByRole("list");
    expect(bullets.tagName).toBe("UL");
    expect(within(bullets).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["first", "second"]);
    expect(within(bullets).getByText("second").tagName).toBe("EM");
    expect(numbered.tagName).toBe("OL");
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(container.querySelector("del")?.textContent).toBe("gone");
  });

  it("renders quotes and tables", () => {
    renderDocument(["> quoted", "", "| Name | Value |", "| --- | --- |", "| a | 1 |"].join("\n"));

    expect(screen.getByText("quoted").closest("blockquote")).not.toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Name", "Value"]);
    expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["a", "1"]);
  });

  it("keeps a fenced block's text and opens links in a new window", () => {
    const { container } = renderDocument(["[docs](https://example.com)", "", "```", "line one", "line two", "```"].join("\n"));

    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(container.querySelector("pre")?.textContent).toContain("line one\nline two");
  });

  it("uses light text for links and inline code on a dark bubble", () => {
    renderDocument("See [docs](https://example.com) and `code`.", true);

    expect(screen.getByRole("link", { name: "docs" }).className).toContain("text-white");
    expect(screen.getByText("code").className).toContain("text-white");
  });

  it("caches plain and inverted renders separately", () => {
    renderMarkdownDocument("cached text", true);

    expect(isMarkdownDocumentCached("cached text", true)).toBe(true);
    expect(isMarkdownDocumentCached("cached text")).toBe(false);

    clearMarkdownDocumentCache();
    expect(isMarkdownDocumentCached("cached text", true)).toBe(false);
  });
});
