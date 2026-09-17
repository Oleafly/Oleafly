import type { EditorState, Line, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { editorMessage } from "../../messages";
import { placeSelectionInsideBlock } from "../selection";
import type { VisualImage, VisualPorts, VisualRange } from "../types";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_GRAPHIC_WIDTH = 300;
const EDIT_BUTTON_CLASS = "ofl-visual-graphics-edit";
const PENCIL_PATH = "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z";

const MAX_TRACKED_HEIGHTS = 200;
const measuredHeights = new Map<string, number>();
let generationCounter = 0;

function rememberHeight(path: string, height: number) {
  measuredHeights.delete(path);
  measuredHeights.set(path, height);
  while (measuredHeights.size > MAX_TRACKED_HEIGHTS) {
    const oldest = measuredHeights.keys().next().value;
    if (oldest === undefined) break;
    measuredHeights.delete(oldest);
  }
}

function selectionTouches(state: EditorState, extents: VisualRange): boolean {
  return state.selection.ranges.some(
    (range) =>
      (extents.from <= range.from && extents.to >= range.from) ||
      (extents.from <= range.to && extents.to >= range.to),
  );
}

function shouldRender(state: EditorState, extents: VisualRange): boolean {
  return state.readOnly || !selectionTouches(state, extents);
}

function lineHoldsOnlyNode(line: Line, extents: VisualRange): boolean {
  return line.text.trim().length === extents.to - extents.from;
}

function ancestorOfType(node: SyntaxNode | null, type: string): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.type.is(type)) return current;
  }
  return null;
}

function hasCentering(environment: SyntaxNode): boolean {
  let found = false;
  let atRoot = true;
  environment.cursor().iterate((nodeRef) => {
    if (found) return false;
    if (atRoot) {
      atRoot = false;
      return true;
    }
    if (nodeRef.type.is("CenteringCtrlSeq")) {
      found = true;
      return false;
    }
    return !nodeRef.type.is("$Environment");
  });
  return found;
}

function filePathNode(node: SyntaxNode, svg: boolean): SyntaxNode | null {
  const argument = node.getChild(svg ? "IncludeSvgArgument" : "IncludeGraphicsArgument");
  return argument?.getChild("FilePathArgument")?.getChild("LiteralArgContent") ?? null;
}

function pencilIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", PENCIL_PATH);
  svg.append(path);
  return svg;
}

interface GraphicsOptions {
  path: string;
  centered: boolean;
  block: boolean;
  range: VisualRange;
  ports: VisualPorts | null;
}

class GraphicsWidget extends WidgetType {
  private readonly editable: boolean;

  constructor(private readonly options: GraphicsOptions) {
    super();
    this.editable = typeof options.ports?.openFigureEditor === "function";
  }

  get estimatedHeight(): number {
    if (!this.options.block) return -1;
    return measuredHeights.get(this.options.path) ?? 180;
  }

