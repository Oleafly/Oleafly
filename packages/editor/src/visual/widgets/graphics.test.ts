// @vitest-environment jsdom

import { EditorState, type Range } from "@codemirror/state";
import { type Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { latexLanguage as latexTreeLanguage } from "codemirror-lang-latex";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VisualImage, VisualPorts } from "../types";
import { createGraphicsDecoration } from "./graphics";

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
