import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { modalCoordinator, visibleFocusable } from "@openleaf/templates/modal-coordinator";

export const appModalCoordinator = modalCoordinator;

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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
      (initial ?? dialog).focus();
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
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      const restore = modalCoordinator.remove(modalId);
      if (modalIdRef.current === modalId) modalIdRef.current = null;
      if (restore) restore.focus();
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
