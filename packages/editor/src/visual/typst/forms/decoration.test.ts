import { Compartment, EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser, typstLanguage } from "../../../typst";
import { staticTypstForms } from "../../../typst-forms";
import { readTypstFormsFixture, typstFormsGolden } from "../../../typst-forms-test-support";
import { parsedState } from "../../test-document";
import type { VisualPorts } from "../../types";
import { typstVisualMode } from "../index";
import { TypstTableWidget } from "../table/widget";
import { rangeOf, typstState, widgetsOf } from "../test-support";
import { TypstFormChipWidget } from "./chip";
import { TypstFormCardWidget } from "./widget";

beforeAll(async () => {
  await loadTypstParser();
});

const ports = (): VisualPorts => ({ resolveImage: async () => null, typstForms: staticTypstForms(typstFormsGolden()) });

function stateOf(doc: string, options: { cursor?: number; readOnly?: boolean } = {}) {
  return typstState(doc, { ...options, ports: ports(), path: "report.typ" });
}

function cards(doc: string, options: { cursor?: number; readOnly?: boolean } = {}) {
  return widgetsOf(stateOf(doc, options), TypstFormCardWidget).map((found) => ({
    form: found.widget.call.definition.function,
    text: doc.slice(found.from, found.to),
    block: found.block,
  }));
}

function chips(doc: string, options: { cursor?: number } = {}) {
  return widgetsOf(stateOf(doc, options), TypstFormChipWidget).map((found) => doc.slice(found.from, found.to));
}

const REPORT = readTypstFormsFixture("project/report.typ");
const EDGE = readTypstFormsFixture("project/edge-cases.typ");

describe("form decorations", () => {
  it("shows calls on their own lines as cards over the whole lines", () => {
    expect(cards(REPORT).map((card) => [card.form, card.block])).toEqual([
      ["cover-page", true],
      ["info-box", true],
      ["info-box", true],
      ["memo-header", true],
      ["sign-off", true],
    ]);
    const cover = cards(REPORT)[0].text;
    expect(cover.startsWith("#acme.cover-page(\n")).toBe(true);
    expect(cover.endsWith("  confidential: true,\n)")).toBe(true);
  });

  it("shows calls inside a paragraph as chips", () => {
    expect(chips(REPORT)).toEqual(['#badge("review")']);
  });

  it("reveals the source of a call the cursor touches", () => {
    const at = rangeOf(REPORT, "#acme.sign-off").from + 3;
    expect(cards(REPORT, { cursor: at }).map((card) => card.form)).not.toContain("sign-off");
    const badge = rangeOf(REPORT, '#badge("review")').from + 2;
    expect(chips(REPORT, { cursor: badge })).toEqual([]);
  });

  it("keeps decorating read-only fields and read-only documents", () => {
    const forms = cards(EDGE).map((card) => card.form);
    expect(forms.filter((name) => name === "info-box")).toHaveLength(4);
    const at = rangeOf(REPORT, "#acme.sign-off").from + 3;
    expect(cards(REPORT, { cursor: at, readOnly: true }).map((card) => card.form)).toContain("sign-off");
  });

  it("decorates nothing inside a card, so nested form calls stay part of it", () => {
    const outer = rangeOf(EDGE, '#info-box(title: "Outer box")');
    const nested = widgetsOf(stateOf(EDGE), TypstFormChipWidget).filter((found) => found.from > outer.from && found.from < outer.from + 120);
    expect(nested).toEqual([]);
    expect(cards(EDGE).some((card) => card.text.includes('#status-badge("draft")'))).toBe(true);
  });

  it("leaves bare built-in names to their built-in widget and matches the qualified form", () => {
    const state = stateOf(EDGE);
    expect(widgetsOf(state, TypstTableWidget)).toHaveLength(1);
    expect(cards(EDGE).map((card) => card.form)).toContain("table");
    expect(cards(EDGE).find((card) => card.form === "table")?.text).toContain("#acme.table(");
  });

  it("keeps calls in the collapsed settings block hidden, and calls with errors raw", () => {
    expect(chips(EDGE, { cursor: EDGE.length }).some((text) => text.includes("Inside the settings"))).toBe(false);
    expect(cards(readTypstFormsFixture("project/edge-cases-broken.typ"))).toEqual([]);
  });

  it("leaves a shadowed call raw", () => {
    const after = cards(EDGE).filter((card) => card.text.includes("After the let"));
    expect(after).toEqual([]);
    expect(cards(EDGE).some((card) => card.text.includes("Before the let"))).toBe(true);
  });
});

describe("a document that moves", () => {
  it("resolves its relative imports again from its new folder", () => {
    const doc = '#import "template/memo.typ": memo-header\n\n#memo-header(to: "Ops", subject: "Plan")\n';
    const visual = new Compartment();
    const before = parsedState(
      EditorState.create({ doc, extensions: [typstLanguage(), visual.of(typstVisualMode(ports(), "drafts/report.typ"))] }),
    );
    expect(widgetsOf(before, TypstFormCardWidget)).toEqual([]);
    const after = before.update({ effects: visual.reconfigure(typstVisualMode(ports(), "report.typ")) }).state;
    expect(widgetsOf(after, TypstFormCardWidget).map((found) => found.widget.call.definition.function)).toEqual(["memo-header"]);
  });
});
