// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions, serializeLatexBody } from "@oleafly/wysiwyg";
import { insertVisualTable } from "./insert";
import { tableFloatPosition } from "./table-commands";
import { TableToolbar } from "./TableToolbar";

let editors: Editor[] = [];

function mountTable(): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions(),
    content: "<p>Before</p>",
    editorProps: { handleScrollToSelection: () => true },
  });
  editors.push(editor);
  editor.commands.setTextSelection(7);
  insertVisualTable(editor.view, 2, 2, "horizontal");
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") cells.push(pos);
    return true;
  });
  editor.commands.setTextSelection(cells[3] + 2);
  return editor;
}

function renderToolbar(editor: Editor) {
  const position = tableFloatPosition(editor.state);
  if (position === null) throw new Error("selection is not inside a table");
  return render(<TableToolbar editor={editor} position={position} />);
}

function latexOf(editor: Editor): string {
  return serializeLatexBody(editor.getJSON());
}

afterEach(() => {
  cleanup();
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("TableToolbar", () => {
  it("inserts rows and columns from the buttons", () => {
    const editor = mountTable();
    renderToolbar(editor);
    act(() => {
      fireEvent.click(screen.getByLabelText("Insert row below"));
      fireEvent.click(screen.getByLabelText("Insert column right"));
    });
    const latex = latexOf(editor);
    expect(latex).toContain("\\begin{tabular}{lll}");
    expect(latex.match(/\\\\/gu)).toHaveLength(3);
  });

  it("changes the border preset, caption placement and label", () => {
    const editor = mountTable();
    renderToolbar(editor);
    act(() => {
      fireEvent.change(screen.getByLabelText("Borders"), { target: { value: "booktabs" } });
    });
    expect(latexOf(editor)).toContain("\\toprule");
    expect((screen.getByLabelText("Borders") as HTMLSelectElement).value).toBe("booktabs");
    act(() => {
      fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "below" } });
    });
    const latex = latexOf(editor);
    expect(latex.indexOf("\\caption{}")).toBeGreaterThan(latex.indexOf("\\end{tabular}"));
    const label = screen.getByLabelText("Label") as HTMLInputElement;
    act(() => {
      fireEvent.change(label, { target: { value: "tab:results" } });
      fireEvent.keyDown(label, { key: "Enter" });
    });
    expect(latexOf(editor)).toContain("\\label{tab:results}");
  });

  it("reflects the column alignment and header state as pressed buttons", () => {
    const editor = mountTable();
    renderToolbar(editor);
    expect(screen.getByLabelText("Align column left")).toHaveAttribute("aria-pressed", "true");
    act(() => {
      fireEvent.click(screen.getByLabelText("Align column center"));
    });
    expect(screen.getByLabelText("Align column center")).toHaveAttribute("aria-pressed", "true");
    expect(latexOf(editor)).toContain("\\begin{tabular}{lc}");
    expect(screen.getByLabelText("Header row")).toHaveAttribute("aria-pressed", "true");
    act(() => {
      fireEvent.click(screen.getByLabelText("Header row"));
    });
    expect(screen.getByLabelText("Header row")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Merge cells")).toBeDisabled();
    expect(screen.getByLabelText("Split cell")).toBeDisabled();
  });

  it("deletes the table", () => {
    const editor = mountTable();
    renderToolbar(editor);
    act(() => {
      fireEvent.click(screen.getByLabelText("Delete table"));
    });
    expect(latexOf(editor)).toBe("Before\n");
  });
});
