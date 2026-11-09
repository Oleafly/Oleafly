// @vitest-environment jsdom
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseSharedNote, type SharedNote } from "./note-live-doc";
import { noteMarkdownExtensions } from "./note-markdown";

const schema = getSchema(noteMarkdownExtensions());

const NOTE = `---
title: Lab
kind: note
tags: [a, b]
---

# Lab notes

First paragraph with *emphasis*, $x^2$ and a [link](oleafly://note/abc).
Second line of the same paragraph.

- item one
- [ ] task two
  - nested **bold**

> [!note] Callout title
> Callout body with ==highlight==.

\`\`\`python
def f(x):

    return x
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

Setext heading
--------------

1. first
2. second

---

$$
y = mx + b
$$

Footnote ref[^1] and more.

Last paragraph.
`;

const PIECES = [
  "\n\n",
  "\n",
  "x",
  " word ",
  "```",
  "```\n",
  "$",
  "$$",
  "- ",
  "> ",
  "# ",
  "---",
  "===",
  "| c | d |",
  "    ",
  "<div>",
  "*",
  "**",
  "==",
  "[[",
  "1. ",
  "[ref]: https://example.com\n",
  "<!-- hidden -->",
  "\\",
  "[^2]",
];

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function edit(text: string, random: () => number): string {
  const at = Math.floor(random() * (text.length + 1));
  if (random() < 0.35 && text.length > 0) {
    const length = 1 + Math.floor(random() * 12);
    return text.slice(0, at) + text.slice(Math.min(text.length, at + length));
  }
  const piece = PIECES[Math.floor(random() * PIECES.length)];
  return text.slice(0, at) + piece + text.slice(at);
}

function shape(note: SharedNote) {
  return {
    text: note.text,
    doc: note.doc.toJSON(),
    frontmatter: note.frontmatter,
    layout: note.layout,
    sources: note.sources,
    starts: note.starts,
  };
}

describe("parseSharedNote with a previous parse", () => {
  it("matches a full parse after every random edit", () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const random = seeded(seed);
      let text = NOTE;
      let previous = parseSharedNote(schema, text);
      for (let step = 0; step < 20; step += 1) {
        text = edit(text, random);
        const incremental = parseSharedNote(schema, text, previous);
        expect(shape(incremental), `seed ${seed} step ${step}`).toEqual(shape(parseSharedNote(schema, text)));
        previous = incremental;
      }
    }
  }, 240_000);

  it("reuses the blocks it did not reparse", () => {
    const previous = parseSharedNote(schema, NOTE);
    const next = parseSharedNote(schema, NOTE.replace("Last paragraph.", "Last paragraph, edited."), previous);
    expect(next.doc.child(0)).toBe(previous.doc.child(0));
    expect(next.doc.child(2)).toBe(previous.doc.child(2));
    expect(parseSharedNote(schema, NOTE, previous)).toBe(previous);
  });

  it("parses everything again when the edit reaches the front matter or the layout is unknown", () => {
    const previous = parseSharedNote(schema, NOTE);
    const retitled = parseSharedNote(schema, NOTE.replace("title: Lab", "title: Lab two"), previous);
    expect(retitled.frontmatter).toContain("Lab two");
    expect(retitled.doc.child(0)).not.toBe(previous.doc.child(0));
    const empty = parseSharedNote(schema, "");
    expect(parseSharedNote(schema, "Now text.", empty).doc.toJSON()).toEqual(parseSharedNote(schema, "Now text.").doc.toJSON());
  });

  const LINKED = `# Sources

Opening paragraph with a note[^1] and a [ref] link.

<!-- reviewer: check the numbers -->

Middle paragraph about results.

Another paragraph near the end.

[^1]: The footnote text.
`;

  it("reparses only the edited blocks of a note with a footnote and a comment", () => {
    const previous = parseSharedNote(schema, LINKED);
    const text = LINKED.replace("about results.", "about the results.");
    const next = parseSharedNote(schema, text, previous);
    expect(next.doc.child(0)).toBe(previous.doc.child(0));
    expect(next.doc.child(1)).toBe(previous.doc.child(1));
    expect(next.doc.child(next.doc.childCount - 1)).toBe(previous.doc.child(previous.doc.childCount - 1));
    expect(shape(next)).toEqual(shape(parseSharedNote(schema, text)));
  });

  it("parses everything again in a note that defines a link label, even inside a list", () => {
    for (const definition of ["[ref]: https://example.com\n", "- [ref]: https://example.com\n", "> [ref]: https://example.com\n"]) {
      const defined = `${LINKED}\n${definition}`;
      const previous = parseSharedNote(schema, defined);
      const text = defined.replace("about results.", "about [REF] results.");
      const next = parseSharedNote(schema, text, previous);
      expect(next.doc.child(0), definition).not.toBe(previous.doc.child(0));
      expect(shape(next)).toEqual(shape(parseSharedNote(schema, text)));
    }
  });

  it("parses everything again when an edit leaves a comment open", () => {
    const previous = parseSharedNote(schema, LINKED);
    const text = LINKED.replace("about results.", "about results. <!-- open");
    const next = parseSharedNote(schema, text, previous);
    expect(next.doc.child(0)).not.toBe(previous.doc.child(0));
    expect(shape(next)).toEqual(shape(parseSharedNote(schema, text)));
  });

  it("matches a full parse after random edits around footnotes, comments and link definitions", () => {
    const pieces = ["<!--", "-->", "<!-- note -->", "\n<!--\n", "[^1]: more\n", "[ref]", "[x][ref]", "- [ref]: /other\n", "\n\n", "x", "[^2]", "`"];
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = seeded(seed);
      let text = LINKED;
      let previous = parseSharedNote(schema, text);
      for (let step = 0; step < 15; step += 1) {
        const at = Math.floor(random() * (text.length + 1));
        text =
          random() < 0.3
            ? text.slice(0, at) + text.slice(Math.min(text.length, at + 1 + Math.floor(random() * 8)))
            : text.slice(0, at) + pieces[Math.floor(random() * pieces.length)] + text.slice(at);
        const incremental = parseSharedNote(schema, text, previous);
        expect(shape(incremental), `seed ${seed} step ${step}`).toEqual(shape(parseSharedNote(schema, text)));
        previous = incremental;
      }
    }
  }, 240_000);
});
