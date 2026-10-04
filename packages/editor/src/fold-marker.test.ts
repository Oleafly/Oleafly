// @vitest-environment jsdom

import { foldGutter } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { foldMarkerDOM, foldMarkerTheme } from "./fold-marker";
import { EDITOR_LINE_HEIGHT_CSS, editorTheme } from "./theme";

let mounted: EditorView | null = null;

function mountGutters(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  mounted = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        foldGutter({ markerDOM: foldMarkerDOM }),
        foldMarkerTheme,
        editorTheme(),
      ],
    }),
    parent,
  });
  return mounted;
}

function styleOf(view: EditorView, selector: string): CSSStyleDeclaration {
  const element = view.dom.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element for ${selector}`);
  }
  return getComputedStyle(element);
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.innerHTML = "";
});

describe("foldMarkerDOM", () => {
  it("has intrinsic dimensions before the runtime theme is mounted", () => {
    const marker = foldMarkerDOM(true);
    const svg = marker.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("12");
    expect(svg?.getAttribute("height")).toBe("12");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
  });
});

describe("gutter width, from the cascade rather than layout", () => {
  it("uses the roomier document line height", () => {
    const view = mountGutters("one\ntwo\nthree");

    expect(styleOf(view, ".cm-scroller").lineHeight).toBe(EDITOR_LINE_HEIGHT_CSS);
  });

  it("sizes the fold column to the marker with no padding around it", () => {
    const view = mountGutters("one\ntwo\nthree");
    const marker = styleOf(view, ".cm-fold-marker");

    expect(marker.width).toBe("12px");
    expect(marker.padding).toBe("0px");
  });

  it("leaves only a hairline between the line numbers and the fold column", () => {
    const view = mountGutters("one\ntwo\nthree");
    const number = styleOf(view, ".cm-lineNumbers .cm-gutterElement");

    expect(number.paddingRight).toBe("2px");
  });

  it("keeps a fold gutter for the sticky header to measure", () => {
    const view = mountGutters("one\ntwo\nthree");

    expect(view.dom.querySelector(".cm-gutters")).not.toBeNull();
    expect(view.dom.querySelector(".cm-foldGutter")).not.toBeNull();
  });
});

describe("fold marker hover label", () => {
  function labels(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".cm-fold-label"));
  }

  it("shows a tooltip beside the marker on hover and removes it on leave", () => {
    const marker = foldMarkerDOM(true);
    document.body.append(marker);
    marker.getBoundingClientRect = () => ({ right: 20, top: 100, height: 10 }) as DOMRect;
    marker.dispatchEvent(new MouseEvent("mouseenter"));
    const [label] = labels();
    expect(label.textContent).toBe("Fold line");
    expect(label.getAttribute("role")).toBe("tooltip");
    expect([label.style.left, label.style.top]).toEqual(["26px", "105px"]);
    marker.dispatchEvent(new MouseEvent("mouseleave"));
    expect(labels()).toEqual([]);
  });

  it("keeps a single label and hides it when the marker is pressed", () => {
    const open = foldMarkerDOM(true);
    const closed = foldMarkerDOM(false);
    document.body.append(open, closed);
    open.dispatchEvent(new MouseEvent("mouseenter"));
    closed.dispatchEvent(new MouseEvent("mouseenter"));
    expect(labels().map((label) => label.textContent)).toEqual(["Unfold line"]);
    expect(labels()[0].style.left).toBe("6px");
    closed.dispatchEvent(new MouseEvent("mousedown"));
    expect(labels()).toEqual([]);
  });
});
