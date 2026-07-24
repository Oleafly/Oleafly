// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";

describe("serializeMarkdownBody", () => {
  it("round-trips headings, bold, italic, links, and lists", () => {
    const body = `# Heading\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n- item one\n- item two\n`;
    const { doc } = parseMarkdownBody(body);
    expect(serializeMarkdownBody(doc)).toBe(body.trimEnd());
  });

  it("is idempotent on its own output", () => {
    const body = `# Heading\n\nSome **bold** text.\n`;
    const first = serializeMarkdownBody(parseMarkdownBody(body).doc);
    const second = serializeMarkdownBody(parseMarkdownBody(first).doc);
    expect(second).toBe(first);
  });
});
