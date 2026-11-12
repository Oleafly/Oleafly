import type { Editor } from "@tiptap/core";
import { CalendarClock, CalendarDays, CalendarRange, CalendarSearch, Flag, Hash, type LucideIcon, SlidersHorizontal } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "@/components/ui/calendar";
import { ListboxHeading, ListboxOption } from "@/components/ui/listbox";
import { cn } from "@/lib/utils";
import { EditorPopover } from "./EditorPopover";
import { NoteChip } from "./note-icons";
import { tagTone } from "./note-tags";
import { atSuggestion, chooseAt, highlightAt, insertAtField, setAtPicker, type AtGroup, type AtIcon, type AtItem, type AtPickRequest, type AtSuggestion } from "./note-at";
import { useNotesWeekStart } from "./daily-note";
import { fieldKeyLabel } from "./note-field-values";
import { localDate } from "./note-templates";
import { suggestOptionId } from "./note-suggest-plugin";
import { menuPlacement, type MenuSize, SuggestionListbox, useEditorSuggestion } from "./SuggestionListbox";

const AT_MENU: MenuSize = { width: 288, height: 336 };
const PICKER: MenuSize = { width: 264, height: 340 };

const ICONS: Record<Exclude<AtIcon, "note">, LucideIcon> = {
  calendar: CalendarDays,
  calendarPick: CalendarSearch,
  due: CalendarClock,
  scheduled: CalendarRange,
  priority: Flag,
  field: SlidersHorizontal,
  tag: Hash,
};

function groupsOf(items: readonly AtItem[]): { group: AtGroup; members: { item: AtItem; position: number }[] }[] {
  const groups: { group: AtGroup; members: { item: AtItem; position: number }[] }[] = [];
  items.forEach((item, position) => {
    const last = groups.at(-1);
    if (last?.group === item.group) last.members.push({ item, position });
    else groups.push({ group: item.group, members: [{ item, position }] });
  });
  return groups;
}

function ItemIcon({ item }: Readonly<{ item: AtItem }>) {
  if (item.action.type === "note") {
    const { candidate } = item.action;
    return <NoteChip icon={candidate.kind === "project" ? undefined : candidate.icon} color={candidate.kind === "project" ? undefined : candidate.color} className="size-5 rounded" />;
  }
  const Icon = ICONS[item.icon as Exclude<AtIcon, "note">];
  return (
    <span
      className={cn("flex size-5 shrink-0 items-center justify-center text-muted-foreground", item.action.type === "tag" && tagTone(item.action.tag).icon)}
      data-priority={item.priority}
    >
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

function DatePickerPopover({ editor, request, onClose }: Readonly<{ editor: Editor; request: AtPickRequest; onClose: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const [style] = useState<CSSProperties>(() => menuPlacement(editor, request.from, PICKER));
  const weekStartsOn = useNotesWeekStart();
  const close = useCallback(() => {
    onClose();
    editor.view.focus();
  }, [editor, onClose]);
  const choose = (date: Date | undefined) => {
    if (!date) return;
    onClose();
    const text = editor.state.doc.textBetween(request.from, Math.min(request.to, editor.state.doc.content.size), undefined, "￼");
    if (text.startsWith("@")) insertAtField(editor.view, request, request.key, localDate(date));
    else editor.view.focus();
  };
  return (
    <EditorPopover label={t(($) => $.notes.at.pickerLabel)} data-note-at-picker style={style} onClose={close}>
      <Calendar mode="single" weekStartsOn={weekStartsOn} onSelect={choose} autoFocus />
    </EditorPopover>
  );
}

export function NoteAtMenu({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const suggestion = useEditorSuggestion<AtSuggestion>(editor, atSuggestion);
  const [picking, setPicking] = useState<AtPickRequest | null>(null);
  useEffect(() => {
    if (editor.isDestroyed) return;
    const view = editor.view;
    setAtPicker(view, setPicking);
    return () => setAtPicker(view, null);
  }, [editor]);
  const closePicker = useCallback(() => setPicking(null), []);
  if (picking) return <DatePickerPopover editor={editor} request={picking} onClose={closePicker} />;
  if (!suggestion) return null;
  const groupLabel = (group: AtGroup) => {
    if (group === "values") return fieldKeyLabel(suggestion.key);
    if (group === "dates" && suggestion.key === "due") return t(($) => $.notes.at.groups.due);
    return t(($) => $.notes.at.groups[group]);
  };
  return (
    <SuggestionListbox
      editor={editor}
      id={suggestion.menuId}
      label={t(($) => $.notes.at.menu)}
      data-note-at
      from={suggestion.from}
      size={AT_MENU}
      activeId={suggestion.items.length > 0 ? suggestOptionId(suggestion.menuId, suggestion.index) : null}
      className="max-h-84 w-72"
    >
      {suggestion.hint && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{suggestion.hint}</p>}
      {groupsOf(suggestion.items).map(({ group, members }) => (
        <fieldset key={`${group}-${members[0].position}`} aria-label={groupLabel(group)} className="m-0 min-w-0 border-0 p-0">
          <ListboxHeading aria-hidden>{groupLabel(group)}</ListboxHeading>
          {members.map(({ item, position }) => (
            <ListboxOption
              key={item.id}
              id={suggestOptionId(suggestion.menuId, position)}
              selected={position === suggestion.index}
              data-at-item={item.id}
              onHighlight={() => highlightAt(editor.view, position)}
              onChoose={() => chooseAt(editor.view, position)}
            >
              <ItemIcon item={item} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.label}</span>
              {item.detail && <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{item.detail}</span>}
            </ListboxOption>
          ))}
        </fieldset>
      ))}
    </SuggestionListbox>
  );
}
