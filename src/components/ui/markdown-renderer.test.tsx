// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMarkdownDocumentCache,
  isMarkdownDocumentCached,
  renderMarkdownDocument,
} from "./markdown-renderer";
import { resetRemoteImagesForTest, trustRemoteImageHost } from "@/lib/remote-image";

function renderDocument(source: string, inverted = false) {
  return render(<div>{renderMarkdownDocument(source, inverted, false)}</div>);
}

beforeEach(() => {
  clearMarkdownDocumentCache();
  localStorage.clear();
  resetRemoteImagesForTest();
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

  it("holds back an image from another site until it is asked for", () => {
    const { container } = renderDocument("Look: ![pixel](https://tracker.example.com/p.gif?note=secret) done");

    expect(container.querySelector("img")).toBeNull();
    const placeholder = container.querySelector("[data-remote-image]");
    expect(placeholder?.getAttribute("data-remote-image")).toBe("tracker.example.com");
    expect(placeholder?.textContent).toContain("Image from tracker.example.com");
    expect(placeholder?.querySelector("[title]")).toBeNull();
    expect(placeholder?.hasAttribute("title")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Load image" }));
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://tracker.example.com/p.gif?note=secret");
    expect(image?.getAttribute("alt")).toBe("pixel");
    expect(container.querySelector("[data-remote-image]")).toBeNull();
  });

  it("loads an image from a host trusted in Settings without a click, and keeps the author's title off the image", () => {
    trustRemoteImageHost("arxiv.org");
    const { container } = renderDocument('![figure](https://arxiv.org/f.png "Figure 1") ![other](https://example.org/o.png)');

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://arxiv.org/f.png");
    expect(image?.hasAttribute("title")).toBe(false);
    expect(container.querySelectorAll("[data-remote-image]")).toHaveLength(1);
    act(() => trustRemoteImageHost("example.org"));
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("[data-remote-image]")).toBeNull();
  });

  it("shows images from the app itself straight away", () => {
    const { container } = renderDocument(`![plot](assets/plot.png) ![icon](${window.location.origin}/icon.png)`);

    expect(Array.from(container.querySelectorAll("img"), (image) => image.getAttribute("src"))).toEqual([
      "assets/plot.png",
      `${window.location.origin}/icon.png`,
    ]);
    expect(container.querySelector("[data-remote-image]")).toBeNull();
  });

  it("caches plain and inverted renders separately", () => {
    renderMarkdownDocument("cached text", true);

    expect(isMarkdownDocumentCached("cached text", true)).toBe(true);
    expect(isMarkdownDocumentCached("cached text")).toBe(false);

    clearMarkdownDocumentCache();
    expect(isMarkdownDocumentCached("cached text", true)).toBe(false);
  });

  it("takes a caller's own components, extra rehype passes, link rewriting and cache", () => {
    const markHeadings = () => (tree: { children: Array<{ tagName?: string; properties?: Record<string, unknown> }> }) => {
      for (const node of tree.children) if (node.tagName === "h1") node.properties = { ...node.properties, dataMarked: "yes" };
    };
    const options = {
      namespace: "test-preview",
      rehypePlugins: [markHeadings],
      components: { a: ({ children }: { children?: ReactNode }) => <span data-link>{children}</span> },
      urlTransform: (url: string) => url,
    };
    const source = "# Title $x$\n\n[docs](custom:target) ![i](custom:image)";
    const { container } = render(<div>{renderMarkdownDocument(source, false, true, options)}</div>);

    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-marked", "yes");
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector("[data-link]")?.textContent).toBe("docs");
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("custom:image");
    expect(isMarkdownDocumentCached(source)).toBe(false);
    expect(renderMarkdownDocument(source, false, true, options)).toBe(renderMarkdownDocument(source, false, true, options));
  });
});
