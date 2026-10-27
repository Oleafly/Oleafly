// @vitest-environment jsdom

import { history, redo, undo } from "@codemirror/commands";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Parser, SyntaxNode } from "@lezer/common";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "./typst";
import {
  type ArgRef,
  type ArgumentEdit,
  type CallArguments,
  planArgumentEdit,
  readCallArguments,
  sourceText,
} from "./typst-arguments";
import { readTypstFormsFixture } from "./typst-forms-test-support";

let parser: Parser;

beforeAll(async () => {
  parser = await loadTypstParser();
});

function callsIn(doc: string): SyntaxNode[] {
  const calls: SyntaxNode[] = [];
  parser.parse(doc).iterate({
    enter(ref) {
      if (ref.name === "FuncCall") calls.push(ref.node);
    },
  });
  return calls;
}

function findCall(doc: string, callee: string, occurrence = 0): SyntaxNode {
  const call = callsIn(doc).filter((node) => {
    const head = node.firstChild;
    return head !== null && doc.slice(head.from, head.to) === callee;
  })[occurrence];
  if (!call) throw new Error(`no call to ${callee} in the document`);
  return call;
}

function argumentsOf(doc: string, callee: string, occurrence = 0): CallArguments {
  const args = readCallArguments(sourceText(doc), findCall(doc, callee, occurrence));
  if (!args) throw new Error(`the ${callee} call did not read`);
  return args;
}

function applyChanges(doc: string, changes: Parameters<typeof ChangeSet.of>[0]): string {
  return ChangeSet.of(changes, doc.length, "\n").apply(Text.of(doc.split("\n"))).toString();
}

function argText(doc: string, args: CallArguments, ref: ArgRef): string | null {
  if ("named" in ref) {
    const slot = args.named.find((named) => named.name === ref.named);
    return slot ? doc.slice(slot.value.from, slot.value.to) : null;
  }
  const slot = args.positional[ref.positional];
  return slot ? doc.slice(slot.node.from, slot.node.to) : null;
}

function target(edit: ArgumentEdit): ArgRef {
  if ("replace" in edit) return edit.replace;
  if ("insert" in edit) return edit.insert;
  return edit.remove;
}

// Plans one edit, applies it, and checks the two invariants every row must hold:
// nothing outside the call changes, and the edited argument reads back as written.
function edited(doc: string, callee: string, edit: ArgumentEdit, lineBreak = "\n", occurrence = 0): string {
  const args = argumentsOf(doc, callee, occurrence);
  const plan = planArgumentEdit(sourceText(doc), args, edit, lineBreak);
  if (!plan.ok) throw new Error(`refused: ${plan.reason}`);
  const after = applyChanges(doc, plan.changes);
  const grown = after.length - doc.length;
  expect(after.slice(0, args.call.from)).toBe(doc.slice(0, args.call.from));
  expect(after.slice(args.call.to + grown)).toBe(doc.slice(args.call.to));
  const reread = readCallArguments(sourceText(after), findCall(after, callee, occurrence));
  expect(reread, `the edited call should still read:\n${after}`).not.toBeNull();
  const ref = target(edit);
  if ("remove" in edit) expect(argText(after, reread as CallArguments, ref)).toBeNull();
  else expect(argText(after, reread as CallArguments, ref)).toBe(edit.text);
  return after;
}

function refusal(doc: string, callee: string, edit: ArgumentEdit): string {
  const plan = planArgumentEdit(sourceText(doc), argumentsOf(doc, callee), edit, "\n");
  return plan.ok ? "planned" : plan.reason;
}

const named = (name: string): ArgRef => ({ named: name });
const positional = (index: number): ArgRef => ({ positional: index });

describe("reading call arguments", () => {
  it("reads named, positional and trailing arguments in Typst order", () => {
    const doc = '#g(1, x: true, 2.5e3, data.title)[body][more]';
    const args = argumentsOf(doc, "g");
    expect(args.parens).toEqual({ open: 2, close: 32 });
    expect(args.positional.map((slot) => [slot.type, slot.trailing])).toEqual([
      ["Int", false],
      ["Float", false],
      ["FieldAccess", false],
      ["ContentBlock", true],
      ["ContentBlock", true],
    ]);
    expect(args.named.map((slot) => [slot.name, slot.type, doc.slice(slot.value.from, slot.value.to)])).toEqual([
      ["x", "Bool", "true"],
    ]);
    expect(args.spread).toBe(false);
  });

  it("skips comments between arguments", () => {
    const doc = '#f(\n  name: "A", // signer\n  /* rev */ revision: -2,\n)';
    const args = argumentsOf(doc, "f");
    expect(args.named.map((slot) => [slot.name, slot.type])).toEqual([
      ["name", "Str"],
      ["revision", "Unary"],
    ]);
    expect(args.positional).toEqual([]);
  });

  it("reads trailing blocks without parentheses", () => {
    const args = argumentsOf("#f[a][b]", "f");
    expect(args.parens).toBeNull();
    expect(args.positional.map((slot) => slot.trailing)).toEqual([true, true]);
  });

  it("reports spreads", () => {
    expect(argumentsOf("#f(..extra)[x]", "f").spread).toBe(true);
  });

  it("refuses arguments that contain a syntax error, including a repeated name", () => {
    const doc = readTypstFormsFixture("project/edge-cases-broken.typ");
    expect(readCallArguments(sourceText(doc), findCall(doc, "info-box"))).toBeNull();
    const repeated = "#f(a: 1, b: 2, a: 3)";
    expect(readCallArguments(sourceText(repeated), findCall(repeated, "f"))).toBeNull();
  });

  it("reads every call in the fixture reports", () => {
    const report = readTypstFormsFixture("project/report.typ");
    const cover = argumentsOf(report, "acme.cover-page");
    expect(cover.named.map((slot) => slot.name)).toEqual(["title", "subtitle", "confidential"]);
    expect(argumentsOf(report, "badge").positional.map((slot) => slot.type)).toEqual(["Str"]);
    const multiline = argumentsOf(report, "info-box", 1);
    expect(multiline.named.map((slot) => slot.name)).toEqual(["title", "tone"]);
    expect(multiline.positional.map((slot) => [slot.type, slot.trailing])).toEqual([["ContentBlock", true]]);
    const edge = readTypstFormsFixture("project/edge-cases.typ");
    expect(argumentsOf(edge, "info-box", 1).named[0].type).toBe("FieldAccess");
    expect(argumentsOf(edge, "info-box", 2).spread).toBe(true);
  });
});

