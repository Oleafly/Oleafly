// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { Breadcrumbs } from "./Breadcrumbs";
import { setEditorView } from "./cm/controller";

const DOC = ["\\section{Methods}", "Intro.", "\\subsection{}", "Body text."].join("\n");

let view: EditorView | null = null;

function mountEditor(head: number) {
  view = new EditorView({
    state: EditorState.create({ doc: DOC, selection: { anchor: head } }),
    parent: document.body,
  });
  setEditorView(view);
}

afterEach(() => {
  setEditorView(null);
  view?.destroy();
  view = null;
});

describe("Breadcrumbs", () => {
  it("renders nothing without an open file", () => {
    useFilesStore.setState({ activePath: null });
    const { container } = render(<Breadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the file alone while no editor is mounted", () => {
    useFilesStore.setState({ activePath: "chapters/intro.tex" });
    render(<Breadcrumbs />);
    const nav = screen.getByRole("navigation", { name: en.breadcrumbs.label });
    expect(nav).toHaveTextContent("intro.tex");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("lists the sections around the cursor and jumps to one on click", () => {
    useFilesStore.setState({ activePath: "chapters/intro.tex" });
    mountEditor(DOC.indexOf("Body"));
    render(<Breadcrumbs />);
    const methods = screen.getByRole("button", { name: "Methods" });
    expect(methods).toHaveAttribute("title", en.breadcrumbs.goTo.replace("{{title}}", "Methods"));
    expect(screen.getByRole("button", { name: en.breadcrumbs.untitled })).toBeInTheDocument();

    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    methods.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    fireEvent.click(methods);
    expect(view?.state.selection.main.head).toBe(DOC.indexOf("Methods"));
  });
});
