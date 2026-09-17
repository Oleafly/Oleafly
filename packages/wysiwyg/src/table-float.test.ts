// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { parseLatexBody } from "./latex/parse";
import { WYSIWYG_EXTENSIONS } from "./schema";
import { createTableFloat } from "./table-float";

let editors: Editor[] = [];

function mount(node: JSONContent): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: WYSIWYG_EXTENSIONS, content: { type: "doc", content: [node] } });
  editors.push(editor);
  return { editor, element };
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("createTableFloat", () => {
  it("builds a header row with booktabs rules and default columns", () => {
    const float = createTableFloat(3, 2);
    const rows = float.content?.[0].content ?? [];
    expect(rows.map((row) => row.attrs)).toEqual([
      { borderTop: "toprule", borderBottom: null },
      { borderTop: "midrule", borderBottom: null },
      { borderTop: null, borderBottom: "bottomrule" },
    ]);
    expect(rows[0].content?.map((cell) => cell.type)).toEqual(["tableHeader", "tableHeader"]);
    expect(rows[1].content?.map((cell) => cell.type)).toEqual(["tableCell", "tableCell"]);
    expect(float.attrs?.columns).toHaveLength(2);
  });
});

describe("TableFloat", () => {
  it("renders the table with controls for the label and caption", () => {
    const { editor, element } = mount(createTableFloat(2, 2));
    const node = element.querySelector<HTMLElement>('[data-type="table-float"]');
    expect(node?.dataset.captionPosition).toBe("above");
    expect(node?.querySelector("table")).not.toBeNull();
    const label = node?.querySelector<HTMLInputElement>("input.table-float-label");
    if (!label) throw new Error("label missing");
    label.value = "tab:x";
    label.dispatchEvent(new Event("change"));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.label).toBe("tab:x");

    const addCaption = node?.querySelector<HTMLButtonElement>(".table-float-add-caption");
    expect(addCaption?.hidden).toBe(false);
    addCaption?.click();
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[1].type).toBe("tableCaption");
    expect(node?.querySelector<HTMLButtonElement>(".table-float-add-caption")?.hidden).toBe(true);
    editor.commands.insertContent("Caption text");
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[1].content?.[0].text).toBe("Caption text");
  });

  it("renders row rules and column specs as data attributes and round-trips through HTML", () => {
    const parsed = parseLatexBody(
      "\\begin{table}[h]\n\\centering\n\\caption{T}\n\\begin{tabular}{|l|r|}\n\\hline\na & \\multicolumn{1}{c}{b} \\\\\n\\hline\n\\end{tabular}\n\\label{tab:t}\n\\end{table}\n",
    );
    const { editor, element } = mount(parsed.content?.[0] ?? { type: "paragraph" });
    const html = editor.getHTML();
    expect(html).toContain('data-columns="|l|r|"');
    expect(html).toContain('data-border-top="hline"');
    expect(html).toContain('data-column-spec="c"');
    expect(element.querySelector<HTMLElement>('[data-type="table-float"]')?.dataset.captionPosition).toBe("above");
    const reparsed = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: html });
    editors.push(reparsed);
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });
});

describe("TableFloat controls", () => {
  it("returns focus to the editor from the label field on Enter or Escape", () => {
    const { element } = mount(createTableFloat(1, 1));
    const label = element.querySelector<HTMLInputElement>("input.table-float-label");
    if (!label) throw new Error("label missing");
    label.focus();
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(document.activeElement).not.toBe(label);
    label.focus();
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).not.toBe(label);
  });
});
