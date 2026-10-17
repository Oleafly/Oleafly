// @vitest-environment jsdom

import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { afterEach, describe, expect, it } from "vitest";
import { cursorBlinking, type EditorCursorBlinking } from "./cursor-blink";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function mount(style: EditorCursorBlinking, withVim = false) {
  const prefs = new Compartment();
  const view = new EditorView({
    state: EditorState.create({
      doc: "one\ntwo",
      extensions: [withVim ? vim() : [], prefs.of(cursorBlinking(style))],
    }),
    parent: document.body.appendChild(document.createElement("div")),
  });
  views.push(view);
  return { view, prefs };
}

function layer(view: EditorView): HTMLElement {
  const element = view.scrollDOM.querySelector<HTMLElement>(".cm-cursorLayer:not(.cm-vimCursorLayer)");
  if (!element) throw new Error("cursor layer is missing");
  return element;
}

function restartClass(view: EditorView): string | undefined {
  return [...layer(view).classList].find((name) => name.startsWith("cm-cursorBlink-"));
}

function styleText(): string {
  return [...document.querySelectorAll("style")].map((style) => style.textContent ?? "").join("\n");
}

describe("cursorBlinking", () => {
  it("keeps CodeMirror's own blink for Blink and stops it for Off", () => {
    expect(layer(mount("blink").view).style.animationDuration).toBe("1200ms");
    const off = mount("off").view;
    expect(layer(off).style.animationDuration).toBe("0ms");
    expect(restartClass(off)).toBeUndefined();
  });

  it("animates each cursor with the chosen style instead of blinking the layer", () => {
    const { view } = mount("expand");
    expect(layer(view).style.animationDuration).toBe("0ms");
    expect(restartClass(view)).toBe("cm-cursorBlink-a");
    expect(styleText()).toContain("oleafly-cursor-expand-0");
    expect(styleText()).toContain("scaleY(0)");
  });

  it("restarts the animation when the selection moves, and only then", () => {
    const { view } = mount("smooth");
    view.dispatch({ selection: EditorSelection.cursor(2) });
    expect(restartClass(view)).toBe("cm-cursorBlink-b");
    view.dispatch({ effects: [] });
    expect(restartClass(view)).toBe("cm-cursorBlink-b");
    view.dispatch({ changes: { from: 0, insert: "x" }, selection: EditorSelection.cursor(1) });
    expect(restartClass(view)).toBe("cm-cursorBlink-a");
  });

  it("clears its class when the style changes back to Blink", () => {
    const { view, prefs } = mount("phase");
    expect(restartClass(view)).toBe("cm-cursorBlink-a");
    view.dispatch({ effects: prefs.reconfigure(cursorBlinking("blink")) });
    expect(restartClass(view)).toBeUndefined();
    expect(layer(view).style.animationDuration).toBe("1200ms");
  });

  it("restarts the native cursor's animation, not vim's block cursor layer", () => {
    const { view } = mount("expand", true);
    expect(restartClass(view)).toBe("cm-cursorBlink-a");
    const vimLayer = view.scrollDOM.querySelector<HTMLElement>(".cm-vimCursorLayer");
    expect([...(vimLayer?.classList ?? [])].some((name) => name.startsWith("cm-cursorBlink-"))).toBe(false);
  });

  it("adds one stylesheet per style however often the preferences reconfigure", () => {
    const { view, prefs } = mount("smooth");
    const before = document.querySelectorAll("style").length;
    for (let index = 0; index < 5; index++) {
      view.dispatch({ effects: prefs.reconfigure(cursorBlinking("smooth")) });
    }
    expect(document.querySelectorAll("style")).toHaveLength(before);
    expect(styleText().split("@keyframes oleafly-cursor-smooth-0").length - 1).toBe(1);
  });
});
