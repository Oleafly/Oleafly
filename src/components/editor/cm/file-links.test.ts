// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TREE_DRAG_TYPE } from "@/lib/tree-drag";
import { useFilesStore } from "@/store/files";
import { setEditorView } from "./controller";
import { appLinkInsertion, fileLinkInsertion, projectFileLinksExtension } from "./file-links";

const views: EditorView[] = [];

function withoutCursor(doc: string, cursor: number): string {
  return cursor < 0 ? doc : doc.slice(0, cursor) + doc.slice(cursor + 1);
}

function open(activePath: string, doc: string, mainDoc = "main.tex"): EditorView {
  useFilesStore.setState({ projectId: "links", activePath, mainDoc });
  const cursor = doc.indexOf("|");
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: withoutCursor(doc, cursor),
      selection: { anchor: cursor < 0 ? doc.length : cursor },
      extensions: [projectFileLinksExtension()],
    }),
  });
  views.push(view);
  setEditorView(view);
  return view;
}

function insertion(activePath: string, doc: string, target: string, embedImages = false, mainDoc = "main.tex") {
  const view = open(activePath, doc, mainDoc);
  return fileLinkInsertion(view.state, view.state.selection.main.head, linkLanguage(activePath), target, {
    fromFile: activePath,
    mainDoc,
  }, { embedImages });
}

function linkLanguage(path: string) {
  if (path.endsWith(".md")) return "markdown" as const;
  return path.endsWith(".typ") ? ("typst" as const) : ("latex" as const);
}

function transfer(data: Record<string, string>) {
  return { types: Object.keys(data), getData: (type: string) => data[type] ?? "", files: [] };
}

function drop(view: EditorView, path: string): boolean {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: transfer({ "text/plain": path, [TREE_DRAG_TYPE]: path }), clientX: 0, clientY: 0 });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

function paste(view: EditorView, text: string): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: transfer({ "text/plain": text }) });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  setEditorView(null);
  document.body.replaceChildren();
  useFilesStore.setState({ projectId: null, activePath: null, mainDoc: "", tree: [] });
});

describe("a file dropped from the Files panel", () => {
  it("becomes a Markdown link relative to the note, or an image for a picture", () => {
    expect(insertion("notes/index.md", "See |", "notes/Сведения о земельном участке.md")).toEqual({
      kind: "text",
      text: "[Сведения о земельном участке](<Сведения о земельном участке.md>)",
    });
    expect(insertion("notes/index.md", "|", "img/map.png", true)).toEqual({ kind: "text", text: "![map](../img/map.png)" });
    expect(insertion("notes/index.md", "|", "img/map.png", false)).toEqual({ kind: "text", text: "[map](../img/map.png)" });
  });

  it("fills only the destination when it lands inside one", () => {
    expect(insertion("notes/index.md", "[land](|", "notes/a b.md")).toEqual({ kind: "text", text: "<a b.md>" });
    expect(insertion("notes/index.md", "[land](<|", "notes/a b.md")).toEqual({ kind: "text", text: "a b.md" });
  });

  it("becomes a Typst link, a figure for a picture, or a bare path inside a string", () => {
    expect(insertion("chapters/one.typ", "Text |", "chapters/two.typ")).toEqual({ kind: "text", text: '#link("two.typ")[two]' });
    expect(insertion("chapters/one.typ", "#{ let target = |}", "data/a.csv")).toEqual({
      kind: "text",
      text: 'link("../data/a.csv")[a]',
    });
    expect(insertion("chapters/one.typ", '#image("|")', "img/a.png", true)).toEqual({ kind: "text", text: "../img/a.png" });
    expect(insertion("chapters/one.typ", "|", "img/a.png", true)).toEqual({ kind: "figure" });
  });

  it("keeps the bare path inside a LaTeX file command and links everywhere else", () => {
    expect(insertion("chapters/one.tex", String.raw`\includegraphics[width=3cm]{|}`, "img/a.png", true)).toEqual({
      kind: "text",
      text: "img/a.png",
    });
    expect(insertion("chapters/one.tex", String.raw`\input{|}`, "chapters/two.tex", true)).toEqual({
      kind: "text",
      text: "chapters/two.tex",
    });
    expect(insertion("chapters/one.tex", "See |", "data/notes.txt", true)).toEqual({
      kind: "text",
      text: String.raw`\href{data/notes.txt}{notes}`,
    });
    expect(insertion("chapters/one.tex", "|", "img/a.png", true)).toEqual({ kind: "figure" });
  });

  it("inserts at the drop point instead of the plain project path", () => {
    const view = open("notes/index.md", "See .");
    vi.spyOn(view, "posAtCoords").mockReturnValue(4);
    expect(drop(view, "notes/plan.md")).toBe(true);
    expect(view.state.doc.toString()).toBe("See [plan](plan.md).");
  });

  it("adds a figure for a picture dropped into LaTeX", async () => {
    const view = open("main.tex", "|");
    expect(drop(view, "figures/plot.png")).toBe(true);
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain(String.raw`\includegraphics`));
    expect(view.state.doc.toString()).toContain("figures/plot.png");
  });

  it("leaves ordinary text drops and other file types to the editor", () => {
    const view = open("refs.bib", "|");
    expect(drop(view, "notes/plan.md")).toBe(false);
    const markdown = open("notes/index.md", "|");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: transfer({ "text/plain": "hello" }) });
    markdown.contentDOM.dispatchEvent(event);
    expect(markdown.state.doc.toString()).not.toContain("](");
  });

  it("does not edit a read-only document", () => {
    useFilesStore.setState({ projectId: "links", activePath: "notes/index.md", mainDoc: "main.tex" });
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({ doc: "", extensions: [projectFileLinksExtension(), EditorState.readOnly.of(true)] }),
    });
    views.push(view);
    drop(view, "notes/plan.md");
    expect(view.state.doc.toString()).toBe("");
  });
});

