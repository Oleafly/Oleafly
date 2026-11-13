import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { useTranslation } from "react-i18next";
import { ListboxHeading, ListboxOption } from "@/components/ui/listbox";
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
import { type MenuSize, SuggestionListbox, useEditorSuggestion } from "./SuggestionListbox";

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
  if (!slash) return null;
  const items = visibleSlashItems(editor);
  const index = Math.min(slash.index, Math.max(0, items.length - 1));
  const menuId = slashMenuId(editor.state);
  const groupLabel = (group: SlashGroup) =>
    group === "basic" ? t(($) => $.notes.blocks.slash.basic) : t(($) => $.notes.blocks.insert[group]);
  return (
    <SuggestionListbox
      editor={editor}
      id={menuId}
      label={t(($) => $.notes.blocks.slash.menu)}
      data-note-slash
      from={slash.from}
      size={SLASH_MENU}
      activeId={items.length > 0 ? slashOptionId(menuId, index) : null}
      className="max-h-80 w-64"
    >
      {items.length === 0 && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t(($) => $.notes.blocks.slash.noMatches)}</p>
      )}
      {groupsOf(items).map(({ group, items: members }) => (
        <fieldset key={`${group}-${members[0].position}`} aria-label={groupLabel(group)} className="m-0 min-w-0 border-0 p-0">
          <ListboxHeading aria-hidden>{groupLabel(group)}</ListboxHeading>
          {members.map(({ item, position }) => (
            <ListboxOption
              key={item.id}
              id={slashOptionId(menuId, position)}
              selected={position === index}
              data-slash-item={item.id}
              onHighlight={() => moveSlash(editor.view, position)}
              onChoose={() => chooseSlash(editor, position)}
            >
              <item.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.label}</span>
            </ListboxOption>
          ))}
        </fieldset>
      ))}
    </SuggestionListbox>
  );
}
