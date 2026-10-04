// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTypstMathHost } from "../math-render";
import { loadTypstParser, typstLanguage } from "../typst";
import {
  hideMathPreview,
  mathPreviewEnabled,
  mathPreviewTargetAt,
  mathPreviewTooltip,
  mathPreviewTooltipField,
  setMathPreview,
  setMathPreviewEnabled,
} from "./math-preview";

let mounted: EditorView | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
});

function stateFor(doc: string, cursor: number, enabled?: boolean): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions:
      enabled === undefined
        ? [mathPreviewTooltip("latex")]
        : [mathPreviewTooltip("latex"), mathPreviewEnabled.of(enabled)],
  });
}

function preview(state: EditorState) {
  return state.field(mathPreviewTooltipField);
}

function mount(state: EditorState): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  mounted = new EditorView({ state, parent });
  return mounted;
}

const INLINE = String.raw`Text with $E = mc^2$ inside.`;
const INLINE_CURSOR = INLINE.indexOf("E");
const OUTSIDE = 2;

describe("mathPreviewTargetAt", () => {
  it("finds the inline expression around the cursor", () => {
    const target = mathPreviewTargetAt(stateFor(INLINE, INLINE_CURSOR), "latex");
    expect(target).toEqual({
      from: INLINE.indexOf("$"),
      to: INLINE.lastIndexOf("$") + 1,
      body: "E = mc^2",
      display: false,
    });
  });

  it("finds a display environment around the cursor", () => {
    const doc = [String.raw`\begin{equation}`, "a = b", String.raw`\end{equation}`].join("\n");
    const target = mathPreviewTargetAt(stateFor(doc, doc.indexOf("a = b")), "latex");
    expect(target?.display).toBe(true);
    expect(target?.from).toBe(0);
    expect(target?.to).toBe(doc.length);
    expect(target?.body).toBe(doc);
  });

  it("ignores a non-empty selection", () => {
    const state = EditorState.create({
      doc: INLINE,
      selection: { anchor: INLINE_CURSOR, head: INLINE_CURSOR + 3 },
    });
    expect(mathPreviewTargetAt(state, "latex")).toBeNull();
  });

  it("ignores a cursor outside math", () => {
    expect(mathPreviewTargetAt(stateFor(INLINE, OUTSIDE), "latex")).toBeNull();
  });
});

describe("math preview tooltip state", () => {
  it("shows a tooltip while the cursor sits in math", () => {
    expect(preview(stateFor(INLINE, INLINE_CURSOR)).tooltip).not.toBeNull();
    expect(preview(stateFor(INLINE, OUTSIDE)).tooltip).toBeNull();
  });

  it("hides until the cursor leaves the math", () => {
    const shown = stateFor(INLINE, INLINE_CURSOR);
    const hiddenState = shown.update({ effects: hideMathPreview.of(null) }).state;
    expect(preview(hiddenState).tooltip).toBeNull();

    const stillInside = hiddenState.update({
      selection: { anchor: INLINE_CURSOR + 1 },
    }).state;
    expect(preview(stillInside).tooltip).toBeNull();

    const outside = stillInside.update({ selection: { anchor: OUTSIDE } }).state;
    expect(preview(outside).tooltip).toBeNull();

    const back = outside.update({ selection: { anchor: INLINE_CURSOR } }).state;
    expect(preview(back).tooltip).not.toBeNull();
  });

  it("stays off once disabled, wherever the cursor goes", () => {
    const shown = stateFor(INLINE, INLINE_CURSOR);
    const disabled = shown.update({ effects: setMathPreviewEnabled.of(false) }).state;
    expect(preview(disabled).enabled).toBe(false);
    expect(preview(disabled).tooltip).toBeNull();

    const moved = disabled.update({ selection: { anchor: OUTSIDE } }).state;
    const backInside = moved.update({ selection: { anchor: INLINE_CURSOR } }).state;
    expect(preview(backInside).tooltip).toBeNull();

    const reenabled = backInside.update(setMathPreview(true)).state;
    expect(preview(reenabled).enabled).toBe(true);
    expect(preview(reenabled).tooltip).not.toBeNull();
  });

  it("honours the enabled facet supplied by the host", () => {
    expect(preview(stateFor(INLINE, INLINE_CURSOR, false)).tooltip).toBeNull();
    expect(preview(stateFor(INLINE, INLINE_CURSOR, true)).tooltip).not.toBeNull();
  });
});

