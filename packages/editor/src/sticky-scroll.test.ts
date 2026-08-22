// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { stickyScroll } from "./sticky-scroll";

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
function mount(topLine: number) {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc: DOC, extensions: [stickyScroll()] }),
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

describe("stickyScroll", () => {
  it("mounts an overlay into the editor and removes it on destroy", () => {
    const mounted = mount(1);
    const container = mounted.dom.querySelector(".cm-stickyScroll");
    expect(container).not.toBeNull();

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
});