describe("a link pasted from the preview", () => {
  it("turns the app origin into a path relative to the note", () => {
    const view = open("notes/index.md", "See [land](|)");
    expect(paste(view, "http://tauri.localhost/notes/%D0%A1%D0%B2%20%D0%BE.md")).toBe(true);
    expect(view.state.doc.toString()).toBe("See [land](<Св о.md>)");
  });

  it("writes a link outside a destination and leaves other URLs alone", () => {
    const view = open("notes/index.md", "|");
    // A bare path is only text in Markdown; the paste was a link, so it stays one.
    expect(appLinkInsertion(view.state, 0, "tauri://localhost/img/a.png")).toBe("[a](../img/a.png)");
    expect(appLinkInsertion(view.state, 0, "http://tauri.localhost/notes/%D0%A1%D0%B2%20%D0%BE.md#%D0%BF%D0%BB%D0%B0%D0%BD")).toBe(
      "[Св о](<Св о.md#план>)",
    );
    expect(appLinkInsertion(view.state, 0, "https://example.com/a.md")).toBeNull();
    expect(appLinkInsertion(view.state, 0, "two words")).toBeNull();
    paste(view, "https://example.com/a.md");
    expect(view.state.doc.toString()).toBe("https://example.com/a.md");
  });

  it("uses the main document's folder in LaTeX and escapes Typst strings", () => {
    const latex = open("chapters/one.tex", "|", "main.tex");
    expect(appLinkInsertion(latex.state, 0, "http://tauri.localhost/img/a.png")).toBe(String.raw`\href{img/a.png}{a}`);
    const inCommand = open("chapters/one.tex", String.raw`\includegraphics{|}`, "main.tex");
    expect(appLinkInsertion(inCommand.state, 17, "http://tauri.localhost/img/a.png")).toBe("img/a.png");
    const typst = open("chapters/one.typ", '#link("|")');
    expect(appLinkInsertion(typst.state, 7, 'http://tauri.localhost/data/a%22b.txt')).toBe(String.raw`../data/a\"b.txt`);
    const typstText = open("chapters/one.typ", "See |");
    expect(appLinkInsertion(typstText.state, 4, "tauri://localhost/data/plan.typ")).toBe('#link("../data/plan.typ")[plan]');
  });
});

describe("a link dragged from the preview", () => {
  function dropUrl(view: EditorView, data: Record<string, string>): void {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: transfer(data), clientX: 0, clientY: 0 });
    view.contentDOM.dispatchEvent(event);
  }

  it("lands as a relative link, not the app's address", () => {
    const view = open("notes/index.md", "See |");
    dropUrl(view, {
      "text/uri-list": "# dragged\r\nhttp://tauri.localhost/%D0%A1%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D1%8F.md",
      "text/plain": "http://tauri.localhost/%D0%A1%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D1%8F.md",
    });
    expect(view.state.doc.toString()).toContain("[Сведения](<../Сведения.md>)");
    expect(view.state.doc.toString()).not.toContain("tauri.localhost");
  });

  it("leaves links to other sites to the editor", () => {
    const view = open("notes/index.md", "See |");
    dropUrl(view, { "text/uri-list": "https://example.com/a.md", "text/plain": "https://example.com/a.md" });
    expect(view.state.doc.toString()).not.toContain("](");
  });
});
