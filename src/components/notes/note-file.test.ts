import { describe, expect, it } from "vitest";
import { newNoteSource, noteBody, noteSummary, readNoteFacts, withNoteIcon, withNoteTitle } from "./note-file";

const NOTE = `---
title: Masking strategy
icon: 🧪
agent: Claude Code
bibliography: refs.bib
---

## Where things stand

The encoder trains on **patches** with a [mask ratio](https://example.org) of 0.75.
Run 3 reached \`64.1%\`.

More text.
`;

describe("note files", () => {
  it("reads the title, icon, agent and first paragraph", () => {
    expect(readNoteFacts(NOTE)).toEqual({
      title: "Masking strategy",
      icon: "🧪",
      agent: "Claude Code",
      summary: "The encoder trains on patches with a mask ratio of 0.75. Run 3 reached 64.1%.",
    });
  });

  it("reads a note without front matter", () => {
    expect(readNoteFacts("Just a line.\n")).toEqual({ title: null, icon: undefined, agent: undefined, summary: "Just a line." });
  });

  it("skips code, tables, lists and quotes when it looks for a summary", () => {
    const body = "```python\nx = 1\n```\n\n| a |\n| - |\n\n- item\n\n> quote\n\n$$x$$\n\nThe real paragraph.\n";
    expect(noteSummary(body)).toBe("The real paragraph.");
  });

  it("ends the summary at a code block or list that follows the first paragraph", () => {
    expect(noteSummary("First line\nsecond line\n```js\nx = 1\n```\n")).toBe("First line second line");
    expect(noteSummary("Opening words\n- a list item\n")).toBe("Opening words");
  });

  it("cuts a long summary without spaces at the limit", () => {
    const summary = noteSummary("x".repeat(240));
    expect(summary).toBe(`${"x".repeat(180)}…`);
  });

  it("cuts mid-word when the last space comes too early", () => {
    const summary = noteSummary(`short ${"y".repeat(240)}`);
    expect(summary).toBe(`${`short ${"y".repeat(240)}`.slice(0, 180)}…`);
  });

  it("reads an empty title as missing and keeps a note with no body as front matter only", () => {
    expect(readNoteFacts("---\ntitle: \"  \"\nicon: x\n---\n").title).toBeNull();
    expect(newNoteSource("Plain", "   ")).toBe("---\ntitle: Plain\n---\n\n");
  });

  it("cuts a long summary on a word", () => {
    const summary = noteSummary(`${"word ".repeat(80)}end`);
    expect(summary.length).toBeLessThanOrEqual(181);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toContain("wor…");
  });

  it("drops the front matter from the body", () => {
    expect(noteBody(NOTE).startsWith("\n## Where things stand")).toBe(true);
    expect(noteBody("No front matter\n")).toBe("No front matter\n");
  });

  it("writes a new note with its title and keeps other keys when the icon changes", () => {
    const source = newNoteSource("Run 3: results", "Body text.\n", "Codex");
    expect(source).toBe('---\ntitle: "Run 3: results"\nagent: Codex\n---\n\nBody text.\n');
    expect(readNoteFacts(source).title).toBe("Run 3: results");
    const withIcon = withNoteIcon(NOTE, "lucide:flask-conical");
    expect(readNoteFacts(withIcon).icon).toBe("lucide:flask-conical");
    expect(withIcon).toContain("bibliography: refs.bib");
    expect(readNoteFacts(withNoteIcon(withIcon, undefined)).icon).toBeUndefined();
    expect(readNoteFacts(withNoteTitle(NOTE, "Renamed")).title).toBe("Renamed");
    expect(noteBody(withNoteTitle(NOTE, "Renamed"))).toBe(noteBody(NOTE));
  });
});
