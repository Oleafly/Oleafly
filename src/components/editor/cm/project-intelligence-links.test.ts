// @vitest-environment jsdom

import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath } from "@oleafly/editor";
import { afterEach, describe, expect, it } from "vitest";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { projectIntelligenceCompletion } from "./project-intelligence";
import { stubRangeGeometry } from "../../../../packages/editor/src/test-geometry";

stubRangeGeometry();

const FILES = [
  "main.tex",
  "notes/index.md",
  "notes/plan.md",
  "notes/Сведения о земельном участке.md",
  "chapters/one.typ",
  "chapters/two.typ",
  "img/map.png",
  ".oleafly/build/main.pdf",
];

const views: EditorView[] = [];

function viewFor(active: string, doc: string): EditorView {
  const cursor = doc.indexOf("|");
  const text = cursor < 0 ? doc : doc.slice(0, cursor) + doc.slice(cursor + 1);
  useFilesStore.setState({
    projectId: "links",
    activePath: active,
    mainDoc: "main.tex",
    tree: FILES.map((path) => ({ path, is_dir: false })),
    files: { [active]: { content: text, dirty: false } },
  });
  setEditorDocumentPath(active);
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc: text, selection: { anchor: cursor < 0 ? doc.length : cursor } }),
  });
  views.push(view);
  return view;
}

function complete(view: EditorView, explicit: boolean): CompletionResult | null {
  const value = projectIntelligenceCompletion(new CompletionContext(view.state, view.state.selection.main.head, explicit));
  if (value && typeof (value as Promise<unknown>).then === "function") throw new Error("expected a synchronous result");
  return value as CompletionResult | null;
}

function validForOf(result: CompletionResult | null): RegExp {
  if (!(result?.validFor instanceof RegExp)) throw new Error("expected a validFor pattern");
  return result.validFor;
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => String(option.label));
}

function accept(view: EditorView, result: CompletionResult | null, label: string) {
  const option = result?.options.find((candidate) => candidate.label === label);
  if (!result || typeof option?.apply !== "function") throw new Error(`missing ${label}`);
  option.apply(view, option, result.from, view.state.selection.main.head);
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
  setEditorDocumentPath(null);
  useIndexStore.getState().reset();
  useFilesStore.setState({ projectId: null, activePath: null, files: {}, tree: [], mainDoc: "" });
});

describe("Ctrl+Space in a Markdown link destination", () => {
  it("lists project files relative to the note, but only when asked", () => {
    const view = viewFor("notes/index.md", "See [land](|)");
    expect(labels(complete(view, true))).toEqual(
      expect.arrayContaining(["plan.md", "Сведения о земельном участке.md", "../img/map.png", "../chapters/one.typ"]),
    );
    expect(labels(complete(view, true))).not.toContain("index.md");
    expect(labels(complete(view, true))).not.toContain("../.oleafly/build/main.pdf");
    expect(labels(complete(view, false))).toEqual([]);
  });

  it("writes angle brackets for a name with spaces", () => {
    const view = viewFor("notes/index.md", "See [land](Свед|)");
    const result = complete(view, true);
    expect(result?.from).toBe("See [land](".length);
    expect(accept(view, result, "Сведения о земельном участке.md")).toBe(
      "See [land](<Сведения о земельном участке.md>|)",
    );
  });

  it("writes the bare name inside an angle-bracket destination", () => {
    const view = viewFor("notes/index.md", "[land](<Свед|>)");
    expect(accept(view, complete(view, true), "Сведения о земельном участке.md")).toBe(
      "[land](<Сведения о земельном участке.md|>)",
    );
  });

  it("names an empty link after the chosen file", () => {
    const view = viewFor("notes/index.md", "[](|)");
    expect(accept(view, complete(view, true), "plan.md")).toBe("[plan](plan.md|)");
  });

  it("stays out of web addresses and leaves heading anchors to their own completion", () => {
    expect(labels(complete(viewFor("notes/index.md", "[x](https:|)"), true))).not.toContain("plan.md");
    expect(labels(complete(viewFor("notes/index.md", "[x](#|)"), true))).not.toContain("plan.md");
  });
});

describe("Ctrl+Space in a Typst link", () => {
  it("lists every project file relative to the file, but only when asked", () => {
    const view = viewFor("chapters/one.typ", '#link("|")[]');
    expect(labels(complete(view, true))).toEqual(
      expect.arrayContaining(["two.typ", "../notes/plan.md", "../img/map.png"]),
    );
    expect(labels(complete(view, false))).not.toContain("two.typ");
  });

  it("fills the empty link text with the file name", () => {
    const view = viewFor("chapters/one.typ", '#link("|")[]');
    expect(accept(view, complete(view, true), "two.typ")).toBe('#link("two.typ")[two]|');
  });

  it("leaves web addresses alone", () => {
    expect(labels(complete(viewFor("chapters/one.typ", '#link("https:|")'), true))).not.toContain("two.typ");
  });
});

describe("Ctrl+Space in a LaTeX \\href", () => {
  it("lists project files relative to the main document, but only when asked", () => {
    const view = viewFor("chapters/one.tex", String.raw`\href{|}{}`);
    expect(labels(complete(view, true))).toEqual(expect.arrayContaining(["notes/plan.md", "img/map.png"]));
    expect(labels(complete(view, false))).not.toContain("notes/plan.md");
  });

  it("fills the empty link text with the escaped file name", () => {
    const view = viewFor("chapters/one.tex", String.raw`\href{|}{}`);
    expect(accept(view, complete(view, true), "notes/plan.md")).toBe(String.raw`\href{notes/plan.md}{plan}|`);
  });

  it("keeps the list open and filtering while the path is typed after Ctrl+Space", () => {
    const validFor = validForOf(complete(viewFor("chapters/one.tex", String.raw`\href{no|}{}`), true));
    expect(validFor.test("notes/pl")).toBe(true);
    expect(validFor.test("notes/plan.md")).toBe(true);
    expect(validFor.test("notes}")).toBe(false);
    expect(validFor.test("notes plan")).toBe(false);
  });
});

describe("Ctrl+Space in a Markdown link", () => {
  it("keeps the list open while the path is typed, spaces included inside angle brackets", () => {
    const plain = validForOf(complete(viewFor("notes/index.md", "[plan](pl|)"), true));
    expect(plain.test("plan.md")).toBe(true);
    expect(plain.test("plan md")).toBe(false);
    const angle = validForOf(complete(viewFor("notes/index.md", "[land](<Св|>)"), true));
    expect(angle.test("Сведения о")).toBe(true);
  });
});
