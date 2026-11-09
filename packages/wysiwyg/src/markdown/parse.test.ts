// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markdownBlockAt, parseMarkdownBody, splitMarkdownFrontMatter } from "./parse";

describe("parseMarkdownBody", () => {
  it("splits YAML frontmatter from the body and parses the body", () => {
    const source = `---\ntitle: Untitled\nauthor: ''\n---\n\n# Introduction\n\nWrite your document in Markdown.\n`;
    const { doc, frontmatter } = parseMarkdownBody(source);
    expect(frontmatter).toBe("---\ntitle: Untitled\nauthor: ''\n---");
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
  });

  it("returns an empty frontmatter string when there is none", () => {
    const { frontmatter, separator } = parseMarkdownBody("# Just a heading\n");
    expect(frontmatter).toBe("");
    expect(separator).toBe("");
  });

  it("keeps a byte order mark with the front matter it opens", () => {
    const { doc, frontmatter } = parseMarkdownBody("\uFEFF---\ntitle: A\n---\n\nBody\n");
    expect(frontmatter).toBe("\uFEFF---\ntitle: A\n---");
    expect(doc.content).toHaveLength(1);
    expect(doc.content?.[0]).toMatchObject({ type: "paragraph", content: [{ text: "Body" }] });
  });

  it("accepts a YAML document end marker as the closer", () => {
    const { doc, frontmatter } = parseMarkdownBody("---\ntitle: A\n...\n\nBody\n");
    expect(frontmatter).toBe("---\ntitle: A\n...");
    expect(doc.content?.[0]).toMatchObject({ type: "paragraph", content: [{ text: "Body" }] });
  });

  it("accepts spaces after the fences", () => {
    expect(parseMarkdownBody("--- \ntitle: A\n---  \nBody\n").frontmatter).toBe("--- \ntitle: A\n---  ");
  });

  it("does not treat a fence followed by text as the closer", () => {
    expect(parseMarkdownBody("---\ntitle: A\n---Body\n").frontmatter).toBe("");
  });

  it("returns the blank lines between the front matter and the body", () => {
    expect(parseMarkdownBody("---\ntitle: A\n---\n# H\n").separator).toBe("\n");
    expect(parseMarkdownBody("---\ntitle: A\n---\n\n\n# H\n").separator).toBe("\n\n\n");
    expect(parseMarkdownBody("---\r\ntitle: A\r\n---\r\n\r\n# H\r\n").separator).toBe("\r\n\r\n");
    expect(parseMarkdownBody("---\ntitle: A\n---").separator).toBe("");
    expect(parseMarkdownBody("---\ntitle: A\n---\n\n    code\n").separator).toBe("\n\n");
  });
});

describe("splitMarkdownFrontMatter", () => {
  it("splits without parsing the body", () => {
    expect(splitMarkdownFrontMatter("---\ntitle: A\n---\n\nBody\n")).toEqual({
      frontmatter: "---\ntitle: A\n---",
      separator: "\n\n",
      body: "Body\n",
    });
    expect(splitMarkdownFrontMatter("Body\n")).toEqual({ frontmatter: "", separator: "", body: "Body\n" });
  });
});

describe("markdownBlockAt", () => {
  const source = [
    "---",
    "title: Notes",
    "---",
    "",
    "# Intro",
    "",
    "First paragraph.",
    "",
    "## Methods",
    "",
    "- one",
    "- two",
    "",
    "Last line.",
    "",
  ].join("\n");

  it("finds the block that holds an offset, after front matter", () => {
    const at = (text: string) => markdownBlockAt(source, source.indexOf(text));
    expect(at("# Intro")).toEqual({ index: 0, count: 5 });
    expect(at("First")).toEqual({ index: 1, count: 5 });
    expect(at("## Methods")).toEqual({ index: 2, count: 5 });
    expect(at("- two")).toEqual({ index: 3, count: 5 });
    expect(at("Last")).toEqual({ index: 4, count: 5 });
  });

  it("puts front matter and the end of the file on the nearest block", () => {
    expect(markdownBlockAt(source, 0)?.index).toBe(0);
    expect(markdownBlockAt(source, source.length)?.index).toBe(4);
  });

  it("matches the parsed document block for block", () => {
    const { doc } = parseMarkdownBody(source);
    const heading = markdownBlockAt(source, source.indexOf("## Methods"));
    expect(doc.content?.[heading?.index ?? -1]).toMatchObject({ type: "heading", attrs: { level: 2 } });
  });

  it("counts CRLF line endings like the parser does", () => {
    const crlf = source.replaceAll("\n", "\r\n");
    expect(markdownBlockAt(crlf, crlf.indexOf("## Methods"))).toEqual({ index: 2, count: 5 });
  });

  it("gives nothing for an empty document", () => {
    expect(markdownBlockAt("", 0)).toBeNull();
  });
});
