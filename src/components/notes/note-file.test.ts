import { afterEach, describe, expect, it, vi } from "vitest";
import { LINE_ICON_PREFIX, LINE_ICONS } from "./note-icons";
import {
  isNoteColor,
  NOTE_COLORS,
  newNoteSource,
  noteBody,
  noteColorFor,
  noteSummary,
  readNoteFacts,
  starterIcon,
  withNoteIcon,
  withNoteIdentity,
  withNoteTitle,
} from "./note-file";

const ID = "6f1c2b7e-3d4a-4e5f-9a8b-0c1d2e3f4a5b";
const FRESH = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

const NOTE = `---
title: Masking strategy
kind: note
id: ${ID}
icon: 🧪
agent: Claude Code
bibliography: refs.bib
---

## Where things stand

The encoder trains on **patches** with a [mask ratio](https://example.org) of 0.75.
Run 3 reached \`64.1%\`.

More text.
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("note files", () => {
  it("reads the title, id, icon, agent and first paragraph, and leaves the kind out", () => {
    expect(readNoteFacts(NOTE)).toStrictEqual({
      title: "Masking strategy",
      id: ID,
      icon: "🧪",
      color: "teal",
      agent: "Claude Code",
      summary: "The encoder trains on patches with a mask ratio of 0.75. Run 3 reached 64.1%.",
    });
  });

  it("reads a note without front matter", () => {
    expect(readNoteFacts("Just a line.\n")).toStrictEqual({
      title: null,
      id: undefined,
      icon: undefined,
      color: "blue",
      agent: undefined,
      summary: "Just a line.",
    });
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
    expect(newNoteSource("Plain", "   ", undefined, ID)).toBe(
      `---\ntitle: Plain\nicon: lucide:sun\ncolor: teal\nkind: note\nid: ${ID}\n---\n\n`,
    );
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
    const source = newNoteSource("Run 3: results", "Body text.\n", "Codex", ID);
    expect(source).toBe(
      `---\ntitle: "Run 3: results"\nagent: Codex\nicon: lucide:sun\ncolor: teal\nkind: note\nid: ${ID}\n---\n\nBody text.\n`,
    );
    expect(readNoteFacts(source).title).toBe("Run 3: results");
    const withIcon = withNoteIcon(NOTE, "lucide:flask-conical");
    expect(readNoteFacts(withIcon).icon).toBe("lucide:flask-conical");
    expect(withIcon).toContain("bibliography: refs.bib");
    expect(readNoteFacts(withNoteIcon(withIcon, undefined)).icon).toBeUndefined();
    expect(readNoteFacts(withNoteTitle(NOTE, "Renamed")).title).toBe("Renamed");
    expect(noteBody(withNoteTitle(NOTE, "Renamed"))).toBe(noteBody(NOTE));
  });
});

describe("note colours and starting icons", () => {
  it("offers ten tones", () => {
    expect(NOTE_COLORS).toEqual(["violet", "blue", "sky", "teal", "emerald", "lime", "amber", "orange", "rose", "pink"]);
  });

  it("knows a palette tone from anything else", () => {
    expect(isNoteColor("rose")).toBe(true);
    expect(isNoteColor("crimson")).toBe(false);
    expect(isNoteColor(undefined)).toBe(false);
  });

  it("derives the same tone from the same seed and spreads seeds over the whole palette", () => {
    expect(noteColorFor(ID)).toBe("teal");
    expect(noteColorFor(ID)).toBe(noteColorFor(ID));
    const tones = new Set(Array.from({ length: 200 }, (_, index) => noteColorFor(`seed-${index}`)));
    expect(tones.size).toBe(NOTE_COLORS.length);
  });

  it("starts a note with one of the research line icons, picked by its id", () => {
    expect(starterIcon(ID)).toBe("lucide:sun");
    expect(starterIcon(FRESH)).toBe("lucide:book");
    const icons = new Set(Array.from({ length: 300 }, (_, index) => starterIcon(`seed-${index}`)));
    expect(icons.size).toBeGreaterThan(60);
    for (const icon of icons) {
      expect(icon.startsWith(LINE_ICON_PREFIX)).toBe(true);
      expect(LINE_ICONS).toHaveProperty([icon.slice(LINE_ICON_PREFIX.length)]);
    }
  });

  it("gives two new notes different looks", () => {
    const first = readNoteFacts(newNoteSource("A", "", undefined, ID));
    const second = readNoteFacts(newNoteSource("A", "", undefined, FRESH));
    expect([first.icon, first.color]).toEqual(["lucide:sun", "teal"]);
    expect([second.icon, second.color]).toEqual(["lucide:book", "amber"]);
  });

  it("reads the declared colour in any case and falls back when it is not a palette tone", () => {
    expect(readNoteFacts(`---\nid: ${ID}\ncolor: Rose\n---\n`).color).toBe("rose");
    expect(readNoteFacts(`---\nid: ${ID}\ncolor: crimson\n---\n`).color).toBe("teal");
  });

  it("derives a missing colour from the id, then the title, so it stays put", () => {
    expect(readNoteFacts(`---\ntitle: Masking strategy\nid: ${ID}\n---\n`).color).toBe("teal");
    expect(readNoteFacts("---\ntitle: Masking strategy\n---\n").color).toBe("violet");
    expect(readNoteFacts("---\ntitle: Masking strategy\n---\n\nOther body").color).toBe("violet");
  });
});

describe("note identity", () => {
  function freshIds() {
    return vi.spyOn(crypto, "randomUUID").mockReturnValue(FRESH);
  }

  it("gives a new note a fresh id when none is passed", () => {
    const uuid = freshIds();
    expect(newNoteSource("Untitled")).toBe(
      `---\ntitle: Untitled\nicon: lucide:book\ncolor: amber\nkind: note\nid: ${FRESH}\n---\n\n`,
    );
    expect(uuid).toHaveBeenCalledOnce();
  });

  it("leaves a note that declares itself and has an id exactly as it is", () => {
    const uuid = freshIds();
    expect(withNoteIdentity(NOTE)).toBe(NOTE);
    expect(uuid).not.toHaveBeenCalled();
  });

  it("accepts a quoted kind and a quoted or numeric id", () => {
    const uuid = freshIds();
    for (const text of [
      '---\nkind: "note"\nid: "abc"\n---\n\nBody\n',
      "---\nkind: 'note'\nid: 'abc'\n---\n",
      "---\nkind: note # a note\nid: 42\n---\n",
    ]) {
      expect(withNoteIdentity(text)).toBe(text);
    }
    expect(uuid).not.toHaveBeenCalled();
  });

  it("adds a missing id after the other keys", () => {
    const uuid = freshIds();
    expect(withNoteIdentity("---\ntitle: A\nkind: note\n---\n\nBody\n")).toBe(
      `---\ntitle: A\nkind: note\nid: ${FRESH}\n---\n\nBody\n`,
    );
    expect(uuid).toHaveBeenCalledOnce();
    expect(withNoteIdentity("---\ntitle: A\nkind: note\n---\n", "given")).toBe("---\ntitle: A\nkind: note\nid: given\n---\n");
    expect(uuid).toHaveBeenCalledOnce();
  });

  it("adds a missing kind and keeps the id it has", () => {
    const uuid = freshIds();
    expect(withNoteIdentity("---\ntitle: A\nid: keep-me\n---\nBody")).toBe("---\ntitle: A\nid: keep-me\nkind: note\n---\nBody");
    expect(uuid).not.toHaveBeenCalled();
  });

  it("fills an empty kind or id and corrects a kind that names something else", () => {
    expect(withNoteIdentity("---\nkind:\nid:\n---\n", ID)).toBe(`---\nkind: note\nid: ${ID}\n---\n`);
    expect(withNoteIdentity('---\nkind: "paper"\nid: ""\n---\n', ID)).toBe(`---\nkind: "note"\nid: "${ID}"\n---\n`);
    expect(withNoteIdentity(`---\nkind: Note\nid: ${ID}\n---\n`)).toBe(`---\nkind: note\nid: ${ID}\n---\n`);
  });

  it("adds front matter to a note that has none", () => {
    expect(withNoteIdentity("Just a line.\n", ID)).toBe(`---\nkind: note\nid: ${ID}\n---\n\nJust a line.\n`);
    expect(withNoteIdentity("\nStarts with a blank line.", ID)).toBe(`---\nkind: note\nid: ${ID}\n---\n\nStarts with a blank line.`);
    expect(withNoteIdentity("", ID)).toBe(`---\nkind: note\nid: ${ID}\n---\n`);
    expect(withNoteIdentity("----\nA heavy rule.\n", ID)).toBe(`---\nkind: note\nid: ${ID}\n---\n\n----\nA heavy rule.\n`);
  });

  it("keeps CRLF line endings", () => {
    expect(withNoteIdentity("---\r\ntitle: A\r\n---\r\n\r\nBody\r\n", ID)).toBe(
      `---\r\ntitle: A\r\nkind: note\r\nid: ${ID}\r\n---\r\n\r\nBody\r\n`,
    );
    expect(withNoteIdentity("Line one\r\nLine two\r\n", ID)).toBe(
      `---\r\nkind: note\r\nid: ${ID}\r\n---\r\n\r\nLine one\r\nLine two\r\n`,
    );
    expect(withNoteIdentity("\r\nBody", ID)).toBe(`---\r\nkind: note\r\nid: ${ID}\r\n---\r\n\r\nBody`);
  });

  it("keeps a byte order mark in front of the front matter", () => {
    expect(withNoteIdentity("\uFEFFBody", ID)).toBe(`\uFEFF---\nkind: note\nid: ${ID}\n---\n\nBody`);
    expect(withNoteIdentity("\uFEFF---\ntitle: A\n---\n", ID)).toBe(`\uFEFF---\ntitle: A\nkind: note\nid: ${ID}\n---\n`);
  });

  it("keeps comments, lists and an ellipsis closer byte for byte", () => {
    const text = "---\ntitle: A # working title\ntags:\n  - ssl\n  - masking\n...\n\n# Heading\n\nBody\n";
    expect(withNoteIdentity(text, ID)).toBe(
      `---\ntitle: A # working title\ntags:\n  - ssl\n  - masking\nkind: note\nid: ${ID}\n...\n\n# Heading\n\nBody\n`,
    );
  });

  it("leaves text alone when it cannot tell where the front matter ends", () => {
    const uuid = freshIds();
    for (const text of ["---\ntitle: A\nBody without a closing line\n", "---\n\nA paragraph after a rule.\n", "---"]) {
      expect(withNoteIdentity(text)).toBe(text);
    }
    expect(uuid).not.toHaveBeenCalled();
  });

  it("does nothing the second time", () => {
    const once = withNoteIdentity("---\ntitle: A\n---\n\nBody\n", ID);
    expect(withNoteIdentity(once, "other")).toBe(once);
    expect(readNoteFacts(once)).toMatchObject({ title: "A", id: ID, summary: "Body" });
  });
});
