import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

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

export function windowViewport(): MenuSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function menuPlacement(editor: Editor, from: number, size: MenuSize): CSSProperties {
  let rect: AnchorRect;
  try {
    rect = editor.view.coordsAtPos(from);
  } catch {
    return { top: MARGIN, left: MARGIN };
  }
  return anchoredPlacement(rect, size, MENU_GAP, windowViewport());
}

export function sameSuggestion(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && sameSuggestion((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

export function useEditorSuggestion<T>(editor: Editor, read: (state: EditorState) => T | null): T | null {
  const [suggestion, setSuggestion] = useState<T | null>(() => read(editor.state));
  const shownRef = useRef(suggestion);
  const [focused, setFocused] = useState(true);
  const [, setMoved] = useState(0);

  useEffect(() => {
    const update = () => {
      const next = read(editor.state);
      if (sameSuggestion(shownRef.current, next)) return;
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
    const move = () => setMoved((count) => count + 1);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
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
    <div
      {...data}
      id={id}
      role="listbox"
      aria-label={label}
      style={menuPlacement(editor, from, size)}
      className={cn(
        "fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl",
        className,
      )}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

interface SuggestionOptionProps {
  id: string;
  selected: boolean;
  onHighlight: () => void;
  onChoose: () => void;
  children: ReactNode;
}

export function SuggestionOption({ id, selected, onHighlight, onChoose, children, ...data }: Readonly<SuggestionOptionProps>) {
  return (
    <button
      {...data}
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseEnter={() => {
        if (!selected) onHighlight();
      }}
      onClick={onChoose}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none",
        selected && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
