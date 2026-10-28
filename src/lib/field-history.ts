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

// A control a widget draws inside the source text, such as a Visual table cell or a form
// field, is a field of its own: its typing has its own undo.
export function inDocumentEditor(active: Element | null): boolean {
  if (!active) return false;
  if (active.closest(".ProseMirror")) return true;
  return !!active.closest(".cm-content") && !active.matches(WIDGET_FIELDS);
}

// A Visual-mode form, a card or a chip's popover, handles its own history keys.
export function inVisualForm(active: Element | null): boolean {
  return !!active?.closest(VISUAL_FORM);
}

// What the Edit menu's Undo and Redo act on from inside a form: a field holding typing not
// yet written to the document undoes that typing, anything else the document. Null outside
// a form.
export function visualFormHistory(active: Element | null): "field" | "document" | null {
  if (!active || !inVisualForm(active)) return null;
  return active.hasAttribute("data-ofl-form-draft") ? "field" : "document";
}

// Keys typed in a form, or in a control a widget draws in the text, aren't typing in the
// document, so document shortcuts such as bold leave them alone.
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
