import type { Editor } from "@tiptap/core";
import { Hash } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { type MenuSize, menuPlacement, useEditorSuggestion } from "./NoteLinkMenu";
import { highlightTag, insertTag, tagOptionId, tagSuggestion, type TagSuggestion } from "./note-tag-chips";

const TAG_MENU: MenuSize = { width: 240, height: 288 };

export function NoteTagMenu({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const suggestion = useEditorSuggestion<TagSuggestion>(editor, tagSuggestion);
  const activeId = suggestion ? tagOptionId(suggestion.menuId, suggestion.index) : null;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  if (!suggestion) return null;
  return createPortal(
    <div
      id={suggestion.menuId}
      role="listbox"
      aria-label={t(($) => $.notes.kb.tags.menu)}
      style={menuPlacement(editor, suggestion.from, TAG_MENU)}
      className="fixed z-50 max-h-72 w-60 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      {suggestion.items.map((tag, index) => {
        const selected = index === suggestion.index;
        return (
          <button
            key={tag}
            id={tagOptionId(suggestion.menuId, index)}
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={-1}
            onMouseEnter={() => {
              if (!selected) highlightTag(editor.view, index);
            }}
            onClick={() => insertTag(editor.view, index)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none",
              selected && "bg-accent text-accent-foreground",
            )}
          >
            <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{tag}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
