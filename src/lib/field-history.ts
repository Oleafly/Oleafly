export type HistoryCommand = "undo" | "redo";

export function historyCommand(event: KeyboardEvent): HistoryCommand | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}

export function inDocumentEditor(active: Element | null): boolean {
  return !!(active?.closest(".cm-content") || active?.closest(".ProseMirror"));
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
