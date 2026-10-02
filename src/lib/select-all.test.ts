// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSelectAllRouting, ownSelectAll } from "./select-all";

const longDocument = Array.from({ length: 3000 }, (_, line) => `line ${line + 1}`).join("\n");

const nativeSelectAll = (root: Element) => {
  const event = new Event("selectstart", { bubbles: true, cancelable: true });
  root.dispatchEvent(event);
  return event;
};

describe("native Select All in a code editor", () => {
  let views: EditorView[] = [];
  let uninstall = () => {};

  beforeEach(() => {
    uninstall = installSelectAllRouting();
  });

  afterEach(() => {
    uninstall();
    for (const view of views) view.destroy();
    views = [];
    document.body.innerHTML = "";
  });

  const editor = () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: longDocument }), parent });
    views.push(view);
    return view;
  };

  it("keeps the built-in Edit menu item, so native fields and Linux Ctrl+A behave as before", () => {
    const menu = readFileSync(join(process.cwd(), "src-tauri/src/menu.rs"), "utf8");
    expect(menu).toContain(".select_all_with_text(");
  });

  it("selects the whole document instead of only the lines on screen", () => {
    const view = editor();

    const event = nativeSelectAll(view.contentDOM);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(longDocument.length);
  });

  it("leaves a mouse selection alone, then handles the next Select All", async () => {
    const view = editor();

    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
    expect(nativeSelectAll(view.contentDOM).defaultPrevented).toBe(false);
    expect(view.state.selection.main.empty).toBe(true);

    await new Promise((resolve) => setTimeout(resolve));
    expect(nativeSelectAll(view.contentDOM).defaultPrevented).toBe(true);
    expect(view.state.selection.main.to).toBe(longDocument.length);
  });

  it("hands Select All in the terminal to the terminal while it owns the host", () => {
    const host = document.createElement("div");
    const textarea = document.createElement("textarea");
    host.append(textarea);
    document.body.append(host);
    const selectTerminal = vi.fn();
    const release = ownSelectAll(host, selectTerminal);

    expect(nativeSelectAll(textarea).defaultPrevented).toBe(true);
    expect(selectTerminal).toHaveBeenCalledTimes(1);

    release();
    expect(nativeSelectAll(textarea).defaultPrevented).toBe(false);
    expect(selectTerminal).toHaveBeenCalledTimes(1);
  });

  it("ignores selections that start inside a line or in another editable", () => {
    const view = editor();
    const other = document.createElement("div");
    other.contentEditable = "true";
    document.body.append(other);

    const line = view.contentDOM.querySelector(".cm-line");
    expect(line).not.toBeNull();
    expect(nativeSelectAll(line as Element).defaultPrevented).toBe(false);
    expect(nativeSelectAll(other).defaultPrevented).toBe(false);
    expect(view.state.selection.main.empty).toBe(true);
  });
});
