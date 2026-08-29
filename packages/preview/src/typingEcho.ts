export { snapAfterWord } from "./textHit";

export interface PreviewTextTarget {
  span: HTMLElement;
  offset: number;
}

export interface PreviewTypingEcho {
  insert(text: string): void;
  backspace(): boolean;
  isConnected(): boolean;
  dispose(): void;
}

export interface PreviewTypingEchoColors {
  ink: string;
  paper: string;
}

function firstTextNode(span: HTMLElement): Text | null {
  for (const child of Array.from(span.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) return child as Text;
  }
  return null;
}

export function createPreviewTypingEcho(
  target: PreviewTextTarget,
  colors: PreviewTypingEchoColors,
): PreviewTypingEcho | null {
  const { span } = target;
  const textNode = firstTextNode(span);
  if (!textNode) return null;
  const text = textNode.data;
  const offset = Math.min(Math.max(0, target.offset), text.length);

  const before = textNode;
  const after = before.splitText(offset);
  const caret = span.ownerDocument.createElement("span");
  caret.dataset.pdfTypingCaret = "true";
  caret.style.display = "inline-block";
  caret.style.width = "0";
  caret.style.borderLeft = `1.5px solid ${colors.ink}`;
  caret.style.height = "1em";
  caret.style.verticalAlign = "baseline";
  span.insertBefore(caret, after);
  caret.animate?.(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 1000, iterations: Number.POSITIVE_INFINITY, easing: "steps(2, start)" },
  );

  let materialized = false;
  const materialize = () => {
    if (materialized) return;
    materialized = true;
    span.style.color = colors.ink;
    span.style.backgroundColor = colors.paper;
  };

  return {
    insert(insertion: string) {
      if (!caret.isConnected) return;
      materialize();
      before.appendData(insertion);
    },
    backspace() {
      if (!caret.isConnected || before.data.length === 0) return false;
      materialize();
      before.deleteData(before.data.length - 1, 1);
      return true;
    },
    isConnected() {
      return caret.isConnected;
    },
    dispose() {
      caret.remove();
      span.normalize();
    },
  };
}
