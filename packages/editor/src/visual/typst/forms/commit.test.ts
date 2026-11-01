// @vitest-environment jsdom

import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser, typstLanguage } from "../../../typst";
import { staticTypstForms } from "../../../typst-forms";
import { typstFormsGolden } from "../../../typst-forms-test-support";
import { parsedView } from "../../test-document";
import { typstVisualMode } from "../index";
import { commitFieldEdit, formCallAt } from "./commit";
import type { FieldEdit } from "./model";

const ACME = '#import "@local/acme-report:0.1.0": *\n';
const views: EditorView[] = [];

beforeAll(async () => {
  await loadTypstParser();
});

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function viewOf(body: string, readOnly = false, extra: Extension[] = []): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: `${ACME}${body}`,
      extensions: [
        history(),
        typstLanguage(),
        typstVisualMode({ resolveImage: async () => null, typstForms: staticTypstForms(typstFormsGolden()) }, "report.typ"),
        EditorState.readOnly.of(readOnly),
        extra,
      ],
    }),
  });
  views.push(view);
  return parsedView(view);
}

function anchorOf(view: EditorView, needle = "#"): number {
  return view.state.doc.toString().indexOf(needle, ACME.length);
}

function commit(body: string, fn: string, field: number, edit: FieldEdit) {
  const view = viewOf(body);
  const result = commitFieldEdit(view, anchorOf(view), `pkg:@local/acme-report:0.1.0#${fn}`, field, edit);
  return { result, text: view.state.doc.toString().slice(ACME.length), view };
}

const set = (type: string, value: unknown): FieldEdit => ({ set: { type, value } as never });
const clear: FieldEdit = { clear: true };

