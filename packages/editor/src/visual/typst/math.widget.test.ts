// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTypstMathHost, type TypstMathOutcome } from "../../math-render";
import { TypstMathWidget } from "./math";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

let view: EditorView | null = null;
let counter = 0;

afterEach(() => {
  view?.destroy();
  view = null;
  setTypstMathHost(null);
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mount(parent: HTMLElement | undefined = document.body): EditorView {
  view = new EditorView({ state: EditorState.create({ doc: "first\nsecond" }), parent });
  return view;
}

function host(render: (source: string) => Promise<TypstMathOutcome>) {
  const typst = { render: vi.fn(render), typstVersion: () => "0.15.1" };
  setTypstMathHost(typst);
  return typst;
}

function unique(body: string): string {
  counter += 1;
  return `${body} + w_${counter}`;
}

describe("Typst math widget", () => {
  it("compares by body and layout and only lets the editor handle presses on inline math", () => {
    const inline = new TypstMathWidget("$x$", "x", false);
    const display = new TypstMathWidget("$ x\ny $", " x\ny ", true);
    expect(inline.eq(new TypstMathWidget("$x$", "x", false))).toBe(true);
    expect(inline.eq(new TypstMathWidget("$x$", "x", true))).toBe(false);
    expect(inline.ignoreEvent(new MouseEvent("mousedown"))).toBe(false);
    expect(display.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
    expect(display.ignoreEvent(new MouseEvent("mouseup"))).toBe(false);
    expect(inline.ignoreEvent(new KeyboardEvent("keydown"))).toBe(true);
    expect(inline.estimatedHeight).toBe(-1);
    expect(display.estimatedHeight).toBe(80);
  });

  it("shows the source until the editor is styled and then renders", async () => {
    vi.useFakeTimers();
    const typst = host(async () => ({ status: "rendered", svg: "<svg/>" }));
    const detached = document.createElement("div");
    const editor = mount(detached);
    const body = unique("x");
    const element = new TypstMathWidget(`$${body}$`, body, false).toDOM(editor);
    expect(element.textContent).toBe(`$${body}$`);
    expect(element.classList.contains("ofl-visual-typst-math-pending")).toBe(true);
    document.body.append(detached);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(typst.render).toHaveBeenCalledTimes(1);
    expect(element.querySelector("img.ofl-typst-math")).not.toBeNull();
    expect(element.getAttribute("aria-label")).toBe(`$${body}$`);
    expect(new TypstMathWidget("$x$", "x", false).coordsAt(element)).toBeDefined();
  });

  it("keeps the source without a title when Typst fails silently", async () => {
    vi.useFakeTimers();
    host(async () => ({ status: "failed", message: "" }));
    const editor = mount();
    const body = unique("y");
    const element = new TypstMathWidget(`$${body}$`, body, false).toDOM(editor);
    await vi.advanceTimersByTimeAsync(0);
    expect(element.classList.contains("ofl-visual-math-error")).toBe(true);
    expect(element.textContent).toBe(`$${body}$`);
    expect(element.hasAttribute("title")).toBe(false);
  });

  it("stops a pending render when destroyed and repaints on update", async () => {
    vi.useFakeTimers();
    const typst = host(async () => ({ status: "rendered", svg: "<svg/>" }));
    const editor = mount();
    const first = unique("z");
    const widget = new TypstMathWidget(`$${first}$`, first, false);
    const element = widget.toDOM(editor);
    widget.destroy(element);
    await vi.advanceTimersByTimeAsync(0);
    expect(typst.render).not.toHaveBeenCalled();
    const second = unique("z");
    expect(new TypstMathWidget(`$${second}$`, second, false).updateDOM(element, editor)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(typst.render).toHaveBeenCalledTimes(1);
  });

  it("places the cursor after a display equation on mouse up", () => {
    host(async () => ({ status: "rendered", svg: "<svg/>" }));
    const editor = mount();
    const element = new TypstMathWidget("$ a $", unique(" a "), true).toDOM(editor);
    expect(element.tagName).toBe("DIV");
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    expect(editor.state.selection.main.head).toBe(editor.lineBlockAtHeight(0).to);
  });
});
