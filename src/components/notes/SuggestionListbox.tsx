import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { type CSSProperties, type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Listbox } from "@/components/ui/listbox";
import { cn } from "@/lib/utils";
import { sameValue } from "@/lib/same-value";

export interface MenuSize {
  width: number;
  height: number;
}

export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export type AnchoredPlacement = { left: number; top: number } | { left: number; bottom: number };

const MENU_GAP = 4;
const MARGIN = 8;

export function anchoredPlacement(rect: AnchorRect, size: MenuSize, gap: number, viewport: MenuSize): AnchoredPlacement {
  const left = Math.max(MARGIN, Math.min(rect.left, viewport.width - size.width - MARGIN));
  const below = rect.bottom + gap;
  if (below + size.height > viewport.height && rect.top - gap - size.height >= 0) {
    return { left, bottom: viewport.height - rect.top + gap };
  }
  return { left, top: below };
}

export function fittedPlacement(rect: AnchorRect, size: MenuSize, gap: number, viewport: MenuSize): CSSProperties {
  const below = viewport.height - rect.bottom - gap;
  const above = rect.top - gap;
  const placement = anchoredPlacement(rect, size, gap, viewport);
  if (below >= size.height || above >= size.height) return placement;
  if (above > below) return { left: placement.left, bottom: viewport.height - rect.top + gap, maxHeight: Math.max(0, above - MARGIN) };
  return { left: placement.left, top: rect.bottom + gap, maxHeight: Math.max(0, below - MARGIN) };
}

export function windowViewport(): MenuSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

function anchorOf(editor: Editor, from: number): AnchorRect | null {
  try {
    return editor.view.coordsAtPos(from);
  } catch {
    return null;
  }
}

const CORNER = { top: MARGIN, left: MARGIN };

export function menuPlacement(editor: Editor, from: number, size: MenuSize): CSSProperties {
  const rect = anchorOf(editor, from);
  return rect ? anchoredPlacement(rect, size, MENU_GAP, windowViewport()) : CORNER;
}

function listPlacement(editor: Editor, from: number, size: MenuSize): CSSProperties {
  const rect = anchorOf(editor, from);
  return rect ? fittedPlacement(rect, size, MENU_GAP, windowViewport()) : CORNER;
}

export function useEditorSuggestion<T>(editor: Editor, read: (state: EditorState) => T | null): T | null {
  const [suggestion, setSuggestion] = useState<T | null>(() => read(editor.state));
  const shownRef = useRef(suggestion);
  const [focused, setFocused] = useState(true);
  const [, follow] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => {
    const update = () => {
      const next = read(editor.state);
      if (sameValue(shownRef.current, next)) return;
      shownRef.current = next;
      setSuggestion(next);
    };
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    update();
    editor.on("transaction", update);
    editor.on("focus", focus);
    editor.on("blur", blur);
    return () => {
      editor.off("transaction", update);
      editor.off("focus", focus);
      editor.off("blur", blur);
    };
  }, [editor, read]);

  const open = focused && suggestion !== null;
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  return open ? suggestion : null;
}

interface SuggestionListboxProps {
  editor: Editor;
  id: string;
  label: string;
  from: number;
  size: MenuSize;
  activeId: string | null;
  className: string;
  children: ReactNode;
}

export function SuggestionListbox({ editor, id, label, from, size, activeId, className, children, ...data }: Readonly<SuggestionListboxProps>) {
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  return createPortal(
    <Listbox
      {...data}
      id={id}
      aria-label={label}
      style={listPlacement(editor, from, size)}
      className={cn("fixed z-50", className)}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </Listbox>,
    document.body,
  );
}
