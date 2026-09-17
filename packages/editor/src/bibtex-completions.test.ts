// @vitest-environment jsdom

import {
  CompletionContext,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { bibtexCompletions } from "./bibtex-completions";
import { installEnglishEditorMessages } from "./test-messages";

installEnglishEditorMessages();

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

function viewFor(source: string): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc: source }) });
  document.body.appendChild(view.dom);
  return view;
}

function completion(source: string, explicit = false): CompletionResult | null {
  const state = EditorState.create({ doc: source });
  return bibtexCompletions(
    new CompletionContext(state, state.doc.length, explicit),
  );
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => String(option.label));
}

function option(result: CompletionResult | null, label: string): Completion {
  const found = result?.options.find(
    (candidate) => candidate.label === label,
  );
  if (!found) throw new Error(`Missing completion ${label}`);
  return found;
}

describe("BibTeX entry completion", () => {
  it("offers every entry type and directive after @ at the start of a line", () => {
    const offered = labels(completion("@art"));
    expect(offered).toContain("@article");
    expect(offered).toContain("@inproceedings");
    expect(offered).toContain("@online");
    expect(offered).toContain("@string");
    expect(offered).toContain("@preamble");
    expect(offered).toContain("@comment");
  });

  it("replaces the typed @ so the query matches the label", () => {
    const result = completion("@art");
    expect(result?.from).toBe(0);
    expect(option(result, "@article").detail).toBe("BibTeX entry");
    expect(option(result, "@string").detail).toBe("BibTeX directive");
  });

  it("offers entries after leading whitespace and on a later line", () => {
    expect(labels(completion("@misc{m, title = {T}}\n\n  @bo"))).toContain(
      "@book",
    );
  });

  it("stays quiet in ordinary text and mid line", () => {
    expect(completion("some prose")).toBeNull();
    expect(completion("title = {name@dom")).toBeNull();
  });

  it("inserts the skeleton of the chosen type with the caret in the key", () => {
    const view = viewFor("@art");
    const context = new CompletionContext(view.state, 4, false);
    const result = bibtexCompletions(context);
    const article = option(result, "@article");
    const apply = article.apply;
    if (typeof apply !== "function") throw new Error("expected a snippet");

    apply(view, article, result?.from ?? 0, 4);

    expect(view.state.doc.toString()).toBe(
      [
        "@article{key,",
        "  author = {author},",
        "  title = {title},",
        "  journal = {journal},",
        "  year = {year},",
        "}",
      ].join("\n"),
    );
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("key");
  });

  it("gives a type with no required fields a single placeholder", () => {
    const view = viewFor("@mis");
    const context = new CompletionContext(view.state, 4, false);
    const result = bibtexCompletions(context);
    const misc = option(result, "@misc");
    const apply = misc.apply;
    if (typeof apply !== "function") throw new Error("expected a snippet");

    apply(view, misc, result?.from ?? 0, 4);

    expect(view.state.doc.toString()).toBe("@misc{key,\n  \n}");
  });
});

describe("BibTeX field completion", () => {
  it("offers the fields of the enclosing entry type", () => {
    const offered = labels(completion("@article{k,\n  au"));
    expect(offered).toContain("author");
    expect(offered).toContain("journal");
    expect(offered).toContain("journaltitle");
    expect(offered).toContain("volume");
    expect(offered).not.toContain("booktitle");
  });

  it("separates required fields from optional ones", () => {
    const result = completion("@article{k,\n  ");
    expect(option(result, "author").detail).toBe("required field");
    expect(option(result, "volume").detail).toBe("optional field");
    expect(option(result, "author").type).toBe("property");
  });

  it("replaces only the partly typed field name", () => {
    const source = "@article{k,\n  au";
    expect(completion(source)?.from).toBe(source.length - 2);
  });

  it("inserts the field with an empty braced value", () => {
    const view = viewFor("@article{k,\n  au");
    const context = new CompletionContext(
      view.state,
      view.state.doc.length,
      false,
    );
    const result = bibtexCompletions(context);
    const author = option(result, "author");
    const apply = author.apply;
    if (typeof apply !== "function") throw new Error("expected a snippet");

    apply(view, author, result?.from ?? 0, view.state.doc.length);

    expect(view.state.doc.toString()).toBe("@article{k,\n  author = {}");
  });

  it("stays quiet inside a field value, at the key, and after the entry", () => {
    expect(completion("@article{k,\n  title = {A, B")).toBeNull();
    expect(completion('@article{k,\n  title = "A, B')).toBeNull();
    expect(completion("@article{k")).toBeNull();
    expect(completion("@article{k,\n  title = {T},\n}\n\nau")).toBeNull();
  });

  it("stays quiet for an entry type it does not know", () => {
    expect(completion("@nope{k,\n  au")).toBeNull();
  });
});
