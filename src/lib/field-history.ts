export type HistoryCommand = "undo" | "redo";

export function historyCommand(event: KeyboardEvent): HistoryCommand | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}

const WIDGET_FIELDS = "input, textarea, select";
const VISUAL_FORM = "[data-ofl-visual-form]";

export function inDocumentEditor(active: Element | null): boolean {
  if (!active) return false;
  if (active.closest(".ProseMirror")) return true;
  return !!active.closest(".cm-content") && !active.matches(WIDGET_FIELDS);
}

export function inVisualForm(active: Element | null): boolean {
  return !!active?.closest(VISUAL_FORM);
}

export function visualFormHistory(active: Element | null): "field" | "document" | null {
  if (!active || !inVisualForm(active)) return null;
  return active instanceof HTMLElement && active.dataset.oflFormDraft !== undefined ? "field" : "document";
}

export function inWidgetControl(active: Element | null): boolean {
  if (!active) return false;
  if (inVisualForm(active)) return true;
  return active.matches(`${WIDGET_FIELDS}, button`) && !!active.closest(".cm-content");
}

export function inPlainField(active: Element | null): boolean {
  if (!(active instanceof HTMLElement) || inDocumentEditor(active)) return false;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable;
}

type EditingDocument = { execCommand(commandId: string): boolean };

export function runFieldHistory(documentObject: Document, command: HistoryCommand): void {
  (documentObject as unknown as EditingDocument).execCommand(command);
}

export function installPlainFieldHistory(windowObject: Window = window): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const command = historyCommand(event);
    if (!command || !inPlainField(windowObject.document.activeElement)) return;
    event.preventDefault();
    runFieldHistory(windowObject.document, command);
  };
  windowObject.addEventListener("keydown", onKey);
  return () => windowObject.removeEventListener("keydown", onKey);
}
