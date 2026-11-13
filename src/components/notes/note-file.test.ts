import { afterEach, describe, expect, it, vi } from "vitest";
import { frontMatterBody } from "@/lib/front-matter";
import { BOOK_COLOR_OPTIONS } from "@/components/library/Book";
import { LINE_ICON_PREFIX, LINE_ICONS } from "./note-icons";
import {
  isNoteColor,
  NOTE_COLORS,
  newNoteSource,
  noteColorFor,
  noteSummary,
  readNoteFacts,
  starterIcon,
  withNoteColor,
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
      color: "spring",
      agent: "Claude Code",
      summary: "The encoder trains on patches with a mask ratio of 0.75. Run 3 reached 64.1%.",
    });
  });

  it("reads a note without front matter", () => {
    expect(readNoteFacts("Just a line.\n")).toStrictEqual({
      title: null,
      id: undefined,
      icon: undefined,
      color: "rose",
      agent: undefined,
      summary: "Just a line.",
    });
  });

  it("skips code, tables, lists and quotes when it looks for a summary", () => {
    const body = "```python\nx = 1\n```\n\n| a |\n| - |\n\n- item\n\n> quote\n\n$$x$$\n\nThe real paragraph.\n";
    expect(noteSummary(body)).toBe("The real paragraph.");
  });

  it("writes highlights and sized pictures as plain text in a summary", () => {
    expect(noteSummary('Some <mark data-color="green">green **words**</mark> and ==yellow== ones.')).toBe(
      "Some green words and yellow ones.",
    );
    expect(noteSummary('<mark data-color="red">Red</mark> starts it.\n\nsecond')).toBe("Red starts it.");
    expect(noteSummary("See ![loss](assets/loss.png){width=50%} here, where x == y == z.")).toBe(
      "See loss here, where x == y == z.",
    );
  });

  it("keeps a backtick line inside a tilde fence out of the summary", () => {
    expect(noteSummary("~~~\n```\nnot prose\n~~~\n\nThe real paragraph.\n")).toBe("The real paragraph.");
    expect(noteSummary("````md\n```\ninside\n```\n````\nAfter the fence.")).toBe("After the fence.");
  });

  it("reads the last value of a key and treats an empty last value as missing", () => {
    expect(readNoteFacts("---\ntitle: One\ntitle: Two\nicon: a\nicon:\n---\nBody").title).toBe("Two");
    expect(readNoteFacts("---\ntitle: One\ntitle: Two\nicon: a\nicon:\n---\nBody").icon).toBeUndefined();
  });

  it("ends the summary at a code block or list that follows the first paragraph", () => {
    expect(noteSummary("First line\nsecond line\n```js\nx = 1\n```\n")).toBe("First line second line");
    expect(noteSummary("Opening words\n- a list item\n")).toBe("Opening words");
  });

  it.each([
    ["has no spaces", "x".repeat(240)],
    ["has its last space too early", `short ${"y".repeat(240)}`],
  ])("cuts a long summary that %s at the limit", (_name, text) => {
    expect(noteSummary(text)).toBe(`${text.slice(0, 180)}…`);
  });

  it("reads an empty title as missing and keeps a note with no body as front matter only", () => {
    expect(readNoteFacts("---\ntitle: \"  \"\nicon: x\n---\n").title).toBeNull();
    expect(newNoteSource("Plain", "   ", undefined, ID)).toBe(
      `---\ntitle: Plain\nicon: lucide:sun\ncolor: spring\nkind: note\nid: ${ID}\n---\n\n`,
    );
  });

  it("cuts a long summary on a word", () => {
    const summary = noteSummary(`${"word ".repeat(80)}end`);
    expect(summary.length).toBeLessThanOrEqual(181);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toContain("wor…");
  });

  it("reads quoted keys and plain values with a colon the way the vault does", () => {
    const facts = readNoteFacts("---\n\"title\": Paper: draft\nid : abc # old\ncolor: '#mint'\n---\n");
    expect(facts.title).toBe("Paper: draft");
    expect(facts.id).toBe("abc");
    expect(facts.color).toBe(noteColorFor("abc"));
  });

  it("renames a note whose front matter starts with a blank line inside that block, keeping its id", () => {
    const text = "---\n\ntitle: A\nid: x\n---\nBody";
    expect(withNoteTitle(text, "B")).toBe("---\n\ntitle: B\nid: x\n---\nBody");
    expect(readNoteFacts(withNoteTitle(text, "B"))).toMatchObject({ title: "B", id: "x" });
    expect(withNoteIdentity(text, ID)).toBe("---\n\ntitle: A\nid: x\nkind: note\n---\nBody");
  });

  it("writes a new note with its title and keeps other keys when the icon changes", () => {
    const source = newNoteSource("Run 3: results", "Body text.\n", "Codex", ID);
    expect(source).toBe(
      `---\ntitle: "Run 3: results"\nagent: Codex\nicon: lucide:sun\ncolor: spring\nkind: note\nid: ${ID}\n---\n\nBody text.\n`,
    );
    expect(readNoteFacts(source).title).toBe("Run 3: results");
    const withIcon = withNoteIcon(NOTE, "lucide:flask-conical");
    expect(readNoteFacts(withIcon).icon).toBe("lucide:flask-conical");
    expect(withIcon).toContain("bibliography: refs.bib");
    expect(readNoteFacts(withNoteIcon(withIcon, undefined)).icon).toBeUndefined();
    expect(readNoteFacts(withNoteTitle(NOTE, "Renamed")).title).toBe("Renamed");
    expect(frontMatterBody(withNoteTitle(NOTE, "Renamed"))).toBe(frontMatterBody(NOTE));
  });

  it("writes a colour into the front matter, replaces one already there, and keeps the other keys", () => {
    const added = withNoteColor(NOTE, "lilac");
    expect(added).toBe(NOTE.replace("bibliography: refs.bib\n", "bibliography: refs.bib\ncolor: lilac\n"));
    expect(readNoteFacts(added).color).toBe("lilac");
    const replaced = withNoteColor(added, "peach");
    expect(replaced).toBe(NOTE.replace("bibliography: refs.bib\n", "bibliography: refs.bib\ncolor: peach\n"));
    expect(replaced.match(/^color:/gmu)).toHaveLength(1);
    expect(readNoteFacts(replaced)).toMatchObject({ title: "Masking strategy", id: ID, icon: "🧪", agent: "Claude Code", color: "peach" });
    expect(frontMatterBody(replaced)).toBe(frontMatterBody(NOTE));
    const fresh = newNoteSource("Run 3", "", undefined, ID);
    expect(withNoteColor(fresh, "cream")).toBe(fresh.replace("color: spring\n", "color: cream\n"));
  });
});