describe("replacing an argument", () => {
  it.each([
    ['#info-box(title: "Key result", tone: "note")[x]', "info-box", named("tone"), '"risk"', '#info-box(title: "Key result", tone: "risk")[x]'],
    ['#badge("review")', "badge", positional(0), '"approved"', '#badge("approved")'],
    ['#info-box(title: "a")[old]', "info-box", positional(0), "[new *text*]", '#info-box(title: "a")[new *text*]'],
    [
      '#acme.sign-off(\n  name: "A", // c\n  revision: -2,\n)',
      "acme.sign-off",
      named("revision"),
      "3",
      '#acme.sign-off(\n  name: "A", // c\n  revision: 3,\n)',
    ],
    ['Ünïcödé 😀 text #f(a: "x") tail', "f", named("a"), '"ÿ 😀"', 'Ünïcödé 😀 text #f(a: "ÿ 😀") tail'],
  ])("%j", (doc, callee, ref, text, expected) => {
    expect(edited(doc, callee, { replace: ref, text })).toBe(expected);
  });

  it("replaces a value in the multi-line fixture box and keeps its layout", () => {
    const report = readTypstFormsFixture("project/report.typ");
    const after = edited(report, "info-box", { replace: named("title"), text: '"Supplier risk"' }, "\n", 1);
    expect(after).toContain('#info-box(\n  title: "Supplier risk",\n  tone: "risk",\n)[');
  });

  it("refuses a missing argument", () => {
    expect(refusal("#f(a: 1)", "f", { replace: named("b"), text: "2" })).toBe("missing");
    expect(refusal("#f(a: 1)", "f", { replace: positional(0), text: "2" })).toBe("missing");
  });
});

