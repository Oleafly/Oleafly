// @vitest-environment jsdom

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { vscodeSearch } from "./search-panel";
import { syntaxTree } from "@codemirror/language";
import { stickyScroll } from "./sticky-scroll";
import { typstStickySource } from "./sticky-structure";
import { typstLanguage } from "./typst";
import { englishEditorMessage } from "./test-messages";
import { EDITOR_LINE_HEIGHT_CSS } from "./theme";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const DOC = [
  "\\section{Results}",
  "\\begin{figure}",
  "body line",
  "body line",
  "\\end{figure}",
].join("\n");

/**
 * jsdom reports zero for every measurement, so the plugin has to be told where
 * the viewport is. These stubs stand in for the two geometry reads it makes.
 */
function mount(topLine: number, extensions: Extension[] = []) {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc: DOC, extensions: [...extensions, stickyScroll()] }),
  });
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    width: 800,
    height: 400,
    bottom: 400,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(view, "lineBlockAtHeight").mockReturnValue({
    from: view.state.doc.line(topLine).from,
  } as ReturnType<EditorView["lineBlockAtHeight"]>);
  return view;
}

function withRangeGeometry() {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  const added = ["getClientRects", "getBoundingClientRect"].filter((name) => !(name in proto));
  const empty = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  for (const name of added) {
    Object.defineProperty(proto, name, {
      configurable: true,
      value: name === "getClientRects" ? () => Object.assign([], { item: () => null }) : () => empty,
    });
  }
  return {
    restore() {
      for (const name of added) delete proto[name];
    },
  };
}

