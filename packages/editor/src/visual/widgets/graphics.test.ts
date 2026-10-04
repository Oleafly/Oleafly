// @vitest-environment jsdom

import { EditorState, type Range } from "@codemirror/state";
import { type Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { latexLanguage as latexTreeLanguage } from "codemirror-lang-latex";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VisualImage, VisualPorts } from "../types";
import { createGraphicsDecoration, GraphicsWidget, type GraphicsOptions } from "./graphics";

let mounted: EditorView | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
});

function graphicsNodes(doc: string): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  latexTreeLanguage.parser.parse(doc).iterate({
    enter(node) {
      if (node.type.is("IncludeGraphics") || node.type.is("IncludeSvg")) {
        nodes.push(node.node);
      }
    },
  });
  return nodes;
}

function decorate(
  doc: string,
  options: { cursor?: number; ports?: VisualPorts | null } = {},
): Range<Decoration>[] {
  const state = EditorState.create({
    doc,
    selection: options.cursor === undefined ? undefined : { anchor: options.cursor },
  });
  return graphicsNodes(doc).flatMap((node) =>
    createGraphicsDecoration(node, state, options.ports ?? null),
  );
}

function resolvingPorts(image: VisualImage | null, edit?: VisualPorts["openFigureEditor"]) {
  const ports: VisualPorts = {
    resolveImage: vi.fn(async () => image),
  };
  if (edit) ports.openFigureEditor = edit;
  return ports;
}

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  mounted = new EditorView({ state: EditorState.create({ doc }), parent });
  return mounted;
}

const INTRO = "Intro.\n\n";
const SOLO = `${INTRO}${String.raw`\includegraphics{a.png}`}`;
const SOLO_FROM = INTRO.length;
const SOLO_TO = SOLO.length;

const FIGURE = [
  String.raw`\begin{figure}`,
  String.raw`\centering`,
  String.raw`\includegraphics[width=0.5\textwidth]{images/plot.png}`,
  String.raw`\caption{A plot}`,
  String.raw`\end{figure}`,
].join("\n");

describe("createGraphicsDecoration", () => {
  it("replaces the whole line with a block widget when the command is alone on it", () => {
    const decorations = decorate(FIGURE);
    expect(decorations).toHaveLength(1);

    const commandFrom = FIGURE.indexOf(String.raw`\includegraphics`);
    const line = FIGURE.slice(0, commandFrom).lastIndexOf("\n") + 1;
    expect(decorations[0].from).toBe(line);
    expect(decorations[0].to).toBe(FIGURE.indexOf("\n", commandFrom));
    expect(decorations[0].value.spec.block).toBe(true);
  });

  it("keeps the widget inline when other content shares the line", () => {
    const doc = String.raw`Before \includegraphics{a.png} after.`;
    const decorations = decorate(doc);
    expect(decorations).toHaveLength(1);
    expect(decorations[0].from).toBe(doc.indexOf(String.raw`\includegraphics`));
    expect(decorations[0].to).toBe(doc.indexOf("}") + 1);
    expect(decorations[0].value.spec.block).toBeFalsy();
  });

  it("produces nothing while the selection touches the command", () => {
    const doc = String.raw`\includegraphics{a.png}`;
    expect(decorate(doc, { cursor: 4 })).toEqual([]);
    expect(decorate(doc, { cursor: 0 })).toEqual([]);
    expect(decorate(doc, { cursor: doc.length })).toEqual([]);
  });

  it("still decorates a read-only document under the selection", () => {
    const doc = String.raw`\includegraphics{a.png}`;
    const state = EditorState.create({
      doc,
      selection: { anchor: 4 },
      extensions: [EditorState.readOnly.of(true)],
    });
    const decorations = graphicsNodes(doc).flatMap((node) =>
      createGraphicsDecoration(node, state, null),
    );
    expect(decorations).toHaveLength(1);
  });

  it("renders .svg paths only through includesvg", () => {
    expect(decorate(`${INTRO}${String.raw`\includegraphics{drawing.SVG}`}`)).toEqual([]);
    expect(decorate(`${INTRO}${String.raw`\includesvg{drawing.svg}`}`)).toHaveLength(1);
  });

  it("ignores a command without a file path", () => {
    expect(decorate(`${INTRO}${String.raw`\includegraphics{}`}`)).toEqual([]);
  });

  it("centers the block widget when the figure environment is centered", () => {
    const view = mount(FIGURE);
    const [centered] = decorate(FIGURE);
    const centeredDom = centered.value.spec.widget.toDOM(view) as HTMLElement;
    expect(centeredDom.classList.contains("ofl-visual-graphics-centered")).toBe(true);
    expect(centeredDom.style.textAlign).toBe("center");

    const plain = FIGURE.replace(`${String.raw`\centering`}\n`, "");
    const [uncentered] = decorate(plain);
    const uncenteredDom = uncentered.value.spec.widget.toDOM(view) as HTMLElement;
    expect(uncenteredDom.classList.contains("ofl-visual-graphics-centered")).toBe(false);
  });

  it("does not take centering from a nested environment", () => {
    const doc = [
      String.raw`\begin{figure}`,
      String.raw`\begin{minipage}{0.5\textwidth}`,
      String.raw`\centering`,
      String.raw`\end{minipage}`,
      String.raw`\includegraphics{a.png}`,
      String.raw`\end{figure}`,
    ].join("\n");
    const view = mount(doc);
    const [decoration] = decorate(doc);
    const dom = decoration.value.spec.widget.toDOM(view) as HTMLElement;
    expect(dom.classList.contains("ofl-visual-graphics-centered")).toBe(false);
  });

  it("shows the image the port resolves", async () => {
    const view = mount(SOLO);
    const ports = resolvingPorts({ url: "asset://a.png", kind: "raster" });
    const [decoration] = decorate(SOLO, { ports });
    const dom = decoration.value.spec.widget.toDOM(view) as HTMLElement;

    expect(dom.textContent).toBe("visual.graphics.loading");
    await vi.waitFor(() => {
      expect(dom.querySelector("img")).not.toBeNull();
    });
    expect(dom.querySelector("img")?.getAttribute("src")).toBe("asset://a.png");
    expect(ports.resolveImage).toHaveBeenCalledWith("a.png");
  });

  it("shows the failure text when the port cannot resolve the path", async () => {
    const doc = `${INTRO}${String.raw`\includegraphics{missing.png}`}`;
    const view = mount(doc);
    const [decoration] = decorate(doc, { ports: resolvingPorts(null) });
    const dom = decoration.value.spec.widget.toDOM(view) as HTMLElement;

    await vi.waitFor(() => {
      expect(dom.querySelector(".ofl-visual-graphics-error")).not.toBeNull();
    });
    expect(dom.textContent).toContain("visual.graphics.loadFailed");
    expect(dom.textContent).toContain("missing.png");
  });

  it("offers an edit button only when the port can open the figure editor", () => {
    const view = mount(SOLO);

    const withoutEditor = decorate(SOLO, {
      ports: resolvingPorts({ url: "u", kind: "raster" }),
    })[0].value.spec.widget.toDOM(view) as HTMLElement;
    expect(withoutEditor.querySelector(".ofl-visual-graphics-edit")).toBeNull();

    const openFigureEditor = vi.fn();
    const withEditor = decorate(SOLO, {
      ports: resolvingPorts({ url: "u", kind: "raster" }, openFigureEditor),
    })[0].value.spec.widget.toDOM(view) as HTMLElement;
    const button = withEditor.querySelector<HTMLButtonElement>(".ofl-visual-graphics-edit");
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(openFigureEditor).toHaveBeenCalledWith({ from: SOLO_FROM, to: SOLO_TO });
  });
});

