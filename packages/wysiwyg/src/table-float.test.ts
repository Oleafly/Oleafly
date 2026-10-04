// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("TableFloat node view state", () => {
  function floatElement(element: HTMLElement): HTMLElement {
    return element.querySelector<HTMLElement>('[data-type="table-float"]') as HTMLElement;
  }

  function labelField(element: HTMLElement): HTMLInputElement {
    return element.querySelector<HTMLInputElement>("input.table-float-label") as HTMLInputElement;
  }

  function setFloatAttrs(editor: Editor, attrs: Record<string, unknown>) {
    const node = editor.state.doc.child(0);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, ...attrs }));
  }

  it("shows a caption placed below and a table that does not float", () => {
    const float = createTableFloat(1, 1);
    float.attrs = { ...float.attrs, captionPosition: "below", floating: false };
    const { element } = mount(float);

    expect(floatElement(element).dataset.captionPosition).toBe("below");
    expect(floatElement(element).dataset.floating).toBe("false");
    expect(labelField(element).value).toBe("");
  });

  it("follows label changes made elsewhere", () => {
    const { editor, element } = mount(createTableFloat(1, 1));

    setFloatAttrs(editor, { label: "tab:external", floating: false });

    expect(labelField(element).value).toBe("tab:external");
    expect(floatElement(element).dataset.floating).toBe("false");
  });

  it("keeps what the user is typing in the label field while the document changes", () => {
    const { editor, element } = mount(createTableFloat(1, 1));
    const label = labelField(element);
    label.focus();
    label.value = "tab:typing";

    setFloatAttrs(editor, { label: "tab:other", captionPosition: "below" });

    expect(label.value).toBe("tab:typing");
    expect(floatElement(element).dataset.captionPosition).toBe("below");
  });

  it("clears the label when the field is emptied", () => {
    const float = createTableFloat(1, 1);
    float.attrs = { ...float.attrs, label: "tab:old" };
    const { editor, element } = mount(float);
    const label = labelField(element);

    label.value = "   ";
    label.dispatchEvent(new Event("change"));

    expect(editor.state.doc.child(0).attrs.label).toBeNull();
  });

  it("keeps focus in the label field for ordinary keys", () => {
    const { element } = mount(createTableFloat(1, 1));
    const label = labelField(element);
    label.focus();

    label.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(document.activeElement).toBe(label);
  });

  it("adds at most one caption", () => {
    const { editor, element } = mount(createTableFloat(1, 1));
    const addCaption = element.querySelector<HTMLButtonElement>(".table-float-add-caption") as HTMLButtonElement;

    addCaption.click();
    addCaption.click();

    const children: string[] = [];
    editor.state.doc.child(0).forEach((child) => children.push(child.type.name));
    expect(children).toEqual(["table", "tableCaption"]);
  });

  it("keeps the label and caption controls away from the editor's key handling", () => {
    const handleKeyDown = vi.fn((_view: unknown, _event: KeyboardEvent) => false);
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: WYSIWYG_EXTENSIONS,
      editorProps: { handleKeyDown },
      content: { type: "doc", content: [createTableFloat(1, 1)] },
    });
    editors.push(editor);
    const press = (target: EventTarget, key: string) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    press(labelField(element), "a");
    press(element.querySelector(".table-float-add-caption") as HTMLElement, "b");
    expect(handleKeyDown).not.toHaveBeenCalled();

    press(element.querySelector("td, th") as HTMLElement, "c");
    expect(handleKeyDown.mock.calls.map(([, event]) => event.key)).toEqual(["c"]);
  });

  it("keeps its node view when only the controls change in the DOM", async () => {
    const { element } = mount(createTableFloat(1, 1));
    const before = floatElement(element);
    const label = labelField(element);
    label.value = "tab:draft";
    label.setAttribute("data-draft", "true");

    await Promise.resolve();

    expect(floatElement(element)).toBe(before);
    expect(labelField(element).value).toBe("tab:draft");
  });

  it("parses a float from HTML that carries no column spec", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: WYSIWYG_EXTENSIONS,
      content: '<div data-type="table-float"><table><tbody><tr><td><p>a</p></td></tr></tbody></table></div>',
    });
    editors.push(editor);

    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "tableFloat", attrs: { columns: [] } });
  });
});
