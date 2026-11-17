// @vitest-environment jsdom

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorState } from "@codemirror/state";
import { setEditorErrorReporter } from "@oleafly/editor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markdownFormatKeymap } from "./markdown-keymap";
import { modelEdit, modelLinkHref, modelState } from "./markdown-model";
import {
  type Act,
  acceptsOutsideEdit,
  FUZZ_CORPUS,
  SHAPE_CORPUS,
  TOOLBAR_ACTIONS,
  VisualDocument,
  codeStates,
  editedOutside,
  lineColumn,
  seeded,
  shareParsingDocument,
  touchedRegion,
  typedLocally,
  unitsOf,
} from "./tests/markdown-toolbar-corpus";

type Range = readonly [number, number];

interface Depth {
  reads: "every caret" | "line edges";
  actionsPerEdge: number;
  carets: number;
  ranges: number;
}

const DEFAULT_SHAPES: Depth = { reads: "every caret", actionsPerEdge: 6, carets: 2, ranges: 2 };
const DEFAULT_FUZZ: Depth = { reads: "every caret", actionsPerEdge: 1, carets: 1, ranges: 1 };
const TREE: Depth = { reads: "line edges", actionsPerEdge: 1, carets: 4, ranges: 2 };

const FUZZ: readonly (readonly [string, string])[] = FUZZ_CORPUS.map(([name, source]) => [`fuzz ${name}`, source] as const);

const reported: string[] = [];
let restoreParsing = () => {};

beforeAll(() => {
  setEditorErrorReporter((scope, error) => reported.push(`${scope}: ${String(error)}`));
  restoreParsing = shareParsingDocument();
});

afterAll(() => {
  setEditorErrorReporter(null);
  restoreParsing();
});

function clip(left: string, right: string): [string, string] {
  let start = 0;
  while (start < left.length && left[start] === right[start]) start += 1;
  let end = 0;
  while (end < left.length - start && end < right.length - start && left.at(-1 - end) === right.at(-1 - end)) end += 1;
  const show = (text: string) => JSON.stringify(text.slice(Math.max(0, start - 10), Math.min(text.length, text.length - end + 10)));
  return [show(left), show(right)];
}

function lineEdges(source: string): number[] {
  const carets = new Set<number>();
  let at = 0;
  for (const line of source.split("\n")) {
    carets.add(at).add(at + line.length);
    at += line.length + 1;
  }
  return [...carets].filter((caret) => caret <= source.length);
}

function lineRanges(source: string): Range[] {
  const ranges: Range[] = [];
  let at = 0;
  for (const line of source.split("\n")) {
    const end = at + line.length;
    if (line.trim()) ranges.push([at, end], [end, at]);
    if (line.trim().length > 2) ranges.push([at + 1, end - 1], [end - 1, at + 1]);
    at += line.length + 1;
  }
  return ranges;
}

function crossRanges(source: string): Range[] {
  const units = unitsOf(source);
  return units.slice(1).flatMap((unit, index) => {
    const from = Math.floor((units[index].from + units[index].to) / 2);
    const to = Math.floor((unit.from + unit.to) / 2);
    return [[from, to] as const, [to, from] as const];
  });
}

function randomFor(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return seeded(hash);
}

function sampled<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) picked.push(...pool.splice(Math.floor(random() * pool.length), 1));
  return picked;
}

class Sweep {
  private readonly failures: string[] = [];
  private readonly units: { from: number; to: number }[];
  private readonly stateAt: (anchor: number, head: number) => EditorState;
  private visual: VisualDocument | null = null;

  constructor(
    private readonly name: string,
    private readonly source: string,
  ) {
    this.units = unitsOf(source);
    this.stateAt = codeStates(source, markdownFormatKeymap);
  }

  private where(anchor: number, head: number): string {
    const caret = anchor === head ? `${anchor}` : `${anchor}-${head}`;
    return `${this.name} caret ${caret} (line ${lineColumn(this.source, anchor)})`;
  }

  private guarded<T>(where: string, run: () => T): T | null {
    const before = reported.length;
    try {
      return run();
    } catch (error) {
      this.failures.push(`${where}: threw ${String(error)}`);
      return null;
    } finally {
      if (reported.length > before) this.failures.push(`${where}: reported ${reported.slice(before).join(" | ")}`);
    }
  }

