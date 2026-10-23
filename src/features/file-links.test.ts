// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor as TiptapEditor } from "@tiptap/core";
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setEditorView } from "@/components/editor/cm/controller";
import { setWysiwygEditor, setWysiwygVisible } from "@/components/editor/wysiwyg/controller";
import { useFilesStore } from "@/store/files";
import {
  canInsertFileLink,
  copyFileLink,
  insertFileLink,
  localizedVisualHref,
  openVisualLinkHref,
  startFileLinkInsertion,
} from "./file-links";

const openProjectLocation = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/open-location", () => ({ openProjectLocation }));

const views: EditorView[] = [];

function source(activePath: string, doc: string): EditorView {
  useFilesStore.setState({ projectId: "links", activePath, mainDoc: "main.tex" });
  const from = doc.indexOf("[");
  const to = doc.indexOf("]");
  const text = doc.replace("[", "").replace("]", "");
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc: text, selection: from < 0 ? { anchor: text.length } : { anchor: from, head: to - 1 } }),
  });
  views.push(view);
  setEditorView(view);
  return view;
}

function withCursor(view: EditorView): string {
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  setEditorView(null);
  setWysiwygVisible(false);
  setWysiwygEditor(null);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  useFilesStore.setState({ projectId: null, activePath: null, mainDoc: "" });
});

describe("Insert link from the Files panel", () => {
  it("is offered only while a Markdown, Typst or LaTeX document is open", () => {
    expect(canInsertFileLink("notes/a.md")).toBe(true);
    expect(canInsertFileLink("main.typ")).toBe(true);
    expect(canInsertFileLink("refs.bib")).toBe(false);
    expect(canInsertFileLink(null)).toBe(false);
  });

  it("uses the selected words as the link text", () => {
    const view = source("notes/index.md", "Read [the plan] today.");
    expect(insertFileLink("notes/plan.md")).toBe(true);
    expect(withCursor(view)).toBe("Read [the plan](plan.md)| today.");
  });

  it("names the link after the file when nothing is selected", () => {
    const view = source("chapters/one.typ", "See ");
    expect(insertFileLink("data/a.csv")).toBe(true);
    expect(view.state.doc.toString()).toBe('See #link("../data/a.csv")[a]');
  });

  it("does nothing without an editable document", () => {
    useFilesStore.setState({ projectId: "links", activePath: "refs.bib", mainDoc: "main.tex" });
    expect(insertFileLink("notes/plan.md")).toBe(false);
  });

  it("adds a link mark in Visual mode", () => {
    useFilesStore.setState({ projectId: "links", activePath: "notes/index.md", mainDoc: "main.tex" });
    const editor = new TiptapEditor({
      element: document.body.appendChild(document.createElement("div")),
      extensions: createWysiwygExtensions(),
      content: "<p>See it</p>",
    });
    editor.commands.setTextSelection(5);
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);
    expect(insertFileLink("notes/Сведения о.md")).toBe(true);
    expect(editor.storage.markdown.getMarkdown()).toBe("See [Сведения о](<Сведения о.md>)it");
    editor.destroy();
  });
});

describe("Copy link from the Files panel", () => {
  it("copies the link the open document would use", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    source("chapters/one.typ", "");
    expect(await copyFileLink("chapters/two.typ")).toBe(true);
    expect(writeText).toHaveBeenLastCalledWith('#link("two.typ")[two]');
    useFilesStore.setState({ activePath: "refs.bib" });
    expect(await copyFileLink("notes/a b.md")).toBe(true);
    expect(writeText).toHaveBeenLastCalledWith("[a b](<notes/a b.md>)");
  });

  it("reports a clipboard that refuses the write", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    expect(await copyFileLink("notes/a.md")).toBe(false);
  });
});

describe("Insert link to file from the command palette", () => {
  it.each([
    ["notes/index.md", "Read [the plan]", "Read [the plan](|)"],
    ["chapters/one.typ", "See ", 'See #link("|")[]'],
    ["chapters/one.tex", "See ", String.raw`See \href{|}{}`],
  ])("puts the cursor where %s takes the file", (path, doc, expected) => {
    const view = source(path, doc);
    expect(startFileLinkInsertion()).toBe(true);
    expect(withCursor(view)).toBe(expected);
  });
});

describe("following a link from Visual mode", () => {
  it("opens the project file a link points at, and nothing for a missing file", () => {
    openProjectLocation.mockClear();
    useFilesStore.setState({
      activePath: "notes/index.md",
      mainDoc: "main.tex",
      tree: [{ path: "notes/my plan.md", is_dir: false }, { path: "Св.md", is_dir: false }, { path: "notes", is_dir: true }],
    });
    expect(openVisualLinkHref("my%20plan.md#Goals")).toBe(true);
    expect(openProjectLocation).toHaveBeenLastCalledWith({ path: "notes/my plan.md" });
    expect(openVisualLinkHref("http://tauri.localhost/%D0%A1%D0%B2.md")).toBe(true);
    expect(openProjectLocation).toHaveBeenLastCalledWith({ path: "Св.md" });
    expect(openVisualLinkHref("gone.md")).toBe(false);
    expect(openVisualLinkHref("../notes")).toBe(false);
    expect(openVisualLinkHref("https://example.com/a.md")).toBe(false);
    expect(openProjectLocation).toHaveBeenCalledTimes(2);
  });

  it("measures a LaTeX file's links from the main document", () => {
    useFilesStore.setState({ activePath: "chapters/one.tex", mainDoc: "main.tex" });
    expect(localizedVisualHref("http://tauri.localhost/data/a%20b.csv")).toBe("data/a%20b.csv");
    useFilesStore.setState({ activePath: "notes/index.md" });
    expect(localizedVisualHref("http://tauri.localhost/data/a%20b.csv")).toBe("../data/a%20b.csv");
    expect(localizedVisualHref("https://example.com/x")).toBeNull();
  });
});
