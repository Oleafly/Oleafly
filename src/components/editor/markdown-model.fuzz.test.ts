// @vitest-environment jsdom

import { writeFileSync } from "node:fs";
import { history, undo } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import { setEditorErrorReporter } from "@oleafly/editor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markdownFormatKeymap } from "./markdown-keymap";
import { modelEdit, modelState, sameToolbarState, visualStateOf } from "./markdown-model";
import {
  type Act,
  FUZZ_CORPUS,
  TOOLBAR_ACTIONS,
  VisualDocument,
  codeStates,
  editedOutside,
  seeded,
  shareParsingDocument,
  touchedRegion,
  typedClass,
  typedLocally,
  unitsOf,
} from "./tests/markdown-toolbar-corpus";

const TYPED = "X";
const WORD = /z[a-y]{2}q/gu;

interface Pick {
  kind: string;
  anchor: number;
  head: number;
  visual: readonly [number, number] | null;
}

type Counts = Record<string, number>;

interface Mismatch {
  doc: string;
  kind: string;
  action: string;
  selection: readonly [number, number];
  classes: string[];
  code: string;
  visual: string | null;
  codeTyped: string | null;
  visualTyped: string | null;
  errors: string[];
}

const summary = {
  docs: [] as string[],
  runs: 0,
  classes: {} as Counts,
  byKind: {} as Record<string, Counts>,
  byAction: {} as Record<string, Counts>,
  mismatches: [] as Mismatch[],
};

const reported: string[] = [];
let restoreParsing = () => {};

