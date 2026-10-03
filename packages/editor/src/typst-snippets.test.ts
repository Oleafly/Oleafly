// @vitest-environment jsdom

import {
  CompletionContext,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installEnglishEditorMessages } from "./test-messages";
import { TYPST_SNIPPETS, typstSlashCompletions } from "./typst-snippets";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const views: EditorView[] = [];

beforeAll(() => installEnglishEditorMessages());

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

function complete(
  doc: string,
  state = EditorState.create({ doc }),
): CompletionResult | null {
  const result = typstSlashCompletions(
    new CompletionContext(state, doc.length, false),
  );
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result;
}

function accepted(doc: string, label: string): string {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [indentUnit.of("  ")],
    }),
  });
  views.push(view);
  const result = complete(doc, view.state);
  if (!result) throw new Error(`no completion for ${doc}`);
  const option = result.options.find(
    (candidate: Completion) => candidate.label === label,
  );
  if (typeof option?.apply !== "function") throw new Error(`${label} has no apply`);
  option.apply(view, option, result.from, doc.length);
  return view.state.doc.toString();
}

describe("typstSlashCompletions", () => {
  it.each([
    ["/heading", "= "],
    ["/figure", '#figure(\n  image(""),\n  caption: [],\n) <fig:>'],
    [
      "/tablefigure",
      "#figure(\n  table(\n    columns: 2,\n    [], [],\n  ),\n  caption: [],\n) <tab:>",
    ],
    ["/table", "#table(\n  columns: 2,\n  [], [],\n)"],
    ["/equation", "$  $"],
    [
      "/numberedequation",
      '#math.equation(block: true, numbering: "(1)", $  $) <eq:>',
    ],
    ["/footnote", "#footnote[]"],
    ["/quote", "#quote(block: true)[]"],
    ["/code", "```\n\n```"],
    ["/outline", "#outline()"],
    ["/bibliography", '#bibliography("")'],
    ["/pagebreak", "#pagebreak()"],
    ["/columns", "#columns(2)[]"],
    ["/grid", "#grid(\n  columns: 2,\n  gutter: 1em,\n  [], [],\n)"],
    ["/link", '#link("")[]'],
    ["/list", "- "],
    ["/enum", "+ "],
    ["/terms", "/ : "],
  ])("expands %s to Typst markup", (label, expected) => {
    expect(accepted(label, label)).toBe(expected);
  });

  it("offers every snippet with a described label", () => {
    const result = complete("/");
    expect(result?.from).toBe(0);
    expect(result?.options.map((option) => option.label)).toEqual(
      TYPST_SNIPPETS.map((snippet) => snippet.label),
    );
    for (const option of result?.options ?? []) {
      expect(option.type).toBe("snippet");
      expect(option.detail).toMatch(/\S/u);
      expect(option.detail).not.toContain("typst.snippet");
    }
  });

  it("indents later snippet lines like the current line", () => {
    expect(accepted("  /table", "/table")).toBe(
      "  #table(\n    columns: 2,\n    [], [],\n  )",
    );
  });

  it("starts after whitespace in markup only", () => {
    expect(complete("Text /fig")?.from).toBe(5);
    expect(complete("[/fig")).toBeNull();
    expect(complete("a/fig")).toBeNull();
    expect(complete("// note /fig")).toBeNull();
    expect(complete("https://example.com/fig")).toBeNull();
    expect(complete("#let x = /fig")).toBeNull();
    expect(complete("$ a /fig")).toBeNull();
    expect(complete('#image(" /fig')).toBeNull();
    expect(complete("```\n/fig")).toBeNull();
    expect(complete("#box[\n  /fig")?.from).toBe("#box[\n  ".length);
  });
});
