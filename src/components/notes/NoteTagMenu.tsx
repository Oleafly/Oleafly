import type { Editor } from "@tiptap/core";
import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { highlightTag, insertTag, tagOptionId, tagSuggestion, type TagSuggestion } from "./note-tag-chips";
import { type MenuSize, SuggestionListbox, SuggestionOption, useEditorSuggestion } from "./SuggestionListbox";

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
      activeId={tagOptionId(suggestion.menuId, suggestion.index)}
      className="max-h-72 w-60"
    >
      {suggestion.items.map((tag, index) => (
        <SuggestionOption
          key={tag}
          id={tagOptionId(suggestion.menuId, index)}
          selected={index === suggestion.index}
          onHighlight={() => highlightTag(editor.view, index)}
          onChoose={() => insertTag(editor.view, index)}
        >
          <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{tag}</span>
        </SuggestionOption>
      ))}
    </SuggestionListbox>
  );
}