function bump(counts: Counts, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function selectedDocs(): (readonly [number, string, string])[] {
  const all = FUZZ_CORPUS.map(([name, source], index) => [index, name, source] as const);
  const wanted = process.env.OLEAFLY_MARKDOWN_FUZZ_DOCS;
  if (!wanted) return all;
  const indices = new Set<number>();
  for (const part of wanted.split(",")) {
    const [first, last = first] = part.split("-").map(Number);
    for (let index = first; index <= last; index += 1) indices.add(index);
  }
  return all.filter(([index]) => indices.has(index));
}

function picksFor(name: string, source: string, visual: VisualDocument): Pick[] {
  let hash = 0;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  const random = seeded(hash);
  const units = unitsOf(source);
  const any = <T>(items: readonly T[]): T | undefined => items[Math.floor(random() * items.length)];
  const words = [...source.matchAll(WORD)].flatMap((match) => {
    const word = match[0];
    const from = match.index ?? 0;
    const positions = visual.wordPositions(word);
    if (source.indexOf(word) !== from || source.indexOf(word, from + 1) >= 0 || positions.length !== 1) return [];
    return [{ word, from, to: from + word.length, at: positions[0], end: positions[0] + word.length }];
  });
  const picks: Pick[] = [];
  const add = (kind: string, anchor: number, head: number, visualAnchor: number | null, visualHead: number | null) => {
    picks.push({ kind, anchor, head, visual: visualAnchor === null || visualHead === null ? null : [visualAnchor, visualHead] });
  };
  for (const word of [any(words), any(words), any(words)]) if (word) add("word", word.from, word.to, word.at, word.end);
  const back = any(words);
  if (back) add("backward", back.to, back.from, back.end, back.at);
  const start = any(words);
  if (start) add("caret-start", start.from, start.from, start.at, start.at);
  const middle = any(words);
  if (middle) add("caret-mid", middle.from + 2, middle.from + 2, middle.at + 2, middle.at + 2);
  const end = any(words);
  if (end) add("caret-end", end.to, end.to, end.end, end.end);
  const spaced = any(words.filter((word) => source[word.to] === " " && visual.docText(word.end, word.end + 1) === " "));
  if (spaced) add("edge-space", spaced.from, spaced.to + 1, spaced.at, spaced.end + 1);
  const led = any(words.filter((word) => source[word.from - 1] === " " && visual.docText(word.at - 1, word.at) === " "));
  if (led) add("lead-space", led.from - 1, led.to, led.at - 1, led.end);
  const unitOf = (offset: number) => units.findIndex((unit) => unit.from <= offset && offset <= unit.to);
  const pairs = words.flatMap((first) => words.filter((second) => unitOf(second.from) === unitOf(first.from) + 1).map((second) => [first, second] as const));
  const cross = any(pairs);
  if (cross) add("cross", cross[0].from + 2, cross[1].from + 2, cross[0].at + 2, cross[1].at + 2);
  const crossBack = any(pairs);
  if (crossBack) add("cross-back", crossBack[1].from + 2, crossBack[0].from + 2, crossBack[1].at + 2, crossBack[0].at + 2);
  const marked = any(words.filter((word) => (visual.editor.state.doc.nodeAt(word.at)?.marks.length ?? 0) > 0));
  if (marked) add("mark-edge", marked.from, marked.from + 2, marked.at, marked.at + 2);
  const docEnd = source.trimEnd().length;
  add("doc-end", docEnd, docEnd, visual.caretFor(docEnd, units), visual.caretFor(docEnd, units));
  const lines: { from: number; text: string }[] = [];
  let at = 0;
  for (const text of source.split("\n")) {
    lines.push({ from: at, text });
    at += text.length + 1;
  }
  const lineStart = any(lines.filter((line) => /^(?:[-*>#|:]|\d+\.)/u.test(line.text)));
  if (lineStart) add("nt:line-start", lineStart.from, lineStart.from, visual.caretFor(lineStart.from, units), visual.caretFor(lineStart.from, units));
  const markupEnd = any(lines.filter((line) => /(?:```|:::|---|\*\*\*|===|\||\]: \S+)$/u.test(line.text)));
  if (markupEnd) {
    const caret = markupEnd.from + markupEnd.text.length;
    add("nt:markup-line-end", caret, caret, visual.caretFor(caret, units), visual.caretFor(caret, units));
  }
  const blank = any(lines.filter((line) => line.text.trim() === "" && line.from > 0 && line.from < source.length));
  if (blank) add("nt:blank-line", blank.from, blank.from, visual.caretFor(blank.from, units), visual.caretFor(blank.from, units));
  const tokens = [...source.matchAll(/https?:\/\/\S{6}|\{\.[a-z]|<\/?[a-z]{2}|\[\^/gu)].map((match) => (match.index ?? 0) + 3);
  const inToken = any(tokens);
  if (inToken !== undefined) add("nt:in-source-token", inToken, inToken, visual.caretFor(inToken, units), visual.caretFor(inToken, units));
  return picks;
}

function typedAfter(state: EditorState): EditorState {
  const { from, to } = state.selection.main;
  return state.update({ changes: { from, to, insert: TYPED }, selection: { anchor: from + TYPED.length }, userEvent: "input.type" }).state;
}

function undone(state: EditorState): string {
  let result = state;
  undo({
    state,
    dispatch: (tr) => {
      result = tr.state;
    },
  });
  return result.doc.toString();
}

function attempt<T>(errors: string[], label: string, run: () => T): T | null {
  const before = reported.length;
  try {
    return run();
  } catch (error) {
    errors.push(`${label} threw ${String(error)}`);
    return null;
  } finally {
    if (reported.length > before) errors.push(`${label} reported ${reported.slice(before).join(" | ")}`);
  }
}

function record(name: string, pick: Pick, action: string, classes: string[], detail: Omit<Mismatch, "doc" | "kind" | "action" | "selection" | "classes">): void {
  summary.runs += 1;
  summary.byKind[pick.kind] ??= {};
  summary.byAction[action] ??= {};
  const byKind = summary.byKind[pick.kind];
  const byAction = summary.byAction[action];
  bump(byKind, "runs");
  bump(byAction, "runs");
  for (const each of classes) {
    bump(summary.classes, each);
    bump(byKind, each);
    bump(byAction, each);
  }
  const notable = classes.some((each) => /^(?:text:(?!equal)|typed:(?!equal|same-reading)|throws|reported|outside:|undo:|visual:threw)/u.test(each));
  if (notable && summary.mismatches.length < 2000) summary.mismatches.push({ doc: name, kind: pick.kind, action, selection: [pick.anchor, pick.head], classes, ...detail });
}

function runPick(name: string, source: string, visual: VisualDocument, pick: Pick, units: { from: number; to: number }[], stateAt: (anchor: number, head: number) => EditorState): void {
  const region = touchedRegion(units, source, Math.min(pick.anchor, pick.head), Math.max(pick.anchor, pick.head));
  const start = stateAt(pick.anchor, pick.head);
  if (pick.visual && pick.anchor === pick.head) {
    visual.run(pick.visual[0], pick.visual[1], null, null);
    const same = sameToolbarState(modelState(start), visualStateOf(visual.editor));
    bump(summary.classes, same ? "state:equal" : "state:differ");
    if (!same) summary.mismatches.push({ doc: name, kind: pick.kind, action: "state", selection: [pick.anchor, pick.head], classes: ["state:differ"], code: JSON.stringify(modelState(start)), visual: JSON.stringify(visualStateOf(visual.editor)), codeTyped: null, visualTyped: null, errors: [] });
  }
  for (const [action, act] of TOOLBAR_ACTIONS) runAction(name, source, visual, pick, region, start, action, act);
}

function runAction(name: string, source: string, visual: VisualDocument, pick: Pick, region: { from: number; to: number }, start: EditorState, action: string, act: Act): void {
  const errors: string[] = [];
  const classes: string[] = [];
  const acted = attempt(errors, "action", () => {
    const spec = modelEdit(start, act);
    return spec ? start.update(spec).state : start;
  });
  const code = acted?.doc.toString() ?? source;
  const typedState = acted && attempt(errors, "typed key", () => typedAfter(acted));
  const codeTyped = typedState?.doc.toString() ?? null;
  if (acted && code !== source && undone(acted) !== source) classes.push("undo:action");
  if (acted && typedState && codeTyped !== code && undone(typedState) !== code) classes.push("undo:typed");
  if (errors.some((error) => error.includes(" threw "))) classes.push("throws");
  if (errors.some((error) => error.includes(" reported "))) classes.push("reported");
  const codeOutside = editedOutside(source, code, region) !== null;
  const selection = acted?.selection.main ?? start.selection.main;
  if (codeTyped !== null && !typedLocally(code, codeTyped, selection, TYPED)) classes.push("outside:typed-code");
  if (!pick.visual) {
    classes.push("visual:unmapped", code === source ? "code:noop" : "code:acted");
    if (codeOutside) classes.push("outside:code-only");
    record(name, pick, action, classes, { code, visual: null, codeTyped, visualTyped: null, errors });
    return;
  }
  const run = attempt(errors, "visual", () => visual.run(pick.visual?.[0] ?? 0, pick.visual?.[1] ?? 0, act, TYPED));
  if (!run) {
    classes.push("visual:threw");
    record(name, pick, action, classes, { code, visual: null, codeTyped, visualTyped: null, errors });
    return;
  }
  const visualOutside = editedOutside(source, run.acted, region) !== null;
  if (codeOutside && !visualOutside) classes.push("outside:code-only");
  else if (codeOutside) classes.push("outside:both");
  if (code === run.acted) classes.push("text:equal");
  else if (code === source) classes.push("text:code-noop");
  else if (run.acted === source) classes.push("text:visual-noop");
  else classes.push(run.faithful ? "text:differ" : "text:differ-visual-lossy");
  if (codeTyped === null || run.typed === null) classes.push("typed:missing");
  else classes.push(typedClass({ code, visual: run.acted }, { code: codeTyped, visual: run.typed }, selection, run.typedFaithful, TYPED));
  if (visual.baseline !== source) classes.push("visual:baseline-differs");
  record(name, pick, action, classes, { code, visual: run.acted, codeTyped, visualTyped: run.typed, errors });
}

function ratio(equal: string, ...others: string[]): string {
  const hit = summary.classes[equal] ?? 0;
  const total = [equal, ...others].reduce((sum, key) => sum + (summary.classes[key] ?? 0), 0);
  return `${hit}/${total} (${total ? ((100 * hit) / total).toFixed(1) : "0.0"}%)`;
}

beforeAll(() => {
  setEditorErrorReporter((scope, error) => reported.push(`${scope}: ${String(error)}`));
  restoreParsing = shareParsingDocument();
});

afterAll(() => {
  setEditorErrorReporter(null);
  restoreParsing();
  const out = process.env.OLEAFLY_MARKDOWN_FUZZ_OUT;
  if (!out || summary.docs.length === 0) return;
  const parity = {
    actionText: ratio("text:equal", "text:code-noop", "text:visual-noop", "text:differ", "text:differ-visual-lossy"),
    actionTextWhereVisualIsFaithful: ratio("text:equal", "text:code-noop", "text:visual-noop", "text:differ"),
    typedText: ratio("typed:equal", "typed:same-reading", "typed:differ", "typed:differ-visual-lossy", "typed:code-rewrites", "typed:after-differing-action"),
    typedTextWhereVisualIsFaithful: ratio("typed:equal", "typed:same-reading", "typed:differ", "typed:code-rewrites"),
    state: ratio("state:equal", "state:differ"),
  };
  writeFileSync(out, `${JSON.stringify({ ...summary, parity }, null, 1)}\n`);
});

// Skipped unless OLEAFLY_MARKDOWN_FUZZ is set: 40 documents × every action × Code and Visual take far longer than a gate allows.
describe.skipIf(!process.env.OLEAFLY_MARKDOWN_FUZZ)("the Markdown toolbar engine against Visual on the seeded fuzz corpus", () => {
  it.each(process.env.OLEAFLY_MARKDOWN_FUZZ ? selectedDocs() : [])("matches Visual without throwing, reporting or editing another block in doc %i (%s)", (_index, name, source) => {
    const visual = new VisualDocument(source);
    const units = unitsOf(source);
    const stateAt = codeStates(source, [history(), markdownFormatKeymap]);
    const before = { ...summary.classes };
    summary.docs.push(name);
    try {
      for (const pick of picksFor(name, source, visual)) runPick(name, source, visual, pick, units, stateAt);
    } finally {
      visual.destroy();
    }
    const added = (key: string) => (summary.classes[key] ?? 0) - (before[key] ?? 0);
    expect({ throws: added("throws"), reported: added("reported"), codeOnlyOutside: added("outside:code-only"), typedOutside: added("outside:typed-code") }).toEqual({
      throws: 0,
      reported: 0,
      codeOnlyOutside: 0,
      typedOutside: 0,
    });
  }, 1_800_000);
});
