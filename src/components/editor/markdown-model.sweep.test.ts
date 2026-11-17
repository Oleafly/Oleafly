// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { EditorState } from "@codemirror/state";
import { setEditorErrorReporter } from "@oleafly/editor";
import { markdownUnits } from "@oleafly/wysiwyg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MarkdownTarget, modelEdit, modelLinkHref, modelState } from "./markdown-model";

const CORPUS: [string, string][] = [
  ["readme", "# Tool\n\nInstall it with the [installer][inst] and read the [guide][g].\n\n## Use\n\nRun it.\n\n[inst]: https://i.example\n[g]: https://g.example\n"],
  ["definitions", "[a]: https://first.example\n\nSee [x][a] word.\n\n[^n1]: A note.\n\n[r3]: https://first.example/v\n[r3]: https://ex.com/w\n[r2]: https://ex.com/z\n"],
  ["centred", "Intro para.\n\n::: {.center}\n## Title here\n:::\n\n::: right\nRight text.\n:::\n\nAfter para.\n"],
  ["fences", "Text.\n\n```js\nconst a = 1;\n```\n\n~~~\nraw\n~~~\n\n    indented code\n\nEnd.\n"],
  ["rules", "Intro.\n\n---\n\nBetween rules.\n\n---\n\nTitle\n-----\n\nBody word.\n\n***\n\nLast.\n"],
  ["lists", "- one\n- two **b**\n  - nested\n\n1. first\n2. second\n\n- [ ] task word\n- [x] done\n\n* star\n* star two\n"],
  ["quotes", "> quoted line\n> - item in quote\n\n> [!NOTE]\n> callout body\n"],
  ["table", "| a | b |\n|---|---|\n| c | d^e^ |\n\nAfter.\n"],
  ["html", "Above.\n\n<!-- a long html comment here -->\n\n<div align=\"center\">\nCentred html\n</div>\n\nBelow <u>u</u> <mark>m</mark> x<sup>2</sup>.\n"],
  ["math", "Inline $x^2$ and $$y$$ here.\n\n$$\nx + y = z\n$$\n\nAfter math.\n"],
  ["links", "See [inline](https://a.b/c) and <https://zqz.example> and ![alt](fig/a.png) end.\n\nText.^[An inline note] more.\n"],
  ["front matter", "---\ntitle: T\nauthor: Me\n---\n\n# Heading\n\nBody word.\n"],
  ["front matter only", "---\ntitle: T\n---\n\n"],
  ["mixed", "🎉 Party 中文 é\ttab  \nnext line.\n\nPandoc [u]{.underline} and [m]{.mark} with x^2^ and H~2~O.\n"],
];

const ACTIONS: [string, (target: MarkdownTarget) => void][] = [
  ["H2", (target) => target.heading(2)],
  ["Bold", (target) => target.bold()],
  ["Table", (target) => target.table()],
];

const MORE_ACTIONS: [string, (target: MarkdownTarget) => void][] = [
  ["Bullet", (target) => target.bullet()],
  ["Quote", (target) => target.quote()],
  ["Center", (target) => target.align("center")],
  ["Link", (target) => target.link("https://c.d")],
  ["Emoji", (target) => target.emoji("🎉")],
];

const reported: unknown[] = [];

beforeAll(() => {
  setEditorErrorReporter((_scope, error) => reported.push(error));
});

afterAll(() => {
  setEditorErrorReporter((scope, error) => console.error(scope, error));
});

function ownBlock(source: string, at: number): { from: number; to: number } {
  const { spans } = markdownUnits(source);
  const own = spans.find((span) => span.from <= at && at <= span.to);
  if (own) return own;
  const before = spans.filter((span) => span.to <= at).at(-1);
  return before ?? spans.find((span) => span.from >= at) ?? { from: 0, to: source.length };
}

function changed(before: string, after: string): { from: number; to: number } | null {
  if (before === after) return null;
  let from = 0;
  while (from < before.length && before[from] === after[from]) from += 1;
  let tail = 0;
  while (tail < before.length - from && before.at(-1 - tail) === after.at(-1 - tail)) tail += 1;
  return { from, to: before.length - tail };
}

