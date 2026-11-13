// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, pressKey, typeInto } from "./tests/kb-editor-fixtures";
import { applyTypedTask, clearTaskAtStart, taskMarker, toggledTask, toggleTaskAt } from "./note-tasks";
import { editableChanged } from "./note-editable";
import "./tests/setup";

afterEach(destroyKbEditors);

function boxes(root: HTMLElement): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>("input.note-task-box")];
}

describe("task markers", () => {
  it("writes boxes only for tasks", () => {
    expect(taskMarker({ task: false, checked: false }, false)).toBe("");
    expect(taskMarker({ task: true, checked: true }, false)).toBe("[x] ");
    expect(taskMarker({ task: true, checked: false }, true)).toBe("[ ]");
    expect(toggledTask({ task: false, checked: false })).toEqual({ task: true, checked: false });
    expect(toggledTask({ task: true, checked: false })).toEqual({ task: true, checked: true });
  });
});

describe("typing tasks", () => {
  it("turns a bullet list into a task list when an item starts with a box", () => {
    const editor = kbEditor("- first\n- second\n- third");
    placeCursor(editor, "second");
    typeInto(editor, "[ ] ");
    expect(kbMarkdown(editor)).toBe("- first\n- [ ] second\n- third");
    placeCursor(editor, "third");
    typeInto(editor, "[x] ");
    expect(kbMarkdown(editor)).toBe("- first\n- [ ] second\n- [x] third");
  });

  it("wraps a plain paragraph and leaves headings and existing tasks alone", () => {
    const editor = kbEditor("Write it\n\n# Head\n\n- [ ] done");
    placeCursor(editor, "Write");
    typeInto(editor, "[] ");
    expect(kbMarkdown(editor)).toBe("- [ ] Write it\n\n# Head\n\n- [ ] done");
    placeCursor(editor, "Head");
    typeInto(editor, "[ ] ");
    placeCursor(editor, "done");
    typeInto(editor, "[x] ");
    expect(kbMarkdown(editor)).toBe("- [ ] Write it\n\n# \\[ \\] Head\n\n- [ ] \\[x\\] done");
  });

  it("does not convert a later paragraph inside a list item", () => {
    const editor = kbEditor("- item\n\n  more");
    placeCursor(editor, "more");
    typeInto(editor, "[ ] ");
    expect(kbMarkdown(editor)).not.toContain("- [ ]");
  });

  it("keeps every block id in the list when a typed box turns it into a task list", () => {
    const editor = kbEditor("- one ^o1\n- Alpha ^aa\n- three ^t3");
    placeCursor(editor, "Alpha");
    typeInto(editor, "[ ] ");
    expect(kbMarkdown(editor)).toBe("- one ^o1\n- [ ] Alpha ^aa\n- three ^t3");
    const listed = kbEditor("- one\n- Alpha\n\n^lst");
    placeCursor(listed, "Alpha");
    typeInto(listed, "[x] ");
    expect(kbMarkdown(listed)).toBe("- one\n- [x] Alpha\n\n^lst");
  });

  it("refuses a box that is not typed at the start of a paragraph", () => {
    const editor = kbEditor("abc");
    const state = editor.state;
    expect(applyTypedTask(state, { from: 2, to: 2 }, false)).toBe(false);
  });
});