describe("stickyScroll", () => {
  it("mounts an overlay into the editor and removes it on destroy", () => {
    const mounted = mount(1);
    const container = mounted.dom.querySelector(".cm-stickyScroll");
    expect(container).not.toBeNull();
    expect(getComputedStyle(container as HTMLElement).lineHeight).toBe(EDITOR_LINE_HEIGHT_CSS);

    mounted.destroy();
    view = null;
    expect(document.querySelector(".cm-stickyScroll")).toBeNull();
  });

  it("pins the enclosing section and environment with their line numbers", async () => {
    const mounted = mount(3);
    await new Promise(requestAnimationFrame);

    const rows = [...mounted.dom.querySelectorAll(".cm-stickyRow")];
    expect(rows.map((row) => row.querySelector(".cm-stickyLineNo")?.textContent)).toEqual([
      "1",
      "2",
    ]);
    expect(rows[0].textContent).toContain("\\section{Results}");
    expect(rows[1].textContent).toContain("\\begin{figure}");
  });

  it("pins nothing at the top of the document", async () => {
    const mounted = mount(1);
    await new Promise(requestAnimationFrame);

    expect(mounted.dom.querySelectorAll(".cm-stickyRow")).toHaveLength(0);
  });

  it("stops pinning a scope the reader has scrolled past", async () => {
    const mounted = mount(5);
    await new Promise(requestAnimationFrame);

    const rows = [...mounted.dom.querySelectorAll(".cm-stickyRow")];
    expect(rows.map((row) => row.querySelector(".cm-stickyLineNo")?.textContent)).toEqual([
      "1",
      "2",
    ]);
  });

  it("jumps to the pinned line when its row is pressed", async () => {
    const mounted = mount(3);
    await new Promise(requestAnimationFrame);
    vi.spyOn(mounted, "lineBlockAt").mockReturnValue({ top: 42 } as ReturnType<EditorView["lineBlockAt"]>);
    const row = mounted.dom.querySelectorAll<HTMLElement>(".cm-stickyRow")[1];
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    row.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(mounted.scrollDOM.scrollTop).toBe(42);
  });

  it("keeps the pinned rows when an edit leaves the scopes unchanged", async () => {
    const mounted = mount(3);
    await new Promise(requestAnimationFrame);
    const before = mounted.dom.querySelectorAll(".cm-stickyRow")[0];
    mounted.dispatch({ changes: { from: mounted.state.doc.line(3).from, insert: "x" } });
    await new Promise(requestAnimationFrame);
    const rows = mounted.dom.querySelectorAll(".cm-stickyRow");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(before);
  });

  it("stacks the pinned rows over the text but under the search panel and dialogs", () => {
    const mounted = mount(1, [vscodeSearch(englishEditorMessage)]);
    expect(openSearchPanel(mounted)).toBe(true);
    const zIndex = (selector: string) =>
      Number(getComputedStyle(mounted.dom.querySelector(selector) as HTMLElement).zIndex);

    const pinned = zIndex(".cm-stickyScroll");
    // The scroller's stacking context holds the gutter and the text.
    expect(pinned).toBeGreaterThan(zIndex(".cm-scroller"));
    expect(pinned).toBeLessThan(zIndex(".cm-panels-top"));
    // App dialogs sit at z-index 80 and up, in the same stacking context.
    expect(pinned).toBeLessThan(80);
    // Not isolated: a tooltip mounted inside the editor has to reach over the
    // panes beside it.
    expect(getComputedStyle(mounted.dom).isolation).not.toBe("isolate");
  });

  it("gives pinned rows more room than a document line", async () => {
    const mounted = mount(3);
    await new Promise(requestAnimationFrame);

    const row = mounted.dom.querySelector(".cm-stickyRow") as HTMLElement;
    expect(getComputedStyle(row).paddingTop).toBe("0.25em");
    expect(getComputedStyle(row).paddingBottom).toBe("0.25em");
  });

  it("lines a pinned row up with the line numbers and the text", async () => {
    // The number column ends 40px from the editor's left edge and the gutters
    // at 60px: the fold and diagnostic gutters sit in between, and a pinned
    // row has to skip them.
    const mounted = mount(3, [lineNumbers()]);
    // After mount, which stubs the scroller's own box on the instance.
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const box = (right: number) =>
        ({ left: 0, right, width: right, top: 0, bottom: 20, height: 20, x: 0, y: 0 }) as DOMRect;
      if (this.classList.contains("cm-gutterElement")) return box(40);
      if (this.classList.contains("cm-gutters")) return box(60);
      return measure.call(this);
    });
    await new Promise(requestAnimationFrame);

    const padding = (selector: string, side: "paddingLeft" | "paddingRight") =>
      Number.parseFloat(getComputedStyle(mounted.dom.querySelector(selector) as HTMLElement)[side]) || 0;
    const digitsEnd = 40 - padding(".cm-lineNumbers .cm-gutterElement", "paddingRight");
    const textStart = 60 + padding(".cm-content", "paddingLeft") + padding(".cm-line", "paddingLeft");

    const number = mounted.dom.querySelector(".cm-stickyLineNo") as HTMLElement;
    const code = mounted.dom.querySelector(".cm-stickyCode") as HTMLElement;
    expect(number.style.width).toBe(`${digitsEnd}px`);
    expect(number.style.paddingRight).toBe("0px");
    expect(code.style.marginLeft).toBe(`${textStart - digitsEnd}px`);
    expect(textStart - digitsEnd).toBeGreaterThan(20);
  });

  it("pins Typst headings once the lazily loaded parser has produced a tree", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ["= Results", "== Details", "body line", "body line"].join("\n"),
        extensions: [typstLanguage(), stickyScroll(typstStickySource)],
      }),
    });
    const mounted = view;
    vi.spyOn(mounted.scrollDOM, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      width: 800,
      height: 400,
      bottom: 400,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(mounted, "lineBlockAtHeight").mockReturnValue({
      from: mounted.state.doc.line(3).from,
    } as ReturnType<EditorView["lineBlockAtHeight"]>);

    await vi.waitFor(() => expect(syntaxTree(mounted.state).type.name).toBe("Source"), {
      timeout: 5_000,
    });
    await vi.waitFor(() => {
      const rows = [...mounted.dom.querySelectorAll(".cm-stickyRow")];
      expect(rows.map((row) => row.querySelector(".cm-stickyLineNo")?.textContent)).toEqual(["1", "2"]);
    });
    expect(mounted.dom.querySelector(".cm-stickyRow")?.textContent).toContain("= Results");
  });

  it("measures the gutter columns once while scrolling within one geometry", async () => {
    const rangeRects = withRangeGeometry();
    onTestFinished(rangeRects.restore);
    const box = (width: number) =>
      ({ top: 0, left: 0, right: width, bottom: 20, width, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.classList.contains("cm-gutterElement") ? box(24) : box(0);
    });
    const mounted = mount(3, [lineNumbers()]);
    const gutterReads = () =>
      reads.mock.calls.filter(([element]) => (element as Element).classList.contains("cm-gutterElement")).length;
    const reads = vi.spyOn(window, "getComputedStyle");
    const scroll = async (times: number) => {
      for (let index = 0; index < times; index++) {
        mounted.scrollDOM.dispatchEvent(new Event("scroll"));
        await new Promise(requestAnimationFrame);
      }
    };
    await new Promise(requestAnimationFrame);
    await scroll(2);
    const settled = gutterReads();
    expect(settled).toBeGreaterThan(0);
    await scroll(6);
    expect(gutterReads()).toBe(settled);

    mounted.dispatch({ changes: { from: mounted.state.doc.length, insert: "\nmore" } });
    await new Promise(requestAnimationFrame);
    expect(gutterReads()).toBe(settled + 1);
  });
});
