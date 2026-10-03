// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setTypstMathHost, type TypstMathOutcome } from "../../math-render";
import { installEnglishEditorMessages } from "../../test-messages";
import { loadTypstParser, typstLanguage } from "../../typst";
import { parsedView } from "../test-document";
import { typstVisualMode } from "./index";
import { NO_PORTS } from "./test-support";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="10pt" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';

let view: EditorView | null = null;

beforeAll(async () => {
  installEnglishEditorMessages();
  await loadTypstParser();
  if (!globalThis.Range.prototype.getClientRects) {
    Object.defineProperty(globalThis.Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  }
});

afterEach(() => {
  view?.destroy();
  view = null;
  setTypstMathHost(null);
  document.body.replaceChildren();
  document.head.querySelector("style[data-theme-probe]")?.remove();
  document.documentElement.classList.remove("dark");
});

function mount(doc: string): EditorView {
  view = parsedView(
    new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [typstLanguage(), typstVisualMode(NO_PORTS)],
      }),
      parent: document.body,
    }),
  );
  view.dispatch({});
  return view;
}

function deferred(): { promise: Promise<TypstMathOutcome>; resolve: (outcome: TypstMathOutcome) => void } {
  let resolve: (outcome: TypstMathOutcome) => void = () => undefined;
  const promise = new Promise<TypstMathOutcome>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("Typst math widgets", () => {
  it("shows the source while Typst renders and then the shared rendering", async () => {
    const pending = deferred();
    const render = vi.fn((_source: string) => pending.promise);
    setTypstMathHost({ render, typstVersion: () => "0.15.1" });
    const editor = mount("Area $pi r^2$ and $pi r^2$ again.\n");
    const widgets = editor.dom.querySelectorAll<HTMLElement>(".ofl-visual-typst-math");
    expect(widgets).toHaveLength(2);
    expect(widgets[0].textContent).toBe("$pi r^2$");
    expect(widgets[0].classList.contains("ofl-visual-typst-math-pending")).toBe(true);
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toContain("$pi r^2$");
    pending.resolve({ status: "rendered", svg: SVG });
    await settle();
    for (const widget of editor.dom.querySelectorAll<HTMLElement>(".ofl-visual-typst-math")) {
      expect(widget.querySelector("img.ofl-typst-math")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/u);
      expect(widget.classList.contains("ofl-visual-typst-math-pending")).toBe(false);
    }
  });

  it("renders display equations as blocks", async () => {
    setTypstMathHost({ render: async () => ({ status: "rendered", svg: SVG }), typstVersion: () => null });
    const editor = mount("Before.\n\n$ sum_(i=1)^n i $\n\nAfter.");
    await settle();
    const display = editor.dom.querySelector<HTMLElement>(".ofl-visual-math-display.ofl-visual-typst-math");
    expect(display?.tagName).toBe("DIV");
    expect(display?.querySelector("img.ofl-typst-math")).not.toBeNull();
  });

  it("repaints rendered math in the new text colour when the theme changes", async () => {
    const style = document.createElement("style");
    style.dataset.themeProbe = "";
    style.textContent = "html .cm-editor .cm-content { color: rgb(17, 17, 17); } html.dark .cm-editor .cm-content { color: rgb(238, 238, 238); }";
    document.head.append(style);
    const render = vi.fn(async (source: string): Promise<TypstMathOutcome> => ({
      status: "rendered",
      svg: SVG.replace("<path", `<path data-source="${encodeURIComponent(source)}"`),
    }));
    setTypstMathHost({ render, typstVersion: () => "theme-switch" });
    const editor = mount("Area $pi r^2$ here.\n");
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toContain('rgb("#111111")');
    const before = editor.dom.querySelector(".ofl-visual-typst-math img")?.getAttribute("src");

    document.documentElement.classList.add("dark");
    await settle();
    await settle();

    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1][0]).toContain('rgb("#eeeeee")');
    const after = editor.dom.querySelector(".ofl-visual-typst-math img")?.getAttribute("src");
    expect(after).toMatch(/^data:image\/svg\+xml/u);
    expect(after).not.toBe(before);
    expect(after).toContain(encodeURIComponent(encodeURIComponent("#eeeeee")));
  });

  it("leaves rendered math alone when an unrelated attribute changes", async () => {
    const render = vi.fn(async (): Promise<TypstMathOutcome> => ({ status: "rendered", svg: SVG }));
    setTypstMathHost({ render, typstVersion: () => "unrelated-attribute" });
    mount("Area $pi r^2$ here.\n");
    await settle();
    document.documentElement.classList.add("unrelated-class");
    await settle();
    document.documentElement.classList.remove("unrelated-class");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("shows the source with Typst's message when rendering fails", async () => {
    setTypstMathHost({
      render: async () => ({ status: "failed", message: "unknown variable: foo" }),
      typstVersion: () => null,
    });
    const editor = mount("Bad $foo bar$ here.\n");
    await settle();
    await settle();
    const widget = editor.dom.querySelector<HTMLElement>(".ofl-visual-typst-math");
    expect(widget?.textContent).toBe("$foo bar$");
    expect(widget?.classList.contains("ofl-visual-math-error")).toBe(true);
    expect(widget?.title).toBe("unknown variable: foo");
  });
});