describe("committing a field", () => {
  it.each([
    ['#info-box(title: "a")[b]', "info-box", 0, set("text", 'Say "hi"\n'), '#info-box(title: "Say \\"hi\\"\\n")[b]'],
    ['#info-box(title: "a")[b]', "info-box", 1, set("choice", "risk"), '#info-box(title: "a", tone: "risk")[b]'],
    ['#info-box(title: "a", tone: "risk")[b]', "info-box", 1, clear, '#info-box(title: "a")[b]'],
    ['#info-box(title: "a")[b]', "info-box", 2, set("content", "new ] text"), '#info-box(title: "a")[new \\] text]'],
    ['#info-box(title: "a", "b")', "info-box", 2, set("content", "kept as a string"), '#info-box(title: "a", "kept as a string")'],
    ['#info-box(title: "a")', "info-box", 2, set("content", "*added*"), '#info-box(title: "a")[*added*]'],
    ['#info-box(title: "a")[\n  old\n]', "info-box", 2, set("content", "new\n\nlines"), '#info-box(title: "a")[\n  new\n\n  lines\n]'],
    ['#sign-off(name: "D")', "sign-off", 1, set("number", 4), '#sign-off(name: "D", revision: 4)'],
    ['#sign-off(name: "D", revision: 2)', "sign-off", 2, set("toggle", true), '#sign-off(name: "D", revision: 2, final: true)'],
    ['#status-badge("draft")', "status-badge", 0, set("choice", "approved"), '#status-badge("approved")'],
    ["#status-badge()", "status-badge", 0, set("choice", "review"), '#status-badge("review")'],
  ])("%s field %i", (body, fn, field, edit, expected) => {
    const { result, text } = commit(body, fn, field, edit);
    expect(result).toEqual({ ok: true });
    expect(text).toBe(expected);
  });

  it("writes one undo step", () => {
    const { view } = commit('#info-box(title: "a")[b]', "info-box", 0, set("text", "z"));
    undo(view);
    expect(view.state.doc.toString()).toBe(`${ACME}#info-box(title: "a")[b]`);
  });

  it("refuses what the call can't take", () => {
    expect(commit('#info-box(title: "a")[b]', "info-box", 0, clear).result).toEqual({ ok: false, reason: "refused" });
    expect(commit("#info-box(title: data.t)[b]", "info-box", 0, set("text", "x")).result).toEqual({ ok: false, reason: "refused" });
    expect(commit('#info-box(..x)[b]', "info-box", 0, set("text", "x")).result).toEqual({ ok: false, reason: "refused" });
    expect(commit('#info-box(title: "a")[b]', "info-box", 2, clear).result).toEqual({ ok: false, reason: "refused" });
  });

  it("refuses a value outside the declared range or of the wrong kind", () => {
    expect(commit('#sign-off(name: "D")', "sign-off", 1, set("number", 0)).result).toEqual({ ok: false, reason: "invalid" });
    expect(commit('#sign-off(name: "D")', "sign-off", 1, set("number", 1.5)).result).toEqual({ ok: false, reason: "invalid" });
    expect(commit('#sign-off(name: "D")', "sign-off", 1, set("text", "1")).result).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses content that would break the call and dispatches nothing", () => {
    const { result, text } = commit('#info-box(title: "a")[b]', "info-box", 2, set("content", "price *5"));
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(text).toBe('#info-box(title: "a")[b]');
  });

  it("escapes a lone $, comment or backtick the same way table cells and captions do", () => {
    const { result, text } = commit('#info-box(title: "a")[b]', "info-box", 2, set("content", "price $5 // net `x"));
    expect(result).toEqual({ ok: true });
    expect(text).toBe(String.raw`#info-box(title: "a")[price \$5 \// net \`x]`);
  });

  it.each([
    ["new\nend // note", '#info-box(title: "a")[\n  new\n  end // note\n]'],
    ["new\nend\\", '#info-box(title: "a")[\n  new\n  end\\\n]'],
  ])("keeps %j as written when the body closes on its own line", (value, expected) => {
    const { result, text } = commit('#info-box(title: "a")[\n  old\n]', "info-box", 2, set("content", value));
    expect(result).toEqual({ ok: true });
    expect(text).toBe(expected);
  });

  it("reports a call that went away or changed form as stale", () => {
    const view = viewOf('#info-box(title: "a")[b]');
    const anchor = anchorOf(view);
    view.dispatch({ changes: { from: anchor, to: view.state.doc.length } });
    parsedView(view);
    expect(commitFieldEdit(view, anchor, "pkg:@local/acme-report:0.1.0#info-box", 0, set("text", "x"))).toEqual({
      ok: false,
      reason: "stale",
    });
    const other = viewOf('#sign-off(name: "a")');
    expect(commitFieldEdit(other, anchorOf(other), "pkg:@local/acme-report:0.1.0#info-box", 0, set("text", "x"))).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("writes nothing into a read-only document", () => {
    const view = viewOf('#info-box(title: "a")[b]', true);
    expect(commitFieldEdit(view, anchorOf(view), "pkg:@local/acme-report:0.1.0#info-box", 0, set("text", "x"))).toEqual({
      ok: false,
      reason: "readOnly",
    });
  });

  it("reports a change an edit lock filtered out instead of claiming it was written", () => {
    const body = '#info-box(title: "a")[b]';
    const view = viewOf(body, false, [EditorState.transactionFilter.of((tr) => (tr.docChanged ? [] : tr))]);
    expect(commitFieldEdit(view, anchorOf(view), "pkg:@local/acme-report:0.1.0#info-box", 0, set("text", "x"))).toEqual({
      ok: false,
      reason: "readOnly",
    });
    expect(view.state.doc.toString()).toBe(`${ACME}${body}`);
  });

  it("finds the form call at an anchor and nothing elsewhere", () => {
    const view = viewOf('Text #info-box(title: "a")[b]');
    expect(formCallAt(view.state, anchorOf(view))?.model.definition.function).toBe("info-box");
    expect(formCallAt(view.state, anchorOf(view) + 1)).toBeNull();
    expect(formCallAt(view.state, 0)).toBeNull();
  });
});
