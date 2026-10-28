import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { beforeAll, describe, expect, it } from "vitest";
import { installEnglishEditorMessages } from "../../../test-messages";
import { loadTypstParser } from "../../../typst";
import type { TypstFormDefinition } from "../../../typst-forms";
import { typstFormsGolden } from "../../../typst-forms-test-support";
import { hashBefore } from "../syntax";
import { typstState } from "../test-support";
import { type FieldState, numberProblem, readFormCall } from "./model";

beforeAll(async () => {
  await loadTypstParser();
});

function form(fn: string): TypstFormDefinition {
  const found = typstFormsGolden().forms.find((definition) => definition.function === fn);
  if (!found) throw new Error(`no ${fn} form in the golden`);
  return found;
}

function read(doc: string, fn: string) {
  const state = typstState(doc);
  let target: { hash: SyntaxNode; call: SyntaxNode } | null = null;
  syntaxTree(state).iterate({
    enter(ref) {
      const hash = ref.name === "FuncCall" ? hashBefore(ref.node) : null;
      if (hash && !target) target = { hash, call: ref.node };
    },
  });
  if (!target) throw new Error("no call");
  const { hash, call } = target as { hash: SyntaxNode; call: SyntaxNode };
  return readFormCall(state.doc, hash, call, form(fn));
}

function brief(state: FieldState): unknown {
  if (state.status === "absent") return "absent";
  if (state.status === "value") return [state.written, state.value.value];
  return [state.reason, state.source];
}

describe("reading a form call", () => {
  it.each([
    ['#info-box(title: "Key", tone: "risk")[Body *bold*]', "info-box", [["str", "Key"], ["str", "risk"], ["content", "Body *bold*"]]],
    ['#info-box(title: "Key", "As a string")', "info-box", [["str", "Key"], "absent", ["str", "As a string"]]],
    ["#info-box(title: data.title)[x]", "info-box", [["expression", "data.title"], "absent", ["content", "x"]]],
    ['#info-box(title: 3, tone: "urgent")[x]', "info-box", [["kind", "3"], ["unknownOption", '"urgent"'], ["content", "x"]]],
    ['#info-box(tone: none)[x]', "info-box", ["absent", ["kind", "none"], ["content", "x"]]],
    ['#sign-off(name: "D", revision: -3, final: true)', "sign-off", [["str", "D"], ["literal", -3], ["literal", true]]],
    ['#sign-off(name: "D", revision: 2.5, final: "yes")', "sign-off", [["str", "D"], ["kind", "2.5"], ["kind", '"yes"']]],
    ['#sign-off(name: "D", revision: 1 + 1)', "sign-off", [["str", "D"], ["expression", "1 + 1"], "absent"]],
    ['#status-badge("approved")', "status-badge", [["str", "approved"]]],
    ["#status-badge(state)", "status-badge", [["expression", "state"]]],
  ])("%s", (doc, fn, fields) => {
    expect(read(doc, fn)?.fields.map(brief)).toEqual(fields);
  });

  it("locks every field when the call has a spread", () => {
    const model = read('#info-box(..extra, title: "T")[x]', "info-box");
    expect(model?.fields.map(brief)).toEqual([
      ["locked", '"T"'],
      ["locked", ""],
      ["locked", "[x]"],
    ]);
  });

  it("shows a multi-line body without its line breaks and indent, and keeps them for writing", () => {
    const model = read('#info-box(title: "T")[\n  First line\n\n  Second *line*\n]', "info-box");
    const body = model?.fields[2];
    expect(body).toMatchObject({ status: "value", value: { value: "First line\n\nSecond *line*" } });
    expect(body?.status === "value" ? body.layout : null).toEqual({ open: "\n", indent: "  ", close: "\n" });
    expect(read('#info-box(title: "T")[\n  Ragged\nline\n]', "info-box")?.fields[2]).toMatchObject({
      value: { value: "\n  Ragged\nline\n" },
      layout: null,
    });
  });

  it("refuses arguments with a syntax error", () => {
    expect(read('#info-box(title: "T", tone: )[x]', "info-box")).toBeNull();
  });

  it.each([
    ['#info-box(title: "Supply risk", tone: "risk")[x]', "info-box", "Supply risk"],
    ['#status-badge("review")', "status-badge", "In review"],
    ['#status-badge("other")', "status-badge", null],
    ["#info-box(title: data.title)[x]", "info-box", null],
    ["#info-box[x]", "info-box", null],
    ['#acme.table(caption: "c")', "table", null],
  ])("summarises %s", (doc, fn, summary) => {
    expect(read(doc, fn)?.summary).toBe(summary);
  });
});

describe("summaries and number checks", () => {
  it("shows a toggle summary as On or Off, not true or false", () => {
    installEnglishEditorMessages();
    const signOff = form("sign-off");
    const byFinal = { ...signOff, summary: { named: "final" } } as TypstFormDefinition;
    const state = typstState('#sign-off(name: "D", final: true)');
    let summary: string | null | undefined;
    syntaxTree(state).iterate({
      enter(ref) {
        const hash = ref.name === "FuncCall" ? hashBefore(ref.node) : null;
        if (hash && summary === undefined) summary = readFormCall(state.doc, hash, ref.node, byFinal)?.summary;
      },
    });
    expect(summary).toBe("On");
  });

  it("refuses an integer the source can't hold exactly", () => {
    const kind = { type: "number", integer: true, min: null, max: null, step: null, default: null } as const;
    expect(numberProblem(kind, 9_007_199_254_740_991)).toBeNull();
    expect(numberProblem(kind, 9_007_199_254_740_993)).toBe("number");
    expect(numberProblem({ ...kind, integer: false }, 1e16)).toBeNull();
  });
});
