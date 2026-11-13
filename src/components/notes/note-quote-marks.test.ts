// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { destroyKbEditors, kbNote, placeCursor, typeInto } from "./tests/kb-editor-fixtures";

afterEach(destroyKbEditors);

function edited(source: string, needle: string, typed: string): string {
  const { editor, save } = kbNote(source);
  placeCursor(editor, needle, needle.length);
  typeInto(editor, typed);
  return save();
}

const MARKS = ["**", "*", "~~", "=="];

const LATER_LINES = MARKS.flatMap((mark) => [
  ["a second quote paragraph", `> quote\n>\n> ${mark}b${mark} c`],
  ["a line after a hard break", `> a\\\n> ${mark}b${mark} c`],
  ["a callout body", `> [!note]\n> ${mark}b${mark} c`],
  ["a nested quote", `> > a\n> >\n> > ${mark}b${mark} c`],
  ["a list inside a quote", `> - a\n>\n>   ${mark}b${mark} c`],
]);

const BREAK_CONTAINERS = [
  ["the top level", "", ""],
  ["a quote", "> ", "> "],
  ["a callout", "> [!note]\n> ", "> "],
  ["a list item", "- ", "  "],
  ["a nested quote", "> > ", "> > "],
  ["a list inside a quote", "> - ", ">   "],
] as const;

const BREAK_MARKS = [...MARKS.map((mark) => [mark, mark]), ["***", "***"], ["**~~", "~~**"]];

const CLOSED_AFTER_BREAK = BREAK_MARKS.flatMap(([open, close]) =>
  BREAK_CONTAINERS.map(([where, first, next]) => [
    where,
    open,
    `${first}Intro ${open}bold\\\n${next}[link](https://x.y) text${close} end`,
    `${first}Intro ${open}bold${close}\\\n${next}[${open}link${close}](https://x.y) ${open}text${close} end!`,
  ]),
);

describe("saving a mark that closes right after a hard break", () => {
  it.each(CLOSED_AFTER_BREAK)("keeps %s and its %s marks well formed", (_where, _marks, source, saved) => {
    const output = edited(source, " end", "!");
    expect(output).toBe(saved);
    expect(edited(output, " end!", "?")).toBe(`${saved}?`);
  });
});

describe("saving a quote whose later line starts with a mark", () => {
  it.each(LATER_LINES)("keeps the prefix of %s in %j after an edit on that line", (_where, source) => {
    expect(edited(source, " c", "!")).toBe(`${source}!`);
  });

  it.each(MARKS)("keeps the second paragraph starting with %s when only the first is edited", (mark) => {
    expect(edited(`> quote\n>\n> ${mark}b${mark} c`, "quote", "!")).toBe(`> quote!\n>\n> ${mark}b${mark} c`);
  });
});
