// @vitest-environment jsdom

import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setTypstStyleVersionProvider } from "./bibliography-styles";
import {
  typstBibliographyParameterAt,
  typstBibliographyParameterCompletions,
  typstSupportsMultipleBibliographies,
} from "./typst-bibliography-parameters";
import { installEnglishEditorMessages } from "./test-messages";
import { typstSlashCompletions } from "./typst-snippets";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

beforeAll(() => installEnglishEditorMessages());

afterEach(() => setTypstStyleVersionProvider(() => null));

function complete(doc: string, explicit = false): CompletionResult | null {
  const result = typstBibliographyParameterCompletions(
    new CompletionContext(EditorState.create({ doc }), doc.length, explicit),
  );
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result;
}

function labels(result: CompletionResult | null): string[] {
  return result?.options.map((option) => option.label) ?? [];
}

type Source = (context: CompletionContext) => CompletionResult | Promise<CompletionResult | null> | null;

function accept(doc: string, label: string, source: Source = typstBibliographyParameterCompletions, explicit = false): string {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: doc.length } }) });
  try {
    const result = source(new CompletionContext(view.state, doc.length, explicit));
    if (!result || result instanceof Promise) throw new Error(`no completion for ${doc}`);
    const option = result.options.find((candidate: Completion) => candidate.label === label);
    if (!option) throw new Error(`${label} is not offered`);
    if (typeof option.apply === "function") option.apply(view, option, result.from, doc.length);
    else view.dispatch({ changes: { from: result.from, to: doc.length, insert: option.apply ?? option.label } });
    return view.state.doc.toString();
  } finally {
    view.destroy();
    parent.remove();
  }
}

describe("typstSupportsMultipleBibliographies", () => {
  it("starts with Typst 0.15 and assumes the newest Typst when unknown", () => {
    expect(typstSupportsMultipleBibliographies("0.14.2")).toBe(false);
    expect(typstSupportsMultipleBibliographies("0.15.0")).toBe(true);
    expect(typstSupportsMultipleBibliographies("0.15.1")).toBe(true);
    expect(typstSupportsMultipleBibliographies("1.0.0")).toBe(true);
    expect(typstSupportsMultipleBibliographies(null)).toBe(true);
  });
});

describe("typstBibliographyParameterAt", () => {
  it("finds argument names inside bibliography calls and set rules", () => {
    expect(typstBibliographyParameterAt('#bibliography("refs.bib", ta')).toEqual({ kind: "name", query: "ta" });
    expect(typstBibliographyParameterAt('#bibliography("refs.bib", ')).toEqual({ kind: "name", query: "" });
    expect(typstBibliographyParameterAt("#set bibliography(gr")).toEqual({ kind: "name", query: "gr" });
    expect(typstBibliographyParameterAt('#bibliography(\n  "refs.bib",\n  ')).toEqual({ kind: "name", query: "" });
  });

  it("finds values after target and group", () => {
    expect(typstBibliographyParameterAt('#bibliography("refs.bib", target: ')).toEqual({
      kind: "target",
      query: "",
    });
    expect(typstBibliographyParameterAt('#bibliography("refs.bib", group: "a')).toEqual({
      kind: "group",
      query: '"a',
    });
    expect(typstBibliographyParameterAt('#bibliography("refs.bib", target: sel')).toEqual({
      kind: "target",
      query: "sel",
    });
  });

  it("ignores other calls, strings, nested arguments and markup", () => {
    expect(typstBibliographyParameterAt("#figure(ta")).toBeNull();
    expect(typstBibliographyParameterAt('#bibliography("ta')).toBeNull();
    expect(typstBibliographyParameterAt("#bibliography(\"r.bib\", target: selector(cite).within(<")).toBeNull();
    expect(typstBibliographyParameterAt("#bibliography(\"r.bib\", title: [Refs ta")).toBeNull();
    expect(typstBibliographyParameterAt("Text about the bibliography(ta")).toBeNull();
    expect(typstBibliographyParameterAt('#bibliography("r.bib")\nta')).toBeNull();
  });
});

