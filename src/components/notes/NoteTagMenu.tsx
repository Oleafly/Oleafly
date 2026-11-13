import type { Editor } from "@tiptap/core";
import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ListboxOption } from "@/components/ui/listbox";
import { cn } from "@/lib/utils";
import { highlightTag, insertTag, tagSuggestion, type TagSuggestion } from "./note-tag-chips";
import { tagTone } from "./note-tags";
import { type MenuSize, SuggestionListbox, useEditorSuggestion } from "./SuggestionListbox";
import { suggestOptionId } from "./note-suggest-plugin";

const TAG_MENU: MenuSize = { width: 240, height: 288 };

export function NoteTagMenu({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const suggestion = useEditorSuggestion<TagSuggestion>(editor, tagSuggestion);
  if (!suggestion) return null;
  return (
    <SuggestionListbox
      editor={editor}
      id={suggestion.menuId}
      label={t(($) => $.notes.kb.tags.menu)}
      from={suggestion.from}
      size={TAG_MENU}
      activeId={suggestOptionId(suggestion.menuId, suggestion.index)}
      className="max-h-72 w-60"
    >
      {suggestion.items.map((tag, index) => (
        <ListboxOption
          key={tag}
          id={suggestOptionId(suggestion.menuId, index)}
          selected={index === suggestion.index}
          onHighlight={() => highlightTag(editor.view, index)}
          onChoose={() => insertTag(editor.view, index)}
        >
          <Hash aria-hidden className={cn("size-3.5 shrink-0", tagTone(tag).icon)} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{tag}</span>
        </ListboxOption>
      ))}
    </SuggestionListbox>
  );
}
