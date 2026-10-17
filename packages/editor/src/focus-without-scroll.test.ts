// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView, WidgetType, Decoration, lineNumbers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusOnPointerWithoutScroll, focusWithoutScroll } from "./focus-without-scroll";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

class InputWidget extends WidgetType {
  toDOM() {
    const input = document.createElement("input");
    input.className = "widget-input";
    return input;
  }
  ignoreEvent() {
    return true;
  }
}

function mount() {
  const outside = document.body.appendChild(document.createElement("button"));
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n"),
      extensions: [
        lineNumbers(),
        focusOnPointerWithoutScroll,
        EditorView.decorations.of(Decoration.set([Decoration.widget({ widget: new InputWidget() }).range(0)])),
      ],
    }),
  });
  views.push(view);
  view.contentDOM.addEventListener("mousedown", (event) => event.stopPropagation(), true);
  outside.focus();
  return { view, outside };
}

function revealOnFocus(view: EditorView) {
  const focus = vi.spyOn(view.contentDOM, "focus").mockImplementation(function (this: HTMLElement) {
    HTMLElement.prototype.focus.call(this);
    view.scrollDOM.scrollTop = 0;
    document.documentElement.scrollTop = 40;
  });
  return focus;
}

function press(target: Element, button = 0) {
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button }));
}

describe("focusWithoutScroll", () => {
  it("focuses the editor and puts back any scroll the browser made while focusing", () => {
    const { view } = mount();
    view.scrollDOM.scrollTop = 900;
    revealOnFocus(view);
    focusWithoutScroll(view);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.scrollDOM.scrollTop).toBe(900);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("does nothing when the editor already has focus", () => {
    const { view } = mount();
    view.contentDOM.focus();
    const focus = revealOnFocus(view);
    focusWithoutScroll(view);
    expect(focus).not.toHaveBeenCalled();
  });
});

describe("focusOnPointerWithoutScroll", () => {
  it("focuses the editor before a click in the text is handled, keeping the scroll", () => {
    const { view } = mount();
    view.scrollDOM.scrollTop = 900;
    revealOnFocus(view);
    press(view.contentDOM.querySelectorAll(".cm-line")[3]);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.scrollDOM.scrollTop).toBe(900);
  });

  it("also covers a click in the empty space below the text", () => {
    const { view } = mount();
    view.scrollDOM.scrollTop = 900;
    revealOnFocus(view);
    press(view.scrollDOM);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.scrollDOM.scrollTop).toBe(900);
  });

  it("leaves right clicks, gutter clicks and widget inputs to their own handling", () => {
    const { view, outside } = mount();
    const focus = revealOnFocus(view);
    press(view.contentDOM.querySelectorAll(".cm-line")[3], 2);
    press(view.dom.querySelector(".cm-gutterElement")!);
    press(view.contentDOM.querySelector(".widget-input")!);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
  });
});
