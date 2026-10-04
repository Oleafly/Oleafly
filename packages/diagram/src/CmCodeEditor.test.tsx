// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CmCodeEditor, type CmHandle } from "./CmCodeEditor";

function mount(value: string, extensions?: Parameters<typeof CmCodeEditor>[0]["extensions"]) {
  const ref = createRef<CmHandle>();
  const onChange = vi.fn();
  const view = render(<CmCodeEditor ref={ref} value={value} onChange={onChange} extensions={extensions} />);
  const editor = () => EditorView.findFromDOM(view.container.querySelector(".cm-editor") as HTMLElement) as EditorView;
  return { ref, onChange, editor, ...view };
}

function select(view: EditorView, anchor: number, head = anchor) {
  act(() => view.dispatch({ selection: { anchor, head } }));
}

afterEach(() => {
  cleanup();
});

describe("CmCodeEditor", () => {
  it("shows the value and reports what the user types", () => {
    const { editor, onChange } = mount("flowchart TD");
    expect(editor().state.doc.toString()).toBe("flowchart TD");
    expect(onChange).not.toHaveBeenCalled();
    act(() => editor().dispatch({ changes: { from: 12, insert: "\n  a --> b" } }));
    expect(onChange).toHaveBeenCalledWith("flowchart TD\n  a --> b");
  });

  it("takes a new value from its parent without echoing it back", async () => {
    const { editor, onChange, rerender, ref } = mount("first");
    rerender(<CmCodeEditor ref={ref} value="second value" onChange={onChange} />);
    expect(editor().state.doc.toString()).toBe("second value");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => editor().dispatch({ changes: { from: 0, insert: ">" } }));
    expect(onChange).toHaveBeenCalledWith(">second value");
  });

  it("keeps the caret when the parent echoes the same value and uses the newest callback", () => {
    const { editor, onChange, rerender, ref } = mount("abc");
    select(editor(), 2);
    const latest = vi.fn();
    rerender(<CmCodeEditor ref={ref} value="abc" onChange={latest} />);
    expect(editor().state.selection.main.head).toBe(2);
    act(() => editor().dispatch({ changes: { from: 3, insert: "d" } }));
    expect(latest).toHaveBeenCalledWith("abcd");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("inserts over the selection and leaves the caret after the text", () => {
    const { editor, onChange, ref } = mount("node A");
    select(editor(), 5, 6);
    act(() => ref.current?.insert("Box"));
    expect(editor().state.doc.toString()).toBe("node Box");
    expect(editor().state.selection.main.head).toBe(8);
    expect(onChange).toHaveBeenLastCalledWith("node Box");
    expect(editor().hasFocus).toBe(true);
  });

  it("wraps the selection and puts the caret after the wrapped text", () => {
    const { editor, ref } = mount("hello world");
    select(editor(), 6, 11);
    act(() => ref.current?.wrap(String.raw`\textbf{`, "}"));
    expect(editor().state.doc.toString()).toBe(String.raw`hello \textbf{world}`);
    expect(editor().state.selection.main.head).toBe(19);
  });

  it("wraps an empty selection with the caret between the markers", () => {
    const { editor, ref } = mount("x");
    select(editor(), 1);
    act(() => ref.current?.wrap("$", "$"));
    expect(editor().state.doc.toString()).toBe("x$$");
    expect(editor().state.selection.main.head).toBe(2);
  });

  it.each<[string, number, number | null | undefined, number]>([
    ["a line and column", 2, 3, 6],
    ["a line without a column", 2, undefined, 4],
    ["a null column", 3, null, 8],
    ["a column past the line end", 1, 40, 3],
    ["a line before the first", 0, 2, 1],
    ["a line past the last", 99, 1, 8],
  ])("reveals %s", (_name, line, column, anchor) => {
    const { editor, ref } = mount("one\ntwo\nthree");
    act(() => ref.current?.revealLine(line, column));
    expect(editor().state.selection.main.head).toBe(anchor);
    expect(editor().hasFocus).toBe(true);
  });

  it("focuses on request", () => {
    const { editor, ref } = mount("x");
    expect(editor().hasFocus).toBe(false);
    act(() => ref.current?.focus());
    expect(editor().hasFocus).toBe(true);
  });

  it("applies extra extensions from the caller", () => {
    const { container } = mount("locked", [EditorView.editable.of(false)]);
    expect(container.querySelector(".cm-content")).toHaveAttribute("contenteditable", "false");
  });

  it("ignores toolbar calls once the editor is gone", () => {
    const { ref, onChange, unmount } = mount("text");
    const handle = ref.current as CmHandle;
    unmount();
    expect(() => {
      handle.insert("x");
      handle.wrap("[", "]");
      handle.revealLine(1);
      handle.focus();
    }).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});