describe("note colours and starting icons", () => {
  it("offers the 11 project cover colours in the library's order", () => {
    expect(NOTE_COLORS).toEqual(["blue", "cream", "peach", "rose", "pink", "lilac", "sky", "aqua", "cyan", "mint", "spring"]);
    expect(NOTE_COLORS).toEqual(BOOK_COLOR_OPTIONS.map(({ name }) => name.toLowerCase()));
  });

  it("knows a palette tone from anything else", () => {
    expect(isNoteColor("rose")).toBe(true);
    expect(isNoteColor("crimson")).toBe(false);
    expect(isNoteColor(undefined)).toBe(false);
  });

  it("derives the same colour from the same seed and spreads seeds over the whole palette", () => {
    expect(noteColorFor(ID)).toBe("spring");
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
    expect([first.icon, first.color]).toEqual(["lucide:sun", "spring"]);
    expect([second.icon, second.color]).toEqual(["lucide:book", "mint"]);
  });

  it("reads the declared colour in any case and falls back when it is not a cover colour", () => {
    expect(readNoteFacts(`---\nid: ${ID}\ncolor: Rose\n---\n`).color).toBe("rose");
    expect(readNoteFacts(`---\nid: ${ID}\ncolor: crimson\n---\n`).color).toBe("spring");
    expect(readNoteFacts(`---\nid: ${ID}\ncolor: violet\n---\n`).color).toBe("spring");
  });

  it("derives a missing colour from the id, then the title, so it stays put", () => {
    expect(readNoteFacts(`---\ntitle: Masking strategy\nid: ${ID}\n---\n`).color).toBe("spring");
    expect(readNoteFacts("---\ntitle: Masking strategy\n---\n").color).toBe("lilac");
    expect(readNoteFacts("---\ntitle: Masking strategy\n---\n\nOther body").color).toBe("lilac");
  });
});

describe("note identity", () => {
  function freshIds() {
    return vi.spyOn(crypto, "randomUUID").mockReturnValue(FRESH);
  }

  it("gives a new note a fresh id when none is passed", () => {
    const uuid = freshIds();
    expect(newNoteSource("Untitled")).toBe(
      `---\ntitle: Untitled\nicon: lucide:book\ncolor: mint\nkind: note\nid: ${FRESH}\n---\n\n`,
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
    expect(withNoteIdentity("", ID)).toBe(`---\nkind: note\nid: ${ID}\n---\n\n`);
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