  read(at: number): void {
    const state = this.stateAt(at, at);
    this.guarded(`${this.where(at, at)} state`, () => [modelState(state), modelLinkHref(state)]);
  }

  act([anchor, head]: Range, actions: readonly (readonly [string, Act])[]): void {
    const state = this.stateAt(anchor, head);
    const region = touchedRegion(this.units, this.source, Math.min(anchor, head), Math.max(anchor, head));
    for (const [name, act] of actions) {
      const where = `${this.where(anchor, head)} ${name}`;
      const acted = this.guarded(where, () => {
        const spec = modelEdit(state, act);
        return spec ? state.update(spec).state : null;
      });
      if (!acted) continue;
      const after = acted.doc.toString();
      const outside = editedOutside(this.source, after, region);
      const visual = outside && this.visualOutput(anchor, head, act);
      if (outside && !acceptsOutsideEdit(this.source, after, visual)) {
        const [code, other] = visual === null ? [clip(this.source, after)[1], null] : clip(visual.acted, after).reverse();
        this.failures.push(
          `${where}: edited ${outside.from}-${outside.to} outside the selection's blocks ${region.from}-${region.to}: Code wrote ${code}${other === null ? " and Visual has no caret here" : ` where Visual wrote ${other}`}`,
        );
      }
      const { from, to } = acted.selection.main;
      const typed = this.guarded(`${where} then X`, () => acted.update({ changes: { from, to, insert: "X" }, selection: { anchor: from + 1 }, userEvent: "input.type" }).state.doc.toString());
      if (typed !== null && !typedLocally(after, typed, { from, to }, "X")) this.failures.push(`${where} then X: the key changed text outside the typed span ${from}-${to}: Code wrote ${clip(after, typed)[1]}`);
    }
  }

  private visualOutput(anchor: number, head: number, act: Act): { baseline: string; acted: string } | null {
    this.visual ??= new VisualDocument(this.source);
    const visualAnchor = this.visual.caretFor(anchor, this.units);
    const visualHead = anchor === head ? visualAnchor : this.visual.caretFor(head, this.units);
    if (visualAnchor === null || visualHead === null) return null;
    return { baseline: this.visual.baseline, acted: this.visual.run(visualAnchor, visualHead, act, null).acted };
  }

  done(): string[] {
    this.visual?.destroy();
    return this.failures.length > 40 ? [...this.failures.slice(0, 40), `and ${this.failures.length - 40} more`] : this.failures;
  }
}

function reads(name: string, source: string, depth: Depth): string[] {
  const run = new Sweep(name, source);
  const carets = depth.reads === "every caret" ? Array.from({ length: source.length + 1 }, (_, at) => at) : lineEdges(source);
  for (const at of carets) run.read(at);
  return run.done();
}

function acts(name: string, source: string, depth: Depth | "every action everywhere"): string[] {
  const run = new Sweep(name, source);
  const carets = Array.from({ length: source.length + 1 }, (_, at): Range => [at, at]);
  const ranges = [...lineRanges(source), ...crossRanges(source)];
  if (depth === "every action everywhere") {
    for (const range of [...carets, ...ranges]) run.act(range, TOOLBAR_ACTIONS);
    return run.done();
  }
  const random = randomFor(name);
  const offset = Math.floor(random() * TOOLBAR_ACTIONS.length);
  const rotated = (index: number) =>
    Array.from({ length: depth.actionsPerEdge }, (_, step) => TOOLBAR_ACTIONS[(offset + index * depth.actionsPerEdge + step) % TOOLBAR_ACTIONS.length]);
  for (const [index, caret] of lineEdges(source).entries()) run.act([caret, caret], rotated(index));
  for (const caret of sampled(carets, depth.carets, random)) run.act(caret, TOOLBAR_ACTIONS);
  for (const range of sampled(ranges, depth.ranges, random)) run.act(range, TOOLBAR_ACTIONS);
  return run.done();
}

