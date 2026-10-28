import { selectAll } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";

// Clipboard commands for the editor's right-click menu. A menu click is not a
// copy or paste event, so the text goes through the clipboard module, and a
// paste re-enters CodeMirror as a paste event so its input filters and the
// paste offers that listen for "input.paste" still run.

export function hasSelectedText(state: EditorState): boolean {
  return state.selection.ranges.some((range) => !range.empty);
}

function selectedText(state: EditorState): string {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join(state.lineBreak);
}

export async function copySelection(view: EditorView): Promise<void> {
  if (!hasSelectedText(view.state)) return;
  await writeClipboardText(selectedText(view.state)).catch(() => undefined);
}

export async function cutSelection(view: EditorView): Promise<void> {
  if (view.state.readOnly || !hasSelectedText(view.state)) return;
  try {
    await writeClipboardText(selectedText(view.state));
  } catch {
    return;
  }
  view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut", scrollIntoView: true });
}

function pasteEvent(text: string): ClipboardEvent | null {
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    // Without clipboard data CodeMirror would read an empty paste target and
    // replace the selection with nothing.
    return event.clipboardData?.getData("text/plain") === text ? event : null;
  } catch {
    return null;
  }
}

export async function pasteClipboard(view: EditorView): Promise<void> {
  if (view.state.readOnly) return;
  let text: string;
  try {
    text = await readClipboardText();
  } catch {
    return;
  }
  if (!text) return;
  view.focus();
  const event = pasteEvent(text);
  if (event) {
    view.contentDOM.dispatchEvent(event);
    return;
  }
  view.dispatch(view.state.replaceSelection(text.replace(/\r\n?/gu, "\n")), {
    userEvent: "input.paste",
    scrollIntoView: true,
  });
}

export function selectAllText(view: EditorView): void {
  selectAll(view);
  view.focus();
}
