import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { type MenuSize, menuPlacement, useEditorSuggestion } from "./NoteLinkMenu";
import {
  chooseSlash,
  moveSlash,
  type SlashGroup,
  type SlashItem,
  type SlashState,
  slashMenuId,
  slashOptionId,
  slashState,
  visibleSlashItems,
} from "./note-slash";

const SLASH_MENU: MenuSize = { width: 256, height: 320 };

function activeSlash(state: EditorState): SlashState | null {
  const slash = slashState(state);
  return slash.active ? slash : null;
}

function groupsOf(items: readonly SlashItem[]): { group: SlashGroup; items: { item: SlashItem; position: number }[] }[] {
  const groups: { group: SlashGroup; items: { item: SlashItem; position: number }[] }[] = [];
  items.forEach((item, position) => {
    const last = groups.at(-1);
    if (last?.group === item.group) last.items.push({ item, position });
    else groups.push({ group: item.group, items: [{ item, position }] });
  });
  return groups;
}

export function NoteSlashMenu({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const slash = useEditorSuggestion(editor, activeSlash);
  const items = slash ? visibleSlashItems(editor, slash) : [];
  const index = slash ? Math.min(slash.index, Math.max(0, items.length - 1)) : 0;
  const menuId = slashMenuId(editor.state);
  const activeId = items.length > 0 ? slashOptionId(menuId, index) : null;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  if (!slash) return null;
  const groupLabel = (group: SlashGroup) =>
    group === "basic" ? t(($) => $.notes.blocks.slash.basic) : t(($) => $.notes.blocks.insert[group]);
  return createPortal(
    <div
      id={menuId}
      role="listbox"
      aria-label={t(($) => $.notes.blocks.slash.menu)}
      data-note-slash
      style={menuPlacement(editor, slash.from, SLASH_MENU)}
      className="fixed z-50 max-h-80 w-64 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0 && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t(($) => $.notes.blocks.slash.noMatches)}</p>
      )}
      {groupsOf(items).map(({ group, items: members }) => (
        <fieldset key={`${group}-${members[0].position}`} aria-label={groupLabel(group)} className="m-0 min-w-0 border-0 p-0">
          <p aria-hidden className="px-2.5 pb-1 pt-1.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
            {groupLabel(group)}
          </p>
          {members.map(({ item, position }) => {
            const selected = position === index;
            return (
              <button
                key={item.id}
                id={slashOptionId(menuId, position)}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                data-slash-item={item.id}
                onMouseEnter={() => {
                  if (!selected) moveSlash(editor.view, position);
                }}
                onClick={() => chooseSlash(editor, position)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none",
                  selected && "bg-accent text-accent-foreground",
                )}
              >
                <item.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.label}</span>
              </button>
            );
          })}
        </fieldset>
      ))}
    </div>,
    document.body,
  );
}