const SHAPES: readonly [string, RegExp][] = [
  ["HTML table", /^<table>$/mu],
  ["list next to a paragraph", /\n\n- \S/u],
  ["image-only list item", /^- !\[/mu],
  ["callout", /^> \[!NOTE\]/mu],
  ["Quarto callout", /^::: \{\.callout-note\}$/mu],
  ["setext heading", /^\S.*\n(?:=+|-+)$/mu],
  ["aligned div", /^::: \{\.center\}$/mu],
  ["nested div", /^::: \{\.right\}\n.*\n\n::: \{\.center\}/mu],
  ["div in a list", /^- ::: \{\.center\}$/mu],
  ["footnote definition", /^\[\^\w+\]: /mu],
  ["inline math", /\$[^$\n]+\$/u],
  ["display math", /^\$\$$/mu],
  ["math in a reference label", /\[\$[^$]+\$\]:/u],
  ["front matter with a body", /^---\n[\s\S]*?\n---\n\n\S/u],
  ["front matter alone", /^---\ntitle: T\n---\n\n?$/u],
  ["fence in a list item", /^ {2}```$/mu],
  ["fence in a quote", /^> ```$/mu],
];

describe("the Markdown toolbar engine on the closing fence of a centred heading", () => {
  it("reads the heading's state at each caret of the fence without reporting an error", () => {
    const stateAt = codeStates("::: {.center}\n## Title here\n:::\n", markdownFormatKeymap);
    const before = reported.length;
    const states = [28, 29, 30, 31].map((at) => modelState(stateAt(at, at)));
    expect(reported.slice(before)).toEqual([]);
    for (const state of states) expect(state).toMatchObject({ align: "center", heading: 2 });
  });
});

describe("the Markdown toolbar engine across the corpus", () => {
  it.each(SHAPES)("has a %s in the corpus", (_shape, pattern) => {
    expect(SHAPE_CORPUS.some(([, source]) => pattern.test(source))).toBe(true);
  });

  // The sweep is string and editor-state logic, the same on every platform. It costs about eight
  // minutes of one worker on the Windows runner, whose test step was already near the job's limit,
  // so Linux and macOS run it.
  describe.skipIf(process.platform === "win32")("off Windows", () => {
    it.each(SHAPE_CORPUS)("reads the state and link at every caret of %s without throwing or reporting an error", (name, source) => {
      expect(reads(name, source, DEFAULT_SHAPES)).toEqual([]);
    }, 120_000);

    it.each(SHAPE_CORPUS)("acts at every line edge (six actions at each, in turn) and at seeded carets and ranges of %s without throwing, reporting or editing another block", (name, source) => {
      expect(acts(name, source, DEFAULT_SHAPES)).toEqual([]);
    }, 120_000);

    it.each(FUZZ)("reads the state at every caret of %s and acts at every line edge and a seeded caret and range without throwing, reporting or editing another block", (name, source) => {
      expect([...reads(name, source, DEFAULT_FUZZ), ...acts(name, source, DEFAULT_FUZZ)]).toEqual([]);
    }, 120_000);
  });
});

// Skipped unless OLEAFLY_MARKDOWN_SWEEP is set: every action at every caret and on every range of the corpus takes hours in jsdom.
describe.skipIf(!process.env.OLEAFLY_MARKDOWN_SWEEP)("the Markdown toolbar engine with every action at every caret of the corpus", () => {
  it.each([...SHAPE_CORPUS, ...FUZZ])("never throws, reports or edits another block in %s", (name, source) => {
    expect([...reads(name, source, { reads: "every caret", actionsPerEdge: 0, carets: 0, ranges: 0 }), ...acts(name, source, "every action everywhere")]).toEqual([]);
  }, 14_400_000);
});

const ROOT = join(__dirname, "../../..");

function trackedMarkdown(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "*.md", "*.qmd"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
}

// Skipped unless OLEAFLY_MARKDOWN_TREE_SWEEP is set: it reads and acts on all 3.8 MB of tracked Markdown in the repository, which takes an hour or more.
describe.skipIf(!process.env.OLEAFLY_MARKDOWN_TREE_SWEEP)("the Markdown toolbar engine on every tracked Markdown file", () => {
  it.each(process.env.OLEAFLY_MARKDOWN_TREE_SWEEP ? trackedMarkdown() : [])("never throws, reports or edits another block in %s", (path) => {
    const source = readFileSync(join(ROOT, path), "utf8");
    expect([...reads(path, source, TREE), ...acts(path, source, TREE)]).toEqual([]);
  }, 14_400_000);
});