describe("typstBibliographyParameterCompletions", () => {
  it("offers target and group as named arguments on Typst 0.15", () => {
    setTypstStyleVersionProvider(() => "0.15.1");
    expect(complete('#bibliography("refs.bib", ')).toBeNull();
    expect(labels(complete('#bibliography("refs.bib", t'))).toEqual(["target", "group"]);
    const result = complete('#bibliography("refs.bib", ', true);
    expect(labels(result)).toEqual(["target", "group"]);
    expect(result?.options[0]?.detail).toBe("which citations it lists");
    expect(accept('#bibliography("refs.bib", ', "target", typstBibliographyParameterCompletions, true)).toBe(
      '#bibliography("refs.bib", target: ',
    );
  });

  it("offers nothing for Typst versions before 0.15", () => {
    setTypstStyleVersionProvider(() => "0.14.2");
    expect(complete('#bibliography("refs.bib", ', true)).toBeNull();
    expect(complete('#bibliography("refs.bib", target: ')).toBeNull();
  });

  it("offers selector templates for target", () => {
    setTypstStyleVersionProvider(() => "0.15.1");
    const doc = '#bibliography("refs.bib", target: ';
    const result = complete(doc);
    expect(labels(result)).toEqual([
      "auto",
      "selector(cite).within(<label>)",
      "selector(cite).after(<label>)",
      "selector(cite).before(<label>)",
    ]);
    expect(accept(doc, "selector(cite).within(<label>)")).toBe(
      '#bibliography("refs.bib", target: selector(cite).within(<label>)',
    );
  });

  it("offers auto, none and a named group", () => {
    setTypstStyleVersionProvider(() => "0.15.0");
    const doc = "#set bibliography(group: ";
    const result = complete(doc);
    expect(labels(result)).toEqual(["auto", "none", '"group"']);
    expect(result?.options.map((option) => option.detail)).toEqual([
      "number with the other bibliographies",
      "number on its own",
      "number with bibliographies of the same name",
    ]);
    expect(accept(doc, '"group"')).toBe(
      '#set bibliography(group: "group"',
    );
  });

  it("replaces a partly typed value", () => {
    setTypstStyleVersionProvider(() => "0.15.1");
    const doc = '#bibliography("refs.bib", group: no';
    const result = complete(doc);
    expect(result?.from).toBe(doc.length - 2);
  });
});

describe("part bibliography snippet", () => {
  function slashLabels(doc: string): string[] {
    const result = typstSlashCompletions(new CompletionContext(EditorState.create({ doc }), doc.length, false));
    if (result instanceof Promise) throw new Error("expected a synchronous result");
    return labels(result);
  }

  it("is offered from Typst 0.15 on", () => {
    setTypstStyleVersionProvider(() => "0.14.2");
    expect(slashLabels("/part")).not.toContain("/partbibliography");
    expect(slashLabels("/part")).toContain("/bibliography");
    setTypstStyleVersionProvider(() => "0.15.1");
    expect(slashLabels("/part")).toContain("/partbibliography");
  });

  it("inserts a bibliography scoped to a labelled part", () => {
    setTypstStyleVersionProvider(() => "0.15.1");
    const doc = "/part";
    const result = typstSlashCompletions(new CompletionContext(EditorState.create({ doc }), doc.length, false));
    if (result instanceof Promise || !result) throw new Error("expected completions");
    const option = result.options.find((candidate) => candidate.label === "/partbibliography");
    expect(option?.detail).toBe("Bibliography for one labelled part");
    expect(accept(doc, "/partbibliography", typstSlashCompletions)).toBe(
      '#bibliography(\n  "refs.bib",\n  title: [References],\n  target: selector(cite).within(<part>),\n  group: none,\n)',
    );
  });
});
