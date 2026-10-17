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
    other.setAttribute("contenteditable", "true");
    document.body.append(other);

    const line = view.contentDOM.querySelector(".cm-line");
    expect(line).not.toBeNull();
    expect(nativeSelectAll(line as Element).defaultPrevented).toBe(false);
    expect(nativeSelectAll(other).defaultPrevented).toBe(false);
    expect(view.state.selection.main.empty).toBe(true);
  });
});

describe("Select All outside the editors", () => {
  let uninstall = () => {};

  beforeEach(() => {
    uninstall = installSelectAllRouting();
  });

  afterEach(() => {
    uninstall();
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  const mount = (html: string) => {
    document.body.innerHTML = html;
  };

  const element = (selector: string) => {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  };

  const pointAt = (target: Element, init: MouseEventInit = {}) => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...init }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }));
  };

  const nextTask = () => new Promise((resolve) => setTimeout(resolve));

  const selectedText = () => document.getSelection()?.toString() ?? "";

  it("keeps the native behaviour in a focused text field", () => {
    mount(`<div data-select-all-scope class="select-text"><p>Log line</p><input id="field" value="query" /></div>`);
    const field = element("#field");
    field.focus();

    expect(nativeSelectAll(field).defaultPrevented).toBe(false);
  });

  it("selects only the scope that holds focus", () => {
    mount(
      `<nav><span id="chrome">Toolbar</span></nav>` +
        `<section id="scope" data-select-all-scope class="select-text" tabindex="-1"><p>First line</p><p>Second line</p></section>`,
    );
    element("#scope").focus();

    const event = nativeSelectAll(document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(selectedText()).toBe("First lineSecond line");
    expect(document.getSelection()?.getRangeAt(0).intersectsNode(element("#chrome"))).toBe(false);
  });

  it("selects only the scope the user last pointed at", async () => {
    mount(
      `<header><span id="chrome">Toolbar</span></header>` +
        `<pre id="log" data-select-all-scope class="select-text"><span id="line">error: missing brace</span></pre>`,
    );
    pointAt(element("#line"));
    await nextTask();

    const event = nativeSelectAll(document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(selectedText()).toBe("error: missing brace");
  });

  it("selects nothing when the user is on interface chrome", async () => {
    mount(
      `<header><span id="chrome">Toolbar</span></header>` +
        `<pre data-select-all-scope class="select-text">error: missing brace</pre>`,
    );
    pointAt(element("#chrome"));
    await nextTask();

    const event = nativeSelectAll(document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(selectedText()).toBe("");
  });

  it("selects nothing once the scope the user pointed at is gone", async () => {
    mount(`<pre id="log" data-select-all-scope class="select-text">error: missing brace</pre>`);
    pointAt(element("#log"));
    await nextTask();
    element("#log").remove();

    expect(nativeSelectAll(document.body).defaultPrevented).toBe(true);
    expect(selectedText()).toBe("");
  });

  it("follows the pointer into a scope inside the focused container", async () => {
    mount(`<div id="viewer" tabindex="0"><div data-select-all-scope class="select-text"><span id="word">Abstract</span></div></div>`);
    element("#viewer").focus();
    pointAt(element("#word"));
    await nextTask();

    expect(nativeSelectAll(document.body).defaultPrevented).toBe(true);
    expect(selectedText()).toBe("Abstract");
  });

  it("does not reach a scope behind the dialog that holds focus", async () => {
    mount(
      `<pre id="log" data-select-all-scope class="select-text">error: missing brace</pre>` +
        `<div role="dialog" aria-modal="true"><button id="confirm">OK</button></div>`,
    );
    pointAt(element("#log"));
    await nextTask();
    element("#confirm").focus();

    expect(nativeSelectAll(document.body).defaultPrevented).toBe(true);
    expect(selectedText()).toBe("");
  });

  it("leaves a selectstart that comes from the pointer alone", () => {
    mount(`<header><span id="chrome">Toolbar</span></header><p id="text" class="select-text">Body</p>`);
    pointAt(element("#text"));

    expect(nativeSelectAll(element("#text")).defaultPrevented).toBe(false);
  });
});

describe("clicking interface chrome", () => {
  let uninstall = () => {};

  beforeEach(() => {
    uninstall = installSelectAllRouting();
    document.body.innerHTML =
      `<header id="toolbar"><span id="label">Compile</span><button id="action">Ask</button>` +
      `<div role="menu"><div id="item" role="menuitem">Copy</div></div></header>` +
      `<article id="message" class="select-text"><p id="first">First paragraph</p><p id="second">Second paragraph</p></article>` +
      `<div id="editable" contenteditable="true">Draft text</div>`;
  });

  afterEach(() => {
    uninstall();
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  const element = (selector: string) => {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  };

  const press = (target: Element, init: MouseEventInit = {}) => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...init }));
  };

  const selectMessage = () => {
    const selection = document.getSelection();
    selection?.selectAllChildren(element("#message"));
    return selection;
  };

  it("clears a stray selection", () => {
    const selection = selectMessage();

    press(element("#label"));

    expect(selection?.rangeCount).toBe(0);
  });

  it("keeps the selection for buttons and menu items that may act on it", () => {
    const selection = selectMessage();

    press(element("#action"));
    press(element("#item"));

    expect(selection?.toString()).toBe("First paragraphSecond paragraph");
  });

  it("does nothing special inside a selectable region", () => {
    const selection = selectMessage();

    press(element("#second"), { shiftKey: true });
    press(element("#first"));

    expect(selection?.toString()).toBe("First paragraphSecond paragraph");
  });

  it("keeps the selection on a right click or a shift click", () => {
    const selection = selectMessage();

    press(element("#label"), { button: 2 });
    press(element("#label"), { shiftKey: true });

    expect(selection?.toString()).toBe("First paragraphSecond paragraph");
  });

  it("never touches a selection inside an editable", () => {
    const editable = element("#editable");
    editable.focus();
    const selection = document.getSelection();
    selection?.selectAllChildren(editable);

    press(element("#label"));

    expect(selection?.toString()).toBe("Draft text");
  });

  it("never touches a selection in a read-only code view", () => {
    const view = document.createElement("div");
    view.className = "cm-editor";
    view.innerHTML = `<div class="cm-content" contenteditable="false"><div class="cm-line">\\section{Intro}</div></div>`;
    document.body.append(view);
    const selection = document.getSelection();
    selection?.selectAllChildren(view);

    press(element("#label"));

    expect(selection?.toString()).toBe("\\section{Intro}");
  });

  it("ignores a collapsed caret", () => {
    const selection = document.getSelection();
    selection?.collapse(element("#first").firstChild, 3);

    press(element("#label"));

    expect(selection?.rangeCount).toBe(1);
  });
});
