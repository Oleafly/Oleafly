import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { PdfRotation } from "@/components/pdf/PdfViewer";
import { MAX_PREVIEW_SCALE, MIN_PREVIEW_SCALE } from "./preview-zoom";

export function zoomKeyAction(
  key: string,
  setScale: Dispatch<SetStateAction<number>>,
): (() => void) | null {
  if (key === "+" || key === "=") {
    return () => setScale((current) => Math.min(MAX_PREVIEW_SCALE, current + 0.2));
  }
  if (key === "-") {
    return () => setScale((current) => Math.max(MIN_PREVIEW_SCALE, current - 0.2));
  }
  if (key === "0") return () => setScale(1);
  return null;
}

export interface PdfKeyboardShortcutOptions {
  rootRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  searchOpen: boolean;
  outlineOpen: boolean;
  zoomShortcuts: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  setSearchOpen: (open: boolean) => void;
  setSearchInput: (value: string) => void;
  setOutlineOpen: (open: boolean) => void;
  setScale: Dispatch<SetStateAction<number>>;
  setRotation: Dispatch<SetStateAction<PdfRotation>>;
  userZoom: (mutate: () => void) => void;
}

export function usePdfKeyboardShortcuts({
  rootRef,
  enabled = true,
  searchOpen,
  outlineOpen,
  zoomShortcuts,
  searchInputRef,
  setSearchOpen,
  setSearchInput,
  setOutlineOpen,
  setScale,
  setRotation,
  userZoom,
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
      const zoom = zoomKeyAction(event.key, setScale);
      if (zoomShortcuts && modifier && zoom) {
        event.preventDefault();
        userZoom(zoom);
      } else if (
        modifier &&
        event.shiftKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        setRotation((current) => ((current + 90) % 360) as PdfRotation);
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    outlineOpen,
    rootRef,
    searchInputRef,
    searchOpen,
    setOutlineOpen,
    setRotation,
    setScale,
    setSearchInput,
    setSearchOpen,
    userZoom,
    zoomShortcuts,
  ]);
}