describe("math preview tooltip view", () => {
  function tooltipDom(view: EditorView) {
    const tooltip = preview(view.state).tooltip;
    expect(tooltip).not.toBeNull();
    const created = tooltip?.create(view);
    expect(created).toBeDefined();
    return created?.dom as HTMLElement;
  }

  it("renders a display environment through KaTeX", () => {
    const doc = [String.raw`\begin{equation}`, "a = b", String.raw`\end{equation}`].join("\n");
    const view = mount(stateFor(doc, doc.indexOf("a = b")));
    const dom = tooltipDom(view);
    expect(dom.querySelector(".ofl-visual-math-tooltip-error")).toBeNull();
    expect(dom.querySelector(".katex")).not.toBeNull();
  });

  it("renders a labelled display environment through KaTeX", () => {
    const doc = [String.raw`\begin{equation}`, "a = b", String.raw`\label{eq:ab}`, String.raw`\end{equation}`].join("\n");
    const view = mount(stateFor(doc, doc.indexOf("a = b")));
    const dom = tooltipDom(view);
    expect(dom.querySelector(".ofl-visual-math-tooltip-error")?.textContent ?? null).toBeNull();
    expect(dom.querySelector(".katex")).not.toBeNull();
    expect(dom.querySelector(".katex-html")?.textContent).not.toContain("eq:ab");
  });

  it("shows a placeholder for a reference inside math", () => {
    const doc = String.raw`\begin{align}a &= b \label{eq:a} \\ c &= d \quad \text{by } \eqref{eq:a}\end{align}`;
    const view = mount(stateFor(doc, doc.indexOf("c &= d")));
    const dom = tooltipDom(view);
    expect(dom.querySelector(".ofl-visual-math-tooltip-error")?.textContent ?? null).toBeNull();
    expect(dom.querySelector(".katex-html")?.textContent).toContain("(??)");
  });

  it.each([
    ["multline", String.raw`a + b \\ + c = d`],
    ["multline*", String.raw`a + b \\ \shoveleft{+ c} = d`],
    ["eqnarray", String.raw`a &=& b \\ c &=& d`],
    ["flalign", String.raw`a &= b & c &= d`],
    ["displaymath", "a = b"],
  ])("renders the %s environment, which KaTeX lacks", (environment, body) => {
    const doc = [String.raw`\begin{${environment}}`, body, String.raw`\label{eq:x}`, String.raw`\end{${environment}}`].join("\n");
    const view = mount(stateFor(doc, doc.indexOf(body)));
    const dom = tooltipDom(view);
    expect(dom.querySelector(".ofl-visual-math-tooltip-error")?.textContent ?? null).toBeNull();
    expect(dom.querySelector(".katex")).not.toBeNull();
  });

  it("renders the math and a menu with hide and disable", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const dom = tooltipDom(view);

    expect(dom.querySelector(".katex")).not.toBeNull();
    const items = dom.querySelectorAll<HTMLButtonElement>(".ofl-visual-math-tooltip-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("math.preview.hide");
    expect(items[0].textContent).toContain("Esc");
    expect(items[1].textContent).toContain("math.preview.disable");

    const toggle = dom.querySelector<HTMLButtonElement>(".ofl-visual-math-tooltip-toggle");
    expect(toggle?.getAttribute("aria-label")).toBe("math.preview.moreOptions");
    const list = dom.querySelector<HTMLElement>(".ofl-visual-math-tooltip-list");
    expect(list?.hidden).toBe(true);
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(list?.hidden).toBe(false);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("hides the preview from the menu and from Escape", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const dom = tooltipDom(view);
    const items = dom.querySelectorAll<HTMLButtonElement>(".ofl-visual-math-tooltip-item");

    items[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(preview(view.state).tooltip).toBeNull();
    expect(preview(view.state).enabled).toBe(true);

    view.dispatch({ selection: { anchor: OUTSIDE } });
    view.dispatch({ selection: { anchor: INLINE_CURSOR } });
    expect(preview(view.state).tooltip).not.toBeNull();

    tooltipDom(view).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(preview(view.state).tooltip).toBeNull();
  });

  it("never scrolls the formula inside the tooltip", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const output = view.dom.ownerDocument.querySelector(".ofl-visual-math-tooltip-output");
    expect(output).not.toBeNull();
    expect(getComputedStyle(output as HTMLElement).overflowX).toBe("visible");
    expect(getComputedStyle(output as HTMLElement).overflowY).toBe("visible");
  });

  describe("fitting the formula", () => {
    const DISPLAY = [String.raw`\begin{equation}`, "a = b", String.raw`\end{equation}`].join("\n");

    // jsdom has no layout. The formula is `natural` px wide at full size and
    // the tooltip leaves `room` px for it; KaTeX's 2px spacer comes on top.
    function mountTooltip(natural: number, room: number) {
      const view = mount(stateFor(DISPLAY, DISPLAY.indexOf("a = b")));
      const created = preview(view.state).tooltip?.create(view);
      const dom = created?.dom as HTMLElement;
      // CodeMirror's tooltip host carries the editor's theme classes.
      const host = document.createElement("div");
      host.className = view.themeClasses;
      host.append(dom);
      document.body.append(host);
      const output = dom.querySelector(".ofl-visual-math-tooltip-output") as HTMLElement;
      const scaled = (size: number) =>
        Math.round((size * (Number.parseFloat(output.style.fontSize) || 100)) / 100);
      Object.defineProperty(output, "clientWidth", { get: () => room });
      Object.defineProperty(output, "scrollWidth", { get: () => scaled(natural) + 2 });
      // 120px tall at full size.
      Object.defineProperty(output, "scrollHeight", { get: () => scaled(120) });
      created?.mount?.(view);
      return { dom, output, tooltip: created };
    }

    it("scales a formula wider than the tooltip down until it fits", () => {
      expect(mountTooltip(600, 300).output.style.fontSize).toBe("50%");
    });

    it("leaves a formula that fits at full size", () => {
      expect(mountTooltip(300, 300).output.style.fontSize).toBe("");
    });

    it("scales a formula taller than the room above the line down until it fits", () => {
      const { dom, output, tooltip } = mountTooltip(300, 300);
      const space = { left: 0, top: 0, right: 800, bottom: 600 };

      // CodeMirror caps the height when the line is near the top of the
      // window: 72px inside the border, less 6px of padding above and below.
      Object.defineProperty(dom, "clientHeight", { get: () => 72 });
      dom.style.height = "74px";
      tooltip?.positioned?.(space);
      expect(output.style.fontSize).toBe("50%");

      dom.style.height = "";
      tooltip?.positioned?.(space);
      expect(output.style.fontSize).toBe("");
    });
  });

  it("disables the preview from the menu", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const items = tooltipDom(view).querySelectorAll<HTMLButtonElement>(
      ".ofl-visual-math-tooltip-item",
    );

    items[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(preview(view.state).enabled).toBe(false);
    expect(preview(view.state).tooltip).toBeNull();
  });
});

describe("Typst math preview tooltip", () => {
  const TYPST = "Area $pi r^2$ and `raw $q$` and $ a + b $.";

  function typstState(doc: string, cursor: number): EditorState {
    return EditorState.create({ doc, selection: { anchor: cursor }, extensions: [mathPreviewTooltip("typst")] });
  }

  afterEach(() => {
    setTypstMathHost(null);
    vi.useRealTimers();
  });

  it("finds inline and display equations and skips raw text", () => {
    expect(mathPreviewTargetAt(typstState(TYPST, TYPST.indexOf("pi")), "typst")).toEqual({
      from: TYPST.indexOf("$pi"),
      to: TYPST.indexOf("$pi") + "$pi r^2$".length,
      body: "pi r^2",
      display: false,
    });
    expect(mathPreviewTargetAt(typstState(TYPST, TYPST.indexOf("a + b")), "typst")?.display).toBe(true);
    expect(mathPreviewTargetAt(typstState(TYPST, TYPST.indexOf("q$")), "typst")).toBeNull();
  });

  it("reads the equation from the Typst syntax tree once the parser has loaded", async () => {
    await loadTypstParser();
    const doc = "Text $ a #box[$b$] c $ end";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf(" c ") + 1 },
      extensions: [typstLanguage(), mathPreviewTooltip("typst")],
    });
    expect(preview(state).target?.body).toBe(" a #box[$b$] c ");
    expect(preview(state).tooltip).not.toBeNull();
  });

  it("renders the equation through Typst once the debounce has passed", async () => {
    vi.useFakeTimers();
    const render = vi.fn(async () => ({ status: "rendered" as const, svg: "<svg>pi</svg>" }));
    setTypstMathHost({ render, typstVersion: () => "0.15.1" });
    const view = mount(typstState(TYPST, TYPST.indexOf("pi")));
    const created = preview(view.state).tooltip?.create(view);
    document.body.append(created?.dom as HTMLElement);
    created?.mount?.(view);
    await vi.advanceTimersByTimeAsync(400);
    expect(render).toHaveBeenCalledWith(expect.stringContaining("$pi r^2$"));
    expect(created?.dom.querySelector("img.ofl-typst-math")).not.toBeNull();
    created?.destroy?.();
  });

  it("shows the Typst error message when the equation does not compile", async () => {
    vi.useFakeTimers();
    setTypstMathHost({
      render: async () => ({ status: "failed", message: "unknown variable: foo" }),
      typstVersion: () => "0.15.1",
    });
    const doc = "Broken $foo + x$ here";
    const view = mount(typstState(doc, doc.indexOf("foo")));
    const created = preview(view.state).tooltip?.create(view);
    document.body.append(created?.dom as HTMLElement);
    created?.mount?.(view);
    await vi.advanceTimersByTimeAsync(400);
    expect(created?.dom.querySelector(".ofl-visual-math-tooltip-error")?.textContent).toBe("unknown variable: foo");
    created?.destroy?.();
  });

  it("does not render after the tooltip is destroyed", async () => {
    vi.useFakeTimers();
    const render = vi.fn(async () => ({ status: "rendered" as const, svg: "<svg/>" }));
    setTypstMathHost({ render, typstVersion: () => "0.15.1" });
    const doc = "Gone $g h$ soon";
    const view = mount(typstState(doc, doc.indexOf("g h")));
    const created = preview(view.state).tooltip?.create(view);
    created?.mount?.(view);
    created?.destroy?.();
    view.destroy();
    mounted = null;
    await vi.advanceTimersByTimeAsync(400);
    expect(render).not.toHaveBeenCalled();
  });
});