  eq(other: GraphicsWidget): boolean {
    return (
      other.options.path === this.options.path &&
      other.options.centered === this.options.centered &&
      other.options.block === this.options.block &&
      other.editable === this.editable
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const host: HTMLElement = document.createElement(this.options.block ? "div" : "span");
    host.className = this.options.block
      ? "ofl-visual-graphics ofl-visual-graphics-block"
      : "ofl-visual-graphics ofl-visual-graphics-inline";
    host.setAttribute("contenteditable", "false");
    this.applyHostStyle(host);
    this.render(host, view);
    if (this.options.block) {
      host.addEventListener("mouseup", (event) => {
        if (event.target instanceof HTMLElement && event.target.closest(`.${EDIT_BUTTON_CLASS}`)) {
          return;
        }
        event.preventDefault();
        view.dispatch(placeSelectionInsideBlock(view, event));
      });
    }
    return host;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    this.applyHostStyle(dom);
    if (dom.dataset.graphicsPath === this.options.path) {
      dom.dataset.graphicsFrom = String(this.options.range.from);
      dom.dataset.graphicsTo = String(this.options.range.to);
      return true;
    }
    this.render(dom, view);
    view.requestMeasure();
    return true;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "mouseup";
  }

  destroy(dom: HTMLElement): void {
    delete dom.dataset.graphicsGeneration;
  }

  coordsAt(dom: HTMLElement): DOMRect {
    return dom.getBoundingClientRect();
  }

  private applyHostStyle(host: HTMLElement) {
    host.classList.toggle("ofl-visual-graphics-centered", this.options.centered);
    if (this.options.block) {
      host.style.display = "block";
      host.style.margin = "0.35em 0";
      host.style.textAlign = this.options.centered ? "center" : "left";
      return;
    }
    host.style.display = "inline-block";
    host.style.verticalAlign = "middle";
    host.style.maxWidth = "100%";
  }

  private render(host: HTMLElement, view: EditorView) {
    const generation = String(++generationCounter);
    host.dataset.graphicsPath = this.options.path;
    host.dataset.graphicsFrom = String(this.options.range.from);
    host.dataset.graphicsTo = String(this.options.range.to);
    host.dataset.graphicsGeneration = generation;
    host.replaceChildren();

    const frame = document.createElement("span");
    frame.className = "ofl-visual-graphics-frame";
    frame.style.position = "relative";
    frame.style.display = "inline-block";
    frame.style.maxWidth = "100%";
    frame.style.lineHeight = "0";
    host.append(frame);

    const status = document.createElement("span");
    status.className = "ofl-visual-graphics-status";
    status.style.color = "var(--muted-foreground)";
    status.style.font = "500 11px/1.4 var(--font-sans)";
    status.style.display = "inline-block";
    status.style.padding = "0.2em 0.4em";
    status.textContent = editorMessage("visual.graphics.loading");
    frame.append(status);

    if (this.editable) frame.append(this.editButton(host));

    const ports = this.options.ports;
    const current = () => host.dataset.graphicsGeneration === generation;
    if (!ports) {
      this.showError(frame, view, current);
      return;
    }

    ports
      .resolveImage(this.options.path)
      .then((image) => {
        if (!current()) return;
        if (image) this.showImage(frame, view, image, current);
        else this.showError(frame, view, current);
      })
      .catch(() => {
        this.showError(frame, view, current);
      });
  }

  private editButton(host: HTMLElement): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = EDIT_BUTTON_CLASS;
    button.setAttribute("aria-label", editorMessage("visual.graphics.edit"));
    button.style.position = "absolute";
    button.style.top = "4px";
    button.style.right = "4px";
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.width = "22px";
    button.style.height = "22px";
    button.style.padding = "0";
    button.style.border = "1px solid var(--border)";
    button.style.borderRadius = "5px";
    button.style.background = "var(--background)";
    button.style.color = "var(--foreground)";
    button.style.cursor = "pointer";
    button.style.outline = "none";
    button.style.opacity = "0";
    button.style.transition = "opacity 120ms ease, background-color 120ms ease";
    button.append(pencilIcon());

    const reveal = (visible: boolean) => {
      button.style.opacity = visible ? "1" : "0";
    };
    host.addEventListener("mouseenter", () => reveal(true));
    host.addEventListener("mouseleave", () => reveal(false));
    button.addEventListener("mouseenter", () => {
      button.style.background = "var(--accent)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--background)";
    });
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const from = Number(host.dataset.graphicsFrom);
      const to = Number(host.dataset.graphicsTo);
      if (Number.isFinite(from) && Number.isFinite(to)) {
        this.options.ports?.openFigureEditor?.({ from, to });
      }
    });
    return button;
  }

  private showImage(
    frame: HTMLElement,
    view: EditorView,
    image: VisualImage,
    current: () => boolean,
  ) {
    const element = document.createElement("img");
    element.className = "ofl-visual-graphics-image";
    element.alt = this.options.path;
    element.style.display = "block";
    element.style.maxWidth = `min(100%, ${MAX_GRAPHIC_WIDTH}px)`;
    element.style.height = "auto";
    element.style.borderRadius = "3px";
    element.addEventListener("load", () => {
      if (!current()) return;
      const height = element.getBoundingClientRect().height;
      if (height > 0) rememberHeight(this.options.path, height);
      view.requestMeasure();
    });
    element.addEventListener("error", () => {
      this.showError(frame, view, current);
    });
    element.src = image.url;
    frame.prepend(element);
    frame.querySelector(".ofl-visual-graphics-status")?.remove();
  }

  private showError(frame: HTMLElement, view: EditorView, current: () => boolean) {
    if (!current()) return;
    frame.querySelector(".ofl-visual-graphics-image")?.remove();
    frame.querySelector(".ofl-visual-graphics-status")?.remove();
    frame.querySelector(".ofl-visual-graphics-error")?.remove();

    const box = document.createElement("span");
    box.className = "ofl-visual-graphics-error";
    box.setAttribute("role", "status");
    box.style.display = "inline-flex";
    box.style.flexDirection = "column";
    box.style.gap = "2px";
    box.style.maxWidth = `${MAX_GRAPHIC_WIDTH}px`;
    box.style.padding = "8px 10px";
    box.style.border = "1px solid var(--border)";
    box.style.borderRadius = "6px";
    box.style.background = "color-mix(in srgb, var(--muted) 60%, transparent)";
    box.style.textAlign = "left";

    const title = document.createElement("span");
    title.style.color = "var(--muted-foreground)";
    title.style.font = "500 11px/1.4 var(--font-sans)";
    title.textContent = editorMessage("visual.graphics.loadFailed");

    const path = document.createElement("span");
    path.style.color = "var(--muted-foreground)";
    path.style.font = "400 11px/1.4 var(--font-mono)";
    path.style.wordBreak = "break-all";
    path.textContent = this.options.path;

    box.append(title, path);
    frame.prepend(box);
    measuredHeights.delete(this.options.path);
    view.requestMeasure();
  }
}

export function createGraphicsDecoration(
  nodeRef: SyntaxNodeRef,
  state: EditorState,
  ports: VisualPorts | null,
): Range<Decoration>[] {
  const svg = nodeRef.type.is("IncludeSvg");
  if (!svg && !nodeRef.type.is("IncludeGraphics")) return [];

  const range: VisualRange = { from: nodeRef.from, to: nodeRef.to };
  if (!shouldRender(state, range)) return [];

  const pathNode = filePathNode(nodeRef.node, svg);
  if (!pathNode) return [];

  const path = state.doc.sliceString(pathNode.from, pathNode.to).trim();
  if (!path) return [];
  if (!svg && path.toLowerCase().endsWith(".svg")) return [];

  const environment = ancestorOfType(nodeRef.node, "FigureEnvironment");
  const centered = environment !== null && hasCentering(environment);
  const line = state.doc.lineAt(range.from);

  if (lineHoldsOnlyNode(line, range)) {
    return [
      Decoration.replace({
        widget: new GraphicsWidget({ path, centered, block: true, range, ports }),
        block: true,
      }).range(line.from, line.to),
    ];
  }

  return [
    Decoration.replace({
      widget: new GraphicsWidget({ path, centered, block: false, range, ports }),
    }).range(range.from, range.to),
  ];
}
