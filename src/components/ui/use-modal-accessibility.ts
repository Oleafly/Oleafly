import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { modalCoordinator, visibleFocusable } from "@oleafly/templates/modal-coordinator";

export const appModalCoordinator = modalCoordinator;

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface DocumentScrollPosition {
  left: number;
  top: number;
}

function readDocumentScrollPosition(): DocumentScrollPosition {
  const scrollingElement = document.scrollingElement;
  return {
    left: scrollingElement?.scrollLeft ?? document.documentElement.scrollLeft ?? document.body.scrollLeft,
    top: scrollingElement?.scrollTop ?? document.documentElement.scrollTop ?? document.body.scrollTop,
  };
}

function restoreDocumentScrollPosition(position: DocumentScrollPosition): void {
  const scrollingElement = document.scrollingElement;
  const targets = new Set<Element>([
    ...(scrollingElement ? [scrollingElement] : []),
    document.documentElement,
    document.body,
  ]);
  for (const target of targets) {
    target.scrollLeft = position.left;
    target.scrollTop = position.top;
  }
}

export function useModalAccessibility<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): {
  dialogRef: RefObject<T | null>;
  onBackdropMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
} {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const modalIdRef = useRef<symbol | null>(null);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // A focused element inside a removed dialog can make WebKit scroll the
    // document while it resolves focus. The app shell is intentionally its own
    // scroll boundary, so preserve the document viewport across the complete
    // modal lifecycle instead of allowing focus restoration to move it.
    const documentScrollPosition = readDocumentScrollPosition();
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalId = modalCoordinator.add(previouslyFocused);
    modalIdRef.current = modalId;
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const initial = dialog.matches("[data-modal-initial-focus]")
        ? dialog
        : dialog.querySelector<HTMLElement>("[data-modal-initial-focus]")
          ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
      (initial ?? dialog).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!modalCoordinator.isTop(modalId)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = visibleFocusable([...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      const restore = modalCoordinator.remove(modalId);
      if (modalIdRef.current === modalId) modalIdRef.current = null;
      if (restore) restore.focus({ preventScroll: true });
      restoreDocumentScrollPosition(documentScrollPosition);
      requestAnimationFrame(() => {
        restoreDocumentScrollPosition(documentScrollPosition);
        requestAnimationFrame(() => restoreDocumentScrollPosition(documentScrollPosition));
      });
    };
  }, [open]);

  return {
    dialogRef,
    onBackdropMouseDown: (event) => {
      const id = modalIdRef.current;
      if (id !== null && modalCoordinator.isTop(id) && event.target === event.currentTarget) {
        closeRef.current();
      }
    },
  };
}