function failuresAt(source: string, anchor: number, head: number, actions: readonly [string, (target: MarkdownTarget) => void][]): string[] {
  const failures: string[] = [];
  const state = EditorState.create({ doc: source, selection: { anchor, head } });
  const before = reported.length;
  try {
    modelState(state);
    modelLinkHref(state);
    for (const [name, act] of actions) {
      const spec = modelEdit(state, act);
      if (!spec || anchor !== head || name === "Table") continue;
      const after = state.update(spec).state.doc.toString();
      const span = changed(source, after);
      const block = ownBlock(source, anchor);
      if (span && (span.from < block.from || span.to > block.to + 2)) failures.push(`${name} at ${anchor} edited ${span.from}-${span.to} outside ${block.from}-${block.to}`);
    }
  } catch (error) {
    failures.push(`throw at ${anchor}-${head}: ${String(error)}`);
  }
  if (reported.length > before) failures.push(`reported at ${anchor}-${head}: ${String(reported.at(-1))}`);
  return failures;
}

function lineRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  let at = 0;
  for (const line of source.split("\n")) {
    if (line.trim()) ranges.push([at, at + line.length]);
    at += line.length + 1;
  }
  return ranges.concat(ranges.slice(1).map(([, end], index) => [ranges[index][0] + 1, end - 1]));
}

function lineEdges(source: string): number[] {
  const carets: number[] = [];
  let at = 0;
  for (const line of source.split("\n")) {
    carets.push(at, at + line.length);
    at += line.length + 1;
  }
  return carets;
}

const LINE_EDGE_ACTIONS: [string, (target: MarkdownTarget) => void][] = [ACTIONS[0], ACTIONS[1], MORE_ACTIONS[2], ACTIONS[2]];

function sweep(source: string, depth: "state" | "edges" | "full"): string[] {
  const failures: string[] = [];
  for (let at = 0; at <= source.length; at += 1) failures.push(...failuresAt(source, at, at, depth === "full" ? [...ACTIONS, ...MORE_ACTIONS] : []));
  if (depth === "state") return failures;
  if (depth === "edges") for (const at of lineEdges(source)) failures.push(...failuresAt(source, at, at, LINE_EDGE_ACTIONS));
  for (const [anchor, head] of lineRanges(source)) failures.push(...failuresAt(source, anchor, head, depth === "full" ? ACTIONS : ACTIONS.slice(1, 2)));
  return failures;
}

const CRASHED_BEFORE = new Set(["readme", "definitions", "centred", "front matter only"]);

describe("the Markdown toolbar engine at every caret", () => {
  it.each(CORPUS)("reads the state at every caret without throwing in %s", (_name, source) => {
    expect(sweep(source, "state")).toEqual([]);
  }, 120_000);

  it.each(CORPUS.filter(([name]) => CRASHED_BEFORE.has(name)))("acts at every line start and end, and on every line, without throwing or editing another block, in %s", (_name, source) => {
    expect(sweep(source, "edges")).toEqual([]);
  }, 120_000);
});

// Skipped unless OLEAFLY_MARKDOWN_SWEEP is set: every action at every caret of the whole corpus takes many minutes.
describe.skipIf(!process.env.OLEAFLY_MARKDOWN_SWEEP)("the Markdown toolbar engine with every action at every caret", () => {
  it.each(CORPUS)("never throws or edits another block in %s", (_name, source) => {
    expect(sweep(source, "full")).toEqual([]);
  }, 3_600_000);
});

function markdownFiles(folder: string, found: string[] = []): string[] {
  for (const name of readdirSync(folder)) {
    if (["node_modules", ".git", "target", "dist", ".claude", "coverage"].includes(name)) continue;
    const path = join(folder, name);
    if (statSync(path).isDirectory()) markdownFiles(path, found);
    else if (/\.(?:md|qmd)$/u.test(name)) found.push(path);
  }
  return found;
}

// Skipped unless OLEAFLY_MARKDOWN_SWEEP is set: it reads every caret of every Markdown file in the repository, which takes hours.
describe.skipIf(!process.env.OLEAFLY_MARKDOWN_SWEEP)("the Markdown toolbar engine at every caret of every Markdown file in the repository", () => {
  const root = join(__dirname, "../../..");
  it.each(markdownFiles(root).map((path) => [relative(root, path), path]))(
    "never throws in %s",
    (_name, path) => {
      const source = readFileSync(path, "utf8");
      expect(sweep(source, source.length < 4000 ? "full" : "edges")).toEqual([]);
    },
    3_600_000,
  );
});
