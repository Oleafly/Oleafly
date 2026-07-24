// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseMarkdownBody } from "./parse";

describe("parseMarkdownBody", () => {
  it("splits YAML frontmatter from the body and parses the body", () => {
    const source = `---\ntitle: Untitled\nauthor: ''\n---\n\n# Introduction\n\nWrite your document in Markdown.\n`;
    const { doc, frontmatter } = parseMarkdownBody(source);
    expect(frontmatter).toBe("---\ntitle: Untitled\nauthor: ''\n---");
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
  });

  it("returns an empty frontmatter string when there is none", () => {
    const { frontmatter } = parseMarkdownBody("# Just a heading\n");
    expect(frontmatter).toBe("");
  });
});
