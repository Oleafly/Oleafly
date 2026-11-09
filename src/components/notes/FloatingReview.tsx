import type { Editor } from "@tiptap/core";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  acceptActive,
  acceptAll,
  moveReview,
  rejectActive,
  rejectAll,
  type ReviewSummary,
} from "./note-suggestions";
import { ReviewBar } from "./ReviewBar";

export const REVIEW_GAP_PX = 8;

export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface ReviewPlacement {
  readonly top: number;
  readonly left: number;
}

const CHANGE_BLOCK = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th, figure, .note-diff-block, .note-diff-delete-block";

function blockOf(part: HTMLElement, root: Element): HTMLElement {
  const block = part.closest<HTMLElement>(CHANGE_BLOCK);
  return block && root.contains(block) ? block : part;
}

export function activeChangeBox(root: Element): Box | null {
  let box: Box | null = null;
  const blocks = new Set([...root.querySelectorAll<HTMLElement>(".note-diff-active")].map((part) => blockOf(part, root)));
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    box = box
      ? {
          top: Math.min(box.top, rect.top),
          bottom: Math.max(box.bottom, rect.bottom),
          left: Math.min(box.left, rect.left),
          right: Math.max(box.right, rect.right),
        }
      : { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  }
  return box;
}

export function reviewPlacement(
  change: Box | null,
  area: Box,
  bar: { readonly width: number; readonly height: number },
): ReviewPlacement {
  const highest = area.top + REVIEW_GAP_PX;
  const lowest = Math.max(highest, area.bottom - bar.height - REVIEW_GAP_PX);
  const leftmost = area.left + REVIEW_GAP_PX;
  const rightmost = Math.max(leftmost, area.right - bar.width - REVIEW_GAP_PX);
  if (!change) return { top: lowest, left: Math.max(leftmost, (area.left + area.right - bar.width) / 2) };
  return {
    top: Math.min(lowest, Math.max(highest, change.bottom + REVIEW_GAP_PX)),
    left: Math.min(rightmost, Math.max(leftmost, change.right - bar.width)),
  };
}

function visibleArea(scroller: HTMLElement, top: HTMLElement | null, bottom: HTMLElement | null): Box {
  const view = scroller.getBoundingClientRect();
  return {
    top: Math.max(view.top, top?.getBoundingClientRect().bottom ?? view.top),
    bottom: Math.min(view.bottom, bottom?.getBoundingClientRect().top ?? view.bottom),
    left: view.left,
    right: view.right,
  };
}

export function FloatingReview({
  editor,
  review,
  scrollRef,
  bottomRef,
}: Readonly<{
  editor: Editor;
  review: ReviewSummary;
  scrollRef: RefObject<HTMLElement | null>;
  bottomRef: RefObject<HTMLElement | null>;
}>) {
  const barRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ReviewPlacement | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bar = barRef.current;
      if (!bar) return;
      const toolbar = scroller.querySelector<HTMLElement>(":scope > [role=toolbar]");
      const next = reviewPlacement(activeChangeBox(editor.view.dom), visibleArea(scroller, toolbar, bottomRef.current), {
        width: bar.offsetWidth,
        height: bar.offsetHeight,
      });
      setPlacement((current) =>
        current?.top === next.top && current?.left === next.left ? current : next,
      );
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    for (const element of [editor.view.dom, scroller, bottomRef.current, barRef.current]) {
      if (element) observer?.observe(element);
    }
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    editor.on("transaction", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editor.off("transaction", schedule);
    };
  }, [bottomRef, editor, scrollRef]);

  return (
    <div
      ref={barRef}
      data-note-review
      style={{ top: placement?.top ?? 0, left: placement?.left ?? 0, visibility: placement ? "visible" : "hidden" }}
      className="fixed z-20"
    >
      <ReviewBar
        count={review.count}
        index={review.index}
        onPrevious={() => moveReview(editor, -1)}
        onNext={() => moveReview(editor, 1)}
        onAccept={() => acceptActive(editor)}
        onReject={() => rejectActive(editor)}
        onAcceptAll={() => acceptAll(editor)}
        onRejectAll={() => rejectAll(editor)}
      />
    </div>
  );
}
