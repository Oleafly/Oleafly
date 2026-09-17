import { type EditorView, WidgetType } from "@codemirror/view";
import { type Root, createRoot } from "react-dom/client";
import { editorMessage } from "../../messages";
import type { ParsedTable, TableEnvironmentInfo } from "./model";
import { TableEditor } from "./TableEditor";

const roots = new WeakMap<HTMLElement, Root>();

function renderInto(element: HTMLElement, node: Parameters<Root["render"]>[0]): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(node);
}

export class TabularWidget extends WidgetType {
  constructor(
    readonly parsed: ParsedTable,
    readonly environment: TableEnvironmentInfo | null,
    readonly directChild: boolean,
    readonly content: string,
  ) {
    super();
  }

  eq(other: TabularWidget): boolean {
    return (
      this.parsed.tabular.from === other.parsed.tabular.from &&
      this.environment?.range.from === other.environment?.range.from &&
      this.environment?.range.to === other.environment?.range.to &&
      this.content === other.content &&
      this.directChild === other.directChild
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = this.environment ? "ofl-visual-table-widget ofl-visual-environment-table" : "ofl-visual-table-widget";
    this.render(element, view);
    return element;
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    element.classList.toggle("ofl-visual-environment-table", this.environment !== null);
    this.render(element, view);
    return true;
  }

  private render(element: HTMLElement, view: EditorView): void {
    const host = { view, parsed: this.parsed, environment: this.environment, directChild: this.directChild };
    renderInto(element, <TableEditor host={host} />);
  }

  destroy(element: HTMLElement): void {
    const root = roots.get(element);
    if (!root) return;
    roots.delete(element);
    queueMicrotask(() => root.unmount());
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "mouseup";
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }

  get estimatedHeight(): number {
    return this.parsed.model.rowCount * 32 + 40;
  }
}

export class TableRenderingErrorWidget extends WidgetType {
  constructor(
    readonly position: number,
    readonly inTableEnvironment: boolean,
  ) {
    super();
  }

  eq(other: TableRenderingErrorWidget): boolean {
    return this.position === other.position && this.inTableEnvironment === other.inTableEnvironment;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = this.inTableEnvironment
      ? "ofl-visual-table-error ofl-visual-environment-table"
      : "ofl-visual-table-error";
    element.setAttribute("role", "alert");
    const title = document.createElement("div");
    title.className = "ofl-visual-table-error-title";
    title.textContent = editorMessage("visual.table.errorTitle");
    const body = document.createElement("div");
    body.textContent = editorMessage("visual.table.errorBody");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "ofl-visual-table-error-action";
    action.textContent = editorMessage("visual.table.viewSource");
    action.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: this.position } });
      view.focus();
    });
    element.append(title, body, action);
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }

  get estimatedHeight(): number {
    return 72;
  }
}