function widget(options: Partial<GraphicsOptions> = {}): GraphicsWidget {
  return new GraphicsWidget({
    path: "a.png",
    centered: false,
    block: true,
    range: { from: 1, to: 5 },
    ports: null,
    ...options,
  });
}

async function loadedImage(dom: HTMLElement): Promise<HTMLImageElement> {
  for (let tick = 0; tick < 5 && !dom.querySelector("img"); tick += 1) await Promise.resolve();
  const image = dom.querySelector("img");
  if (!image) throw new Error("The image was not shown");
  return image;
}

describe("graphics widget lifecycle", () => {
  it("compares widgets by path, centering, layout and editability", () => {
    const base = widget();
    expect(base.eq(widget())).toBe(true);
    expect(base.eq(widget({ path: "b.png" }))).toBe(false);
    expect(base.eq(widget({ centered: true }))).toBe(false);
    expect(base.eq(widget({ block: false }))).toBe(false);
    expect(base.eq(widget({ ports: resolvingPorts(null, vi.fn()) }))).toBe(false);
    expect(base.ignoreEvent(new MouseEvent("mouseup"))).toBe(false);
    expect(base.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
  });

  it("estimates inline graphics by line height and remembers a loaded block image's height", async () => {
    const view = mount(SOLO);
    expect(widget({ block: false }).estimatedHeight).toBe(-1);
    expect(widget({ path: "tall.png" }).estimatedHeight).toBe(180);
    const dom = widget({ path: "tall.png", ports: resolvingPorts({ url: "u", kind: "raster" }) }).toDOM(view);
    const image = await loadedImage(dom);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ height: 120 } as DOMRect);
    const measure = vi.spyOn(view, "requestMeasure");
    image.dispatchEvent(new Event("load"));
    expect(measure).toHaveBeenCalled();
    expect(widget({ path: "tall.png" }).estimatedHeight).toBe(120);
  });

  it("keeps the most recent two hundred measured heights", async () => {
    const view = mount(SOLO);
    const rect = vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 90 } as DOMRect);
    for (let index = 0; index <= 200; index += 1) {
      const dom = widget({ path: `many-${index}.png`, ports: resolvingPorts({ url: "u", kind: "raster" }) }).toDOM(view);
      (await loadedImage(dom)).dispatchEvent(new Event("load"));
    }
    rect.mockRestore();
    expect(widget({ path: "many-0.png" }).estimatedHeight).toBe(180);
    expect(widget({ path: "many-200.png" }).estimatedHeight).toBe(90);
  });

  it("does not remember a zero height", async () => {
    const view = mount(SOLO);
    const dom = widget({ path: "flat.png", ports: resolvingPorts({ url: "u", kind: "raster" }) }).toDOM(view);
    const image = await loadedImage(dom);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ height: 0 } as DOMRect);
    image.dispatchEvent(new Event("load"));
    expect(widget({ path: "flat.png" }).estimatedHeight).toBe(180);
  });

  it("styles inline graphics as inline blocks", () => {
    const view = mount(SOLO);
    const dom = widget({ block: false }).toDOM(view);
    expect(dom.tagName).toBe("SPAN");
    expect(dom.className).toBe("ofl-visual-graphics ofl-visual-graphics-inline");
    expect(dom.style.display).toBe("inline-block");
    expect(widget().coordsAt(dom)).toBeDefined();
  });

  it("shows the failure box at once without ports and when loading throws or the image breaks", async () => {
    const view = mount(SOLO);
    expect(widget().toDOM(view).querySelector(".ofl-visual-graphics-error")).not.toBeNull();
    const rejecting: VisualPorts = { resolveImage: vi.fn(async () => Promise.reject(new Error("io"))) };
    const rejected = widget({ ports: rejecting }).toDOM(view);
    await vi.waitFor(() => {
      expect(rejected.querySelector(".ofl-visual-graphics-error")).not.toBeNull();
    });
    const broken = widget({ ports: resolvingPorts({ url: "u", kind: "raster" }) }).toDOM(view);
    const image = await loadedImage(broken);
    image.dispatchEvent(new Event("error"));
    expect(broken.querySelector("img")).toBeNull();
    expect(broken.querySelectorAll(".ofl-visual-graphics-error")).toHaveLength(1);
  });

  it("keeps the rendered image when updated with the same path and re-renders for a new path", async () => {
    const view = mount(SOLO);
    const ports = resolvingPorts({ url: "u", kind: "raster" });
    const dom = widget({ ports }).toDOM(view);
    const image = await loadedImage(dom);
    expect(widget({ ports, range: { from: 7, to: 9 } }).updateDOM(dom, view)).toBe(true);
    expect(dom.querySelector("img")).toBe(image);
    expect([dom.dataset.graphicsFrom, dom.dataset.graphicsTo]).toEqual(["7", "9"]);
    const measure = vi.spyOn(view, "requestMeasure");
    expect(widget({ ports, path: "b.png" }).updateDOM(dom, view)).toBe(true);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(dom.dataset.graphicsPath).toBe("b.png");
    image.dispatchEvent(new Event("load"));
    image.dispatchEvent(new Event("error"));
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("ignores a resolution that arrives after the widget is destroyed", async () => {
    const view = mount(SOLO);
    let resolve: (image: VisualImage | null) => void = () => {};
    const ports: VisualPorts = { resolveImage: () => new Promise((done) => (resolve = done)) };
    const subject = widget({ ports });
    const dom = subject.toDOM(view);
    subject.destroy(dom);
    expect(dom.dataset.graphicsGeneration).toBeUndefined();
    resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(dom.querySelector(".ofl-visual-graphics-error")).toBeNull();
    expect(dom.textContent).toBe("visual.graphics.loading");
  });

  it("places the cursor on a click in the block but not on the edit button", () => {
    const view = mount(SOLO);
    const dispatch = vi.spyOn(view, "dispatch");
    const dom = widget({ ports: resolvingPorts(null, vi.fn()) }).toDOM(view);
    dom.querySelector(".ofl-visual-graphics-edit")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("reveals the edit button on hover and keeps the editor focused when pressed", () => {
    const view = mount(SOLO);
    const openFigureEditor = vi.fn();
    const dom = widget({ ports: resolvingPorts(null, openFigureEditor) }).toDOM(view);
    const button = dom.querySelector<HTMLButtonElement>(".ofl-visual-graphics-edit") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("visual.graphics.edit");
    dom.dispatchEvent(new MouseEvent("mouseenter"));
    expect(button.style.opacity).toBe("1");
    dom.dispatchEvent(new MouseEvent("mouseleave"));
    expect(button.style.opacity).toBe("0");
    button.dispatchEvent(new MouseEvent("mouseenter"));
    expect(button.style.background).toBe("var(--accent)");
    button.dispatchEvent(new MouseEvent("mouseleave"));
    expect(button.style.background).toBe("var(--background)");
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    delete dom.dataset.graphicsFrom;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(openFigureEditor).not.toHaveBeenCalled();
  });
});
