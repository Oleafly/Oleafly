import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Hash, SquareStack } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NoteChip } from "./note-icons";
import {
  canEmbed,
  chooseNoteLink,
  highlightNoteLink,
  noteLinkOptionId,
  noteLinkSuggestion,
  type LinkCandidate,
  type NoteLinkSuggestion,
} from "./note-links";
import { ProjectDot } from "./project-color";

const MENU_SIZE: MenuSize = { width: 288, height: 288 };
const GAP = 4;
const MARGIN = 8;

export interface MenuSize {
  width: number;
  height: number;
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

export function menuPlacement(editor: Editor, from: number, size: MenuSize = MENU_SIZE): CSSProperties {
  let rect: { left: number; top: number; bottom: number };
  try {
    rect = editor.view.coordsAtPos(from);
  } catch {
    return { top: MARGIN, left: MARGIN };
  }
  const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - size.width - MARGIN));
  const below = rect.bottom + GAP;
  if (below + size.height > window.innerHeight && rect.top - GAP - size.height >= 0) {
    return { left, bottom: window.innerHeight - rect.top + GAP };
  }
  return { left, top: below };
}

function Heading({ children }: Readonly<{ children: string }>) {
  return (
    <p className="px-2.5 pb-1 pt-1 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

function CandidateIcon({ candidate }: Readonly<{ candidate: LinkCandidate }>) {
  if (candidate.kind === "note") return <NoteChip icon={candidate.icon} color={candidate.color} className="size-5 rounded" />;
  if (candidate.kind === "heading") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        <Hash aria-hidden className="size-3.5" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <ProjectDot color={candidate.color} />
    </span>
  );
}

export function NoteLinkMenu({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const suggestion = useEditorSuggestion<NoteLinkSuggestion>(editor, noteLinkSuggestion);
  const activeId = suggestion && suggestion.items.length > 0 ? noteLinkOptionId(suggestion.menuId, suggestion.index) : null;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  if (!suggestion) return null;
  const firstProject = suggestion.items.findIndex((item) => item.kind === "project");
  const firstHeading = suggestion.items[0]?.kind === "heading" ? suggestion.items[0] : null;
  let empty = t(($) => $.notes.links.noMatches);
  if (suggestion.loading) empty = t(($) => $.notes.kb.links.loadingHeadings);
  else if (suggestion.headings) empty = t(($) => $.notes.kb.links.noHeadings);
  return createPortal(
    <div
      id={suggestion.menuId}
      role="listbox"
      aria-label={t(($) => $.notes.links.menu)}
      style={menuPlacement(editor, suggestion.from)}
      className="fixed z-50 max-h-72 w-72 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      {suggestion.embed && <Heading>{t(($) => $.notes.kb.links.embedHeading)}</Heading>}
      {suggestion.items.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{empty}</p>}
      {suggestion.items.map((item, index) => {
        const selected = index === suggestion.index;
        const embeddable = !suggestion.embed && canEmbed(item);
        return (
          <div key={item.kind === "heading" ? `heading:${item.id}:${item.heading.slug}` : `${item.kind}:${item.id}`} className="group/option relative">
            {index === 0 && item.kind === "note" && !suggestion.embed && <Heading>{t(($) => $.notes.links.notes)}</Heading>}
            {index === firstProject && <Heading>{t(($) => $.notes.links.projects)}</Heading>}
            {firstHeading && index === 0 && <Heading>{firstHeading.self ? t(($) => $.notes.kb.links.thisNote) : firstHeading.title}</Heading>}
            <button
              id={noteLinkOptionId(suggestion.menuId, index)}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              data-link-kind={item.kind}
              onMouseEnter={() => {
                if (!selected) highlightNoteLink(editor.view, index);
              }}
              onClick={() => chooseNoteLink(editor.view, index)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none",
                selected && "bg-accent text-accent-foreground",
              )}
            >
              <CandidateIcon candidate={item} />
              <span
                className="min-w-0 flex-1 truncate text-xs font-medium"
                style={item.kind === "heading" ? { paddingLeft: `${(item.heading.level - 1) * 0.5}rem` } : undefined}
              >
                {item.kind === "heading" ? item.heading.text : item.title || item.id}
              </span>
              {item.kind === "note" && item.alias && (
                <span className="max-w-[40%] shrink-0 truncate text-[0.6875rem] text-muted-foreground">{item.alias}</span>
              )}
            </button>
            {embeddable && (
              <Tooltip label={t(($) => $.notes.kb.links.embed)} side="right" relative={false}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-embed-option
                  aria-label={t(($) => $.notes.kb.links.embedNamed, { title: item.kind === "heading" ? item.heading.text : item.title })}
                  onClick={() => chooseNoteLink(editor.view, index, true)}
                  className={cn(
                    "absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/option:opacity-100 motion-reduce:transition-none",
                    selected && "opacity-100",
                  )}
                >
                  <SquareStack aria-hidden className="size-3.5" />
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
