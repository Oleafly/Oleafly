import type { Page } from "./helpers";
import { scriptValue } from "./script-value";

export type RichEditor = "visual" | "note";

function editorOf(which: RichEditor): string {
  return which === "visual"
    ? `(await import("/src/components/editor/wysiwyg/controller.ts")).getWysiwygEditor()`
    : `([...document.querySelectorAll("[data-note-blank] .ProseMirror")].find((node) => !node.closest("[hidden]"))?.editor ?? null)`;
}

export async function richEditorText(page: Page, which: RichEditor): Promise<string> {
  return page.evaluate<string>(`(async () => {
    const editor = ${editorOf(which)};
    return editor && !editor.isDestroyed ? editor.getText() : "";
  })()`);
}

export async function richEditorEditable(page: Page, which: RichEditor): Promise<boolean> {
  return page.evaluate<boolean>(`(async () => {
    const editor = ${editorOf(which)};
    return !!editor && !editor.isDestroyed && editor.isEditable;
  })()`);
}

export async function richCaretContext(page: Page, which: RichEditor): Promise<string> {
  return page.evaluate<string>(`(async () => {
    const editor = ${editorOf(which)};
    if (!editor || editor.isDestroyed) return "";
    const head = editor.state.selection.$head;
    return head.parent.textBetween(0, head.parentOffset);
  })()`);
}

async function typeRich(page: Page, which: RichEditor, anchor: string | null, text: string, delayMs: number): Promise<boolean> {
  return page.evaluate<boolean>(`(async () => {
    const editor = ${editorOf(which)};
    if (!editor || editor.isDestroyed || !editor.isEditable) return false;
    const anchor = ${scriptValue(anchor)};
    if (anchor !== null) {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at >= 0 || !node.isText || !node.text) return at < 0;
        const index = node.text.indexOf(anchor);
        if (index >= 0) at = pos + index + anchor.length;
        return false;
      });
      if (at < 0) return false;
      editor.commands.focus();
      editor.commands.setTextSelection(at);
    }
    for (const character of ${scriptValue(text)}) {
      const head = editor.state.selection.head;
      editor.view.dispatch(editor.state.tr.insertText(character, head).scrollIntoView());
      await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
    }
    return true;
  })()`);
}

export async function typeInRichEditorAfter(page: Page, which: RichEditor, anchor: string, text: string, delayMs = 30) {
  if (!(await typeRich(page, which, anchor, text, delayMs))) {
    throw new Error(`the ${which} editor has no ${JSON.stringify(anchor)} to type after, or it can't be edited`);
  }
}

export async function typeInRichEditorAtCaret(page: Page, which: RichEditor, text: string, delayMs = 30) {
  if (!(await typeRich(page, which, null, text, delayMs))) throw new Error(`the ${which} editor can't be edited`);
}

export async function waitRichEditorText(page: Page, which: RichEditor, needles: readonly string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await richEditorText(page, which);
    if (needles.every((needle) => text.includes(needle))) return text;
    if (Date.now() > deadline) {
      throw new Error(`the ${which} editor never showed ${JSON.stringify(needles)}; it shows ${JSON.stringify(text.slice(0, 800))}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
