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
});
