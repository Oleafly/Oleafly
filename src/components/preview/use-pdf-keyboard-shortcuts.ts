import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { PdfRotation } from "@/components/pdf/PdfViewer";

export interface PdfKeyboardShortcutOptions {
  rootRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  searchOpen: boolean;
  outlineOpen: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  setSearchOpen: (open: boolean) => void;
  setSearchInput: (value: string) => void;
  setOutlineOpen: (open: boolean) => void;
  setRotation: Dispatch<SetStateAction<PdfRotation>>;
}

export function usePdfKeyboardShortcuts({
  rootRef,
  enabled = true,
  searchOpen,
  outlineOpen,
  searchInputRef,
  setSearchOpen,
  setSearchInput,
  setOutlineOpen,
  setRotation,
}: PdfKeyboardShortcutOptions): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() =>
          searchInputRef.current?.focus({ preventScroll: true }),
        );
        return;
      }
      if (event.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchInput("");
        } else if (outlineOpen) {
          setOutlineOpen(false);
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      ) {
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        setRotation((current) => ((current + 90) % 360) as PdfRotation);
      }
    };
    let focusedInside = root.contains(document.activeElement);
    const onFocusIn = () => {
      focusedInside = true;
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) focusedInside = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.contains(event.target)) focusedInside = false;
    };
    const restoreFocus = new MutationObserver(() => {
      if (focusedInside && document.activeElement === document.body) root.focus({ preventScroll: true });
    });
    restoreFocus.observe(root, { childList: true, subtree: true });
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      restoreFocus.disconnect();
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [
    enabled,
    outlineOpen,
    rootRef,
    searchInputRef,
    searchOpen,
    setOutlineOpen,
    setRotation,
    setSearchInput,
    setSearchOpen,
  ]);
}