describe("math preview tooltip interactions", () => {
  function tooltipView(view: EditorView) {
    const tooltip = preview(view.state).tooltip;
    if (!tooltip) throw new Error("no tooltip");
    return tooltip.create(view);
  }

  it("shows the reason for math KaTeX cannot render", () => {
    const doc = String.raw`See $\undefinedmacro x$ here`;
    const view = mount(stateFor(doc, doc.indexOf("x$")));
    const dom = tooltipView(view).dom as HTMLElement;
    const error = dom.querySelector(".ofl-visual-math-tooltip-error");
    expect(error?.getAttribute("role")).toBe("status");
    expect(error?.textContent).toContain("undefinedmacro");
  });

  it("closes the menu on a second toggle, on Escape and on a click outside it", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const dom = tooltipView(view).dom as HTMLElement;
    document.body.append(dom);
    const toggle = dom.querySelector<HTMLButtonElement>(".ofl-visual-math-tooltip-toggle") as HTMLButtonElement;
    const list = dom.querySelector<HTMLElement>(".ofl-visual-math-tooltip-list") as HTMLElement;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    toggle.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    toggle.click();
    toggle.click();
    expect(list.hidden).toBe(true);
    toggle.click();
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(list.hidden).toBe(true);
    expect(preview(view.state).tooltip).not.toBeNull();
    toggle.click();
    list.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(list.hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(list.hidden).toBe(true);
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(preview(view.state).tooltip).not.toBeNull();
  });

  it("closes an open menu when the tooltip is destroyed", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const created = tooltipView(view);
    const dom = created.dom as HTMLElement;
    const list = dom.querySelector<HTMLElement>(".ofl-visual-math-tooltip-list") as HTMLElement;
    dom.querySelector<HTMLButtonElement>(".ofl-visual-math-tooltip-toggle")?.click();
    created.destroy?.();
    expect(list.hidden).toBe(true);
  });

  it("hides the preview with the Escape key binding only while it is shown", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(preview(view.state).tooltip).toBeNull();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it("keeps a hidden preview hidden while edits move it", () => {
    const state = stateFor(INLINE, INLINE_CURSOR).update({ effects: hideMathPreview.of(null) }).state;
    const edited = state.update({ changes: { from: 0, insert: "More " } }).state;
    expect(preview(edited).tooltip).toBeNull();
    expect(preview(edited).hidden).toEqual({ from: INLINE.indexOf("$") + 5, to: INLINE.lastIndexOf("$") + 6 });
  });

  it("does not show the preview while the mouse is held down", () => {
    const view = mount(stateFor(INLINE, OUTSIDE));
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    view.dispatch({ selection: { anchor: INLINE_CURSOR } });
    expect(preview(view.state).target).not.toBeNull();
    expect(preview(view.state).tooltip).toBeNull();
  });
});
