// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { destroyKbEditors, kbNote, placeCursor, typeInto } from "./tests/kb-editor-fixtures";
import "./tests/setup";

const files = import.meta.glob<string>("./tests/corpus/*.md", { query: "?raw", import: "default", eager: true });

const VARIANTS: Record<string, (text: string) => string> = {
  "crlf.md": (text) => text.replace(/\n/gu, "\r\n"),
  "bom.md": (text) => `﻿${text}`,
};

const corpus = Object.entries(files).map(([path, raw]) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const text = raw.replace(/\r\n/gu, "\n");
  return { name, source: VARIANTS[name]?.(text) ?? text };
});

const EDITED_WORD: Record<string, string> = {
  "bom.md": "Saved",
  "crlf.md": "Agreed",
  "diagram-blocks.md": "Measured",
  "front-matter.md": "closely",
  "lab-notebook.md": "baseline",
  "mixed-html.md": "Between",
  "pandoc-note.md": "nonlinearly",
  "quotes-and-lists.md": "Final",
  "setext-refs.md": "Star",
  "tasks-and-fields.md": "ablation",
  "vault-export.md": "Calibrated",
};

const UNTOUCHED_BY_EDIT = new Set(["bom.md", "crlf.md", "diagram-blocks.md", "front-matter.md", "mixed-html.md", "quotes-and-lists.md", "tasks-and-fields.md", "vault-export.md"]);

afterEach(destroyKbEditors);

function blockAround(source: string, at: number): { start: number; end: number } {
  const blank = /\r?\n[ \t]*\r?\n/gu;
  let start = 0;
  let end = source.length;
  for (const match of source.matchAll(blank)) {
    const index = match.index ?? 0;
    if (index + match[0].length <= at) start = index + match[0].length;
    else if (index >= at) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function edited(source: string, needle: string, typed: string): string {
  const { editor, save } = kbNote(source);
  placeCursor(editor, needle, needle.length);
  typeInto(editor, typed);
  return save();
}

describe("a corpus of real-shaped notes", () => {
  it("covers every corpus file", () => {
    expect(corpus.map((file) => file.name).sort()).toEqual(Object.keys(EDITED_WORD).sort());
  });

  it.each(corpus)("writes $name back byte for byte", ({ source }) => {
    expect(kbNote(source).save()).toBe(source);
  });

  it.each(corpus)("changes only the edited block of $name", ({ name, source }) => {
    const needle = EDITED_WORD[name];
    const at = source.indexOf(needle);
    const { start, end } = blockAround(source, at);
    const saved = edited(source, needle, "X");
    const tail = source.slice(end);
    expect(saved.slice(0, start)).toBe(source.slice(0, start));
    expect(saved.endsWith(tail)).toBe(true);
    expect(saved.slice(start, saved.length - tail.length)).toContain(`${needle}X`);
  });

  it.each(corpus.filter(({ name }) => UNTOUCHED_BY_EDIT.has(name)))("changes only the edited word of $name", ({ name, source }) => {
    const needle = EDITED_WORD[name];
    expect(edited(source, needle, "X")).toBe(source.replace(needle, `${needle}X`));
  });
});

describe("what editing a block still rewrites", () => {
  it.each([
    ["a soft line break becomes a space", "one\ntwo", "two", "one two!"],
    ["a definition list joins its lines", "Term\n:   Meaning", "Meaning", "Term : Meaning!"],
    ["a two-space hard break becomes a backslash", "one  \ntwo", "two", "one\\\ntwo!"],
    ["underscores become asterisks", "_em_ and __strong__", "strong", "*em* and **strong!**"],
    ["star and plus bullets become dashes", "* a\n* b", "b", "- a\n- b!"],
    ["ordered lists are renumbered from the start", "1. a\n1. b", "b", "1. a\n2. b!"],
    ["a paren list marker becomes a dot", "1) a\n2) b", "b", "1. a\n2. b!"],
    ["a setext heading becomes ATX", "Title\n=====", "Title", "# Title!"],
    ["a reference link becomes inline", "[guide][g]\n\n[g]: https://example.org", "guide", "[guide!](https://example.org)\n\n[g]: https://example.org"],
    ["a tilde fence becomes backticks", "~~~js\nx\n~~~", "x", "```js\nx!\n```"],
    ["indented code becomes a fence", "    x", "x", "```\nx!\n```"],
    ["a capital task box becomes lower case", "- [X] done", "done", "- [x] done!"],
    ["a box in an ordered list is escaped", "1. [ ] box", "box", "1. \\[ \\] box!"],
    ["a bare < before a letter becomes &lt;", "a <b and c", "c", "a &lt;b and c!"],
    ["an escaped dollar loses its backslash", "costs \\$5", "costs", "costs! $5"],
    ["the edited table row is padded", "|a|b|\n|-|-|\n|1|2|", "2", "|a|b|\n|-|-|\n| 1 | 2! |"],
    ["text that looks like markup is escaped", "a*b and [x]", "and", "a\\*b and! \\[x\\]"],
  ])("%s", (_name, source, needle, saved) => {
    expect(edited(source, needle, "!")).toBe(saved);
  });
});
