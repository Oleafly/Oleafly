import { describe, expect, it } from "vitest";
import { splitMarkdownFrontMatter } from "./front-matter";

describe("splitMarkdownFrontMatter", () => {
  it("ends an empty block at the first closing fence", () => {
    expect(splitMarkdownFrontMatter("---\n---\nid: a\n---\nBody\n")).toEqual({
      frontmatter: "---\n---",
      separator: "\n",
      body: "id: a\n---\nBody\n",
    });
    expect(splitMarkdownFrontMatter("---\n...\n\nBody")).toEqual({ frontmatter: "---\n...", separator: "\n\n", body: "Body" });
  });

  it("ends a filled block at its first closing fence", () => {
    expect(splitMarkdownFrontMatter("---\nid: a\n---\nmore: b\n---\n").frontmatter).toBe("---\nid: a\n---");
    expect(splitMarkdownFrontMatter("---\nid: a\n").frontmatter).toBe("");
  });
});
