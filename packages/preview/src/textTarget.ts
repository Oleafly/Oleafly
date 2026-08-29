import {
  charOffsetAtHorizontalPosition,
  closestMatchingElement,
  wordAtHorizontalPosition,
  wordInText,
} from "./textHit";
import type { PreviewTextTarget } from "./typingEcho";

type CaretPointDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

export function findTextLayerSpanAt(
  clientX: number,
  clientY: number,
  eventTarget?: EventTarget | null,
  root: ParentNode = document,
): HTMLElement | null {
  const clickedSpan = closestMatchingElement<HTMLElement>(eventTarget, ".textLayer span");
  return (
    clickedSpan ??
    Array.from(root.querySelectorAll<HTMLElement>(".textLayer span")).find((span) => {
      const rect = span.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }) ??
    null
  );
}

export function caretTextOffsetAt(
  clientX: number,
  clientY: number,
  span: HTMLElement,
): number | null {
  const d = document as CaretPointDocument;
  const range = d.caretRangeFromPoint?.(clientX, clientY);
  if (
    range &&
    range.startContainer.nodeType === Node.TEXT_NODE &&
    span.contains(range.startContainer)
  ) {
    return range.startOffset;
  }
  const pos = d.caretPositionFromPoint?.(clientX, clientY);
  if (
    pos &&
    pos.offsetNode.nodeType === Node.TEXT_NODE &&
    span.contains(pos.offsetNode)
  ) {
    return pos.offset;
  }
  return null;
}

export function textTargetAtPoint(
  clientX: number,
  clientY: number,
  eventTarget?: EventTarget | null,
  root: ParentNode = document,
): PreviewTextTarget | null {
  const span = findTextLayerSpanAt(clientX, clientY, eventTarget, root);
  if (!span) return null;
  const offset = caretTextOffsetAt(clientX, clientY, span);
  if (offset !== null) return { span, offset };
  const rect = span.getBoundingClientRect();
  return {
    span,
    offset: charOffsetAtHorizontalPosition(
      span.textContent ?? "",
      rect.left,
      rect.width,
      clientX,
    ),
  };
}

export function wordAtPoint(
  clientX: number,
  clientY: number,
  eventTarget?: EventTarget | null,
  root: ParentNode = document,
): string | null {
  const d = document as CaretPointDocument;
  const containingSpan = findTextLayerSpanAt(clientX, clientY, eventTarget, root) ?? undefined;
  if (containingSpan) {
    const text = containingSpan.textContent ?? "";
    const rect = containingSpan.getBoundingClientRect();
    const word = wordAtHorizontalPosition(text, rect.left, rect.width, clientX);
    if (word) return word;
  }
  let node: Node | null = null;
  let offset = 0;
  const range = d.caretRangeFromPoint?.(clientX, clientY); // WebKit + Chromium
  if (range) {
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    const pos = d.caretPositionFromPoint?.(clientX, clientY); // Firefox / standard
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || (containingSpan && !containingSpan.contains(node))) {
    const fallbackText =
      containingSpan?.textContent?.trim() ??
      document.elementFromPoint(clientX, clientY)?.closest(".textLayer span")?.textContent?.trim() ??
      "";
    return fallbackText || null;
  }
  const text = node.textContent ?? "";
  return wordInText(text, offset);
}
