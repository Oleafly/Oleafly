import { type EditorView, WidgetType } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import type { TableDialect, TableHost } from "../../table/contexts";
import { TableEditor } from "../../table/TableEditor";
import type { TextRange } from "../syntax";
import { sanitizeTypstCell, typstAppendRowEdit } from "./commands";
import type { TypstTable } from "./parse";
import { TypstTableContext, type TypstTableInfo, TypstTableToolbar } from "./Toolbar";

const roots = new WeakMap<HTMLElement, Root>();

function rootFor(element: HTMLElement): Root {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  return root;
}

function dialectFor(table: TypstTable): TableDialect {
  return {
    sanitizeCellInput: sanitizeTypstCell,
    appendRowEdit: (state) => typstAppendRowEdit(state, table),
    Toolbar: TypstTableToolbar,
    Dialogs: null,
  };
}

export class TypstTableWidget extends WidgetType {
  constructor(
    readonly table: TypstTable,
    readonly removal: TextRange,
    readonly content: string,
  ) {
    super();
  }

  eq(other: TypstTableWidget): boolean {
    return (
      other.table.call.from === this.table.call.from &&
      other.removal.from === this.removal.from &&
      other.removal.to === this.removal.to &&
      other.content === this.content
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "ofl-visual-table-widget ofl-visual-typst-table";
    this.render(element, view);
    return element;
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    this.render(element, view);
    return true;
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
    return this.table.parsed.model.rowCount * 32 + 40;
  }

  private render(element: HTMLElement, view: EditorView): void {
    const host: TableHost = {
      view,
      parsed: this.table.parsed,
      environment: null,
      directChild: false,
      dialect: dialectFor(this.table),
    };
    const info: TypstTableInfo = { table: this.table, removal: this.removal };
    rootFor(element).render(
      <TypstTableContext.Provider value={info}>
        <TableEditor host={host} />
      </TypstTableContext.Provider>,
    );
  }
}
