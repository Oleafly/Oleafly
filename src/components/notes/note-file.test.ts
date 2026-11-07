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
