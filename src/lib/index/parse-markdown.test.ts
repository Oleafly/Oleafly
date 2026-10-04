import { describe, expect, it } from "vitest";
import { parseFile } from "./parse-file";

describe("parseFile: Markdown", () => {
  it("indexes headings and Pandoc citations without applying LaTeX rules", () => {
    const parsed = parseFile("paper.MARKDOWN", "# Intro\nText [@doe2026].\n\\section{not latex}\n");
    expect(parsed.defs.map((d) => [d.kind, d.name])).toEqual([["section", "Intro"]]);
    expect(parsed.uses.map((u) => [u.kind, u.name])).toEqual([["cite", "doe2026"]]);
  });

  it("ignores headings and citations inside fenced code", () => {
    const parsed = parseFile("main.md", "````md\n# Nope\n```\n@fake\n````\n## Real {#real}\nSetext\n------\n");
    expect(parsed.defs.map((d) => d.name)).toEqual(["Real", "Setext"]);
    expect(parsed.uses).toEqual([]);
  });

  it("masks YAML front matter and inline code", () => {
    const parsed = parseFile("main.md", "---\ntitle: '@metadata'\n---\nText `@code` and @real.\n");
    expect(parsed.uses.map((u) => u.name)).toEqual(["real"]);
  });

  it("keeps exact heading spans when headings contain inline code", () => {
    const text = "# Use `compile()` safely {#compile}";
    const parsed = parseFile("main.md", text);
    const heading = parsed.defs[0];
    expect(heading.name).toBe("Use `compile()` safely");
    expect(text.slice(heading.nameFrom, heading.nameTo)).toBe(heading.name);
  });

  it("does not interpret a lone list marker as a Setext underline", () => {
    const parsed = parseFile("main.md", "Item\n-\nNext");
    expect(parsed.defs).toEqual([]);
  });
});

describe("parseFile: Markdown edge cases", () => {
  it("reads = underlines as top-level Setext headings", () => {
    const parsed = parseFile("main.md", "Title\n=====\nBody\n");
    expect(parsed.defs.map((d) => [d.name, d.level, d.line])).toEqual([["Title", 0, 1]]);
  });

  it("treats a rule after a blank line as a rule, not a heading", () => {
    const parsed = parseFile("main.md", "Text\n\n---\nMore\n");
    expect(parsed.defs).toEqual([]);
  });

  it("drops a citation that is only punctuation", () => {
    const parsed = parseFile("main.md", "Wait @... and @? but @key.\n");
    expect(parsed.uses.map((u) => u.name)).toEqual(["key"]);
  });
});
