import { lineNumbers, EditorView } from "@codemirror/view";
import { latexLanguage } from "codemirror-lang-latex";
import { centerWithinEditor, revealEditorRange } from "/packages/editor/src/controller.ts";
import { liveMathPreview } from "/packages/editor/src/math-preview.ts";
import { editorTheme } from "/packages/editor/src/theme.ts";
import { buildLargeLatexBookProject } from "/test/fixtures/editor-support/large-book.ts";

const source = buildLargeLatexBookProject().source;
const warnings: string[] = [];
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "));
  originalWarn(...args);
};

let view: EditorView | null = null;

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

function gutterDrift(current: EditorView): number {
  const viewport = current.scrollDOM.getBoundingClientRect();
  const onScreen = (rect: DOMRect) => rect.bottom >= viewport.top && rect.top <= viewport.bottom;
  let drift = 0;
  for (const gutter of Array.from(current.dom.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement"))) {
    const text = gutter.textContent?.trim() ?? "";
    if (!/^\d+$/.test(text) || gutter.style.visibility === "hidden") continue;
    const lineNumber = Number(text);
    if (lineNumber < 1 || lineNumber > current.state.doc.lines) continue;
    const position = current.domAtPos(current.state.doc.line(lineNumber).from, 1);
    const element = position.node.nodeType === Node.ELEMENT_NODE ? (position.node as Element) : position.node.parentElement;
    const line = element?.closest(".cm-line");
    if (!line) continue;
    const lineRect = line.getBoundingClientRect();
    const gutterRect = gutter.getBoundingClientRect();
    if (onScreen(lineRect) || onScreen(gutterRect)) drift = Math.max(drift, Math.abs(gutterRect.top - lineRect.top));
  }
  return drift;
}

function centerOffset(current: EditorView, position: number): number {
  const block = current.lineBlockAt(position);
  const box = current.scrollDOM.getBoundingClientRect();
  return current.documentTop + block.top + block.height / 2 - (box.top + current.scrollDOM.clientHeight / 2);
}

async function jumpThrough(width: number, lines: number[]) {
  view?.destroy();
  warnings.length = 0;
  const host = document.getElementById("host");
  if (!host) throw new Error("host is missing");
  host.style.width = `${width}px`;
  view = new EditorView({
    parent: host,
    doc: source,
    extensions: [
      editorTheme(),
      lineNumbers(),
      centerWithinEditor,
      EditorView.lineWrapping,
      latexLanguage,
      liveMathPreview("latex"),
    ],
  });
  await frames(6);
  const jumps = [];
  for (const line of lines) {
    const position = view.state.doc.line(line).from;
    revealEditorRange(view, position);
    await frames(30);
    jumps.push({ line, offset: centerOffset(view, position), drift: gutterDrift(view) });
  }
  return { rowHeight: view.defaultLineHeight, jumps, warnings: [...warnings] };
}

Object.assign(window, { __editorJump: { jumpThrough } });