describe("task keys and commands", () => {
  it("toggles from the keyboard and makes plain items tasks", () => {
    const editor = kbEditor("- [ ] a\n- b");
    placeCursor(editor, "a");
    expect(pressKey(editor, "Enter", { ctrlKey: true })).toBe(true);
    placeCursor(editor, "b");
    expect(toggleTaskAt(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
    expect(kbMarkdown(editor)).toBe("- [x] a\n- [ ] b");
    const plain = kbEditor("text");
    expect(toggleTaskAt(plain.state)).toBe(false);
  });

  it("splits tasks into new open tasks and plain items into plain items", () => {
    const editor = kbEditor("- [x] done\n- plain\n- [ ] other");
    placeCursor(editor, "done", 4);
    expect(pressKey(editor, "Enter")).toBe(true);
    typeInto(editor, "next");
    placeCursor(editor, "plain", 5);
    pressKey(editor, "Enter");
    typeInto(editor, "also");
    expect(kbMarkdown(editor)).toBe("- [x] done\n- [ ] next\n- plain\n- also\n- [ ] other");
  });

  it("clears a box with Backspace at the start", () => {
    const editor = kbEditor("- [ ] a\n- [ ] b");
    placeCursor(editor, "b");
    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(kbMarkdown(editor)).toBe("- [ ] a\n- b");
    expect(clearTaskAtStart(editor.state)).toBe(false);
    placeCursor(editor, "a", 1);
    expect(clearTaskAtStart(editor.state)).toBe(false);
  });

  it("toggles a task list from a command and indents items", () => {
    const editor = kbEditor("one");
    placeCursor(editor, "one", 3);
    expect(editor.commands.toggleTaskList()).toBe(true);
    expect(kbMarkdown(editor)).toBe("- [ ] one");
    pressKey(editor, "Enter");
    typeInto(editor, "two");
    expect(pressKey(editor, "Tab")).toBe(true);
    expect(kbMarkdown(editor)).toBe("- [ ] one\n  - [ ] two");
    expect(pressKey(editor, "Tab", { shiftKey: true })).toBe(true);
    expect(kbMarkdown(editor)).toBe("- [ ] one\n- [ ] two");
  });

  it("keeps the item's block id when the command or Mod-Shift-9 makes it a task", () => {
    const runs: ((editor: Editor) => boolean)[] = [(editor) => editor.commands.toggleTaskList(), (editor) => pressKey(editor, "9", { ctrlKey: true, shiftKey: true })];
    for (const run of runs) {
      const editor = kbEditor("- one ^o1\n- Alpha ^aa\n- three ^t3");
      placeCursor(editor, "Alpha", 2);
      expect(run(editor)).toBe(true);
      expect(kbMarkdown(editor)).toBe("- one ^o1\n\n- [ ] Alpha ^aa\n\n- three ^t3");
    }
  });

  it("leaves Enter to the editor outside tasks", () => {
    const editor = kbEditor("para");
    placeCursor(editor, "para", 2);
    expect(pressKey(editor, "Enter")).toBe(true);
    expect(kbMarkdown(editor)).toBe("pa\n\nra");
  });
});

describe("task checkboxes", () => {
  it("draws a labelled box per task, none for plain items, and toggles", () => {
    const editor = kbEditor("- [ ] Buy\n- plain\n- [ ]");
    const [buy, , empty] = boxes(editor.view.dom);
    expect(buy.getAttribute("aria-label")).toBe("Task: Buy");
    expect(empty.getAttribute("aria-label")).toBe("Empty task");
    const items = [...editor.view.dom.querySelectorAll<HTMLElement>("li.note-task")];
    expect(items.map((item) => item.dataset.checked)).toEqual(["false", "none", "false"]);
    expect((items[1].querySelector(".note-task-handle") as HTMLElement).hidden).toBe(true);
    buy.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    buy.checked = true;
    buy.dispatchEvent(new Event("change", { bubbles: true }));
    expect(kbMarkdown(editor)).toBe("- [x] Buy\n- plain\n- [ ]");
    expect(items[0].dataset.checked).toBe("true");
  });

  it("puts the box back when the editor is read only", () => {
    const editor = kbEditor("- [ ] Buy");
    editor.setEditable(false);
    const [box] = boxes(editor.view.dom);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(box.checked).toBe(false);
    expect(kbMarkdown(editor)).toBe("- [ ] Buy");
  });

  it("disables the box while the note is read only and enables it again", () => {
    const editor = kbEditor("- [ ] Buy");
    const [box] = boxes(editor.view.dom);
    expect(box.disabled).toBe(false);
    editor.setEditable(false, false);
    editableChanged(editor);
    expect(box.disabled).toBe(true);
    editor.setEditable(true, false);
    editableChanged(editor);
    expect(box.disabled).toBe(false);
    editor.destroy();
    expect(() => editableChanged(editor)).not.toThrow();
  });

  it("keeps editor events away from the box and redraws when the item changes", () => {
    const editor = kbEditor("- [ ] Buy");
    const view = editor.view.nodeDOM(1) as HTMLElement;
    const desc = (editor.view as unknown as { docView: { children: { children: unknown[] }[] } }).docView.children[0].children[0] as unknown as {
      stopEvent(event: Event): boolean;
      ignoreMutation(mutation: { type: string; target: Node }): boolean;
    };
    const [box] = boxes(editor.view.dom);
    expect(view.tagName).toBe("LI");
    expect(desc.stopEvent(new Event("mousedown"))).toBe(false);
    const fromBox = new Event("mousedown");
    Object.defineProperty(fromBox, "target", { value: box });
    expect(desc.stopEvent(fromBox)).toBe(true);
    expect(desc.ignoreMutation({ type: "attributes", target: box })).toBe(true);
    expect(desc.ignoreMutation({ type: "selection", target: box })).toBe(false);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, { task: true, checked: true }));
    expect(box.checked).toBe(true);
  });

  it("writes a task list that only holds plain items as a bullet list", () => {
    const editor = kbEditor("- [ ] only");
    placeCursor(editor, "only");
    pressKey(editor, "Backspace");
    expect(kbMarkdown(editor)).toBe("- only");
  });
});