describe("inserting an argument", () => {
  it.each([
    ["#f()", named("x"), "1", "#f(x: 1)"],
    ["#f( )", named("x"), "1", "#f(x: 1)"],
    ["#info-box[Body]", named("title"), '"T"', '#info-box(title: "T")[Body]'],
    ['#info-box(title: "a")[b]', named("tone"), '"risk"', '#info-box(title: "a", tone: "risk")[b]'],
    ["#f(a: 1,)", named("b"), "2", "#f(a: 1, b: 2)"],
    ['#badge("review")', named("x"), "1", '#badge(x: 1, "review")'],
    ['#f(a: 1, "p")', named("b"), "2", '#f(a: 1, b: 2, "p")'],
    ["#f(\n  a: 1,\n  b: 2\n)", named("c"), "3", "#f(\n  a: 1,\n  b: 2,\n  c: 3\n)"],
    ["#f(\n  a: 1, // keep\n)", named("c"), "3", "#f(\n  a: 1, // keep\n  c: 3,\n)"],
    ["#f(\n  a: 1 // keep\n)", named("c"), "3", "#f(\n  a: 1, // keep\n  c: 3\n)"],
    ["#f(\n  a: 1)", named("c"), "3", "#f(\n  a: 1,\n  c: 3)"],
    ["#f(\n  a: 1,)", named("c"), "3", "#f(\n  a: 1,\n  c: 3,)"],
    ["#f(\n  a: 1, b: 2,\n)", named("c"), "3", "#f(\n  a: 1, b: 2,\n  c: 3,\n)"],
    ['#f(\n  "p",\n  a: 1,\n)', named("c"), "3", '#f(\n  c: 3,\n  "p",\n  a: 1,\n)'],
  ])("%j gets %j", (doc, ref, text, expected) => {
    const callee = doc.slice(1, doc.search(/[([]/u));
    expect(edited(doc, callee, { insert: ref, text, content: false })).toBe(expected);
  });

  it("adds a named argument to the multi-line fixture box with its trailing comma", () => {
    const report = readTypstFormsFixture("project/report.typ");
    const after = edited(report, "acme.cover-page", { insert: named("note"), text: '"x"', content: false });
    expect(after).toContain('  confidential: true,\n  note: "x",\n)');
  });

  it.each([
    ["#status-badge()", positional(0), '"draft"', false, '#status-badge("draft")'],
    ['#f("a")', positional(1), '"b"', false, '#f("a", "b")'],
    ['#f("a", x: 1)', positional(1), '"b"', false, '#f("a", "b", x: 1)'],
    ['#f(x: 1)', positional(0), '"b"', false, '#f("b", x: 1)'],
    ['#info-box(title: "a")', positional(0), "[Body]", true, '#info-box(title: "a")[Body]'],
    ["#f[a]", positional(1), "[b]", true, "#f[a][b]"],
    ['#f(\n  "a",\n  x: 1,\n)', positional(1), '"b"', false, '#f(\n  "a",\n  "b",\n  x: 1,\n)'],
  ])("%j gets positional %j", (doc, ref, text, content, expected) => {
    const callee = doc.slice(1, doc.search(/[([]/u));
    expect(edited(doc, callee, { insert: ref, text, content })).toBe(expected);
  });

  it("refuses an insert that leaves a gap, collides, or follows a trailing block", () => {
    expect(refusal("#f()", "f", { insert: positional(1), text: "1", content: false })).toBe("positionGap");
    expect(refusal("#f()[x]", "f", { insert: positional(1), text: "1", content: false })).toBe("positionGap");
    expect(refusal('#f("a")', "f", { insert: positional(0), text: "1", content: false })).toBe("exists");
    expect(refusal("#f(a: 1)", "f", { insert: named("a"), text: "2", content: false })).toBe("exists");
  });

  it("follows CRLF line breaks", () => {
    expect(edited("#f(\r\n  a: 1,\r\n)", "f", { insert: named("b"), text: "2", content: false }, "\r\n")).toBe(
      "#f(\r\n  a: 1,\r\n  b: 2,\r\n)",
    );
    const crlf = readTypstFormsFixture("project/edge-cases-crlf.typ");
    const after = edited(crlf, "info-box", { insert: named("tone"), text: '"risk"', content: false }, "\r\n", 3);
    expect(after).toContain('#info-box(title: "Outer box", tone: "risk")[\r\n');
    expect(after.replaceAll("\r\n", "")).not.toContain("\n");
  });
});

describe("removing an argument", () => {
  it.each([
    ["#f(a: 1, b: 2, c: 3)", "a", "#f(b: 2, c: 3)"],
    ["#f(a: 1, b: 2, c: 3)", "b", "#f(a: 1, c: 3)"],
    ["#f(a: 1, b: 2, c: 3)", "c", "#f(a: 1, b: 2)"],
    ["#f(a: 1)[x]", "a", "#f()[x]"],
    ["#f(\n  a: 1,\n  b: 2,\n)", "a", "#f(\n  b: 2,\n)"],
    ["#f(\n  a: 1,\n  b: 2\n)", "b", "#f(\n  a: 1,\n)"],
    ["#f(\r\n  a: 1,\r\n  b: 2,\r\n)", "a", "#f(\r\n  b: 2,\r\n)"],
  ])("%j without %s", (doc, name, expected) => {
    expect(edited(doc, "f", { remove: named(name) })).toBe(expected);
  });

  it("refuses positional and missing arguments", () => {
    expect(refusal('#f("a")', "f", { remove: positional(0) })).toBe("notRemovable");
    expect(refusal("#f(a: 1)", "f", { remove: named("b") })).toBe("missing");
  });
});

describe("refusals that protect the document", () => {
  it("refuses every edit to a call with a spread", () => {
    expect(refusal("#info-box(..extra)[x]", "info-box", { replace: positional(0), text: "[y]" })).toBe("spread");
    expect(refusal("#info-box(..extra)[x]", "info-box", { insert: named("title"), text: '"t"', content: false })).toBe(
      "spread",
    );
  });

  it("refuses arguments read from an older document", () => {
    const doc = '#f(a: "x")';
    const args = argumentsOf(doc, "f");
    expect(planArgumentEdit(sourceText(`Intro ${doc}`), args, { replace: named("a"), text: '"y"' }, "\n")).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(planArgumentEdit(sourceText("#f"), args, { replace: named("a"), text: '"y"' }, "\n")).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});

describe("planned edits in a live editor", () => {
  it("dispatches one change that undoes and redoes as one step", async () => {
    const doc = '#info-box(title: "a")[b]\n';
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [history()] }) });
    const args = argumentsOf(doc, "info-box");
    const plan = planArgumentEdit(view.state.doc, args, { insert: named("tone"), text: '"risk"', content: false }, view.state.lineBreak);
    if (!plan.ok) throw new Error(plan.reason);
    view.dispatch({ changes: [...plan.changes], userEvent: "input.form" });
    const after = '#info-box(title: "a", tone: "risk")[b]\n';
    expect(view.state.doc.toString()).toBe(after);
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
    redo(view);
    expect(view.state.doc.toString()).toBe(after);
    view.destroy();
  });
});
