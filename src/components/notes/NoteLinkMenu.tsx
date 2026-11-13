import type { Editor } from "@tiptap/core";
import { FilePlus2, Hash, Pilcrow, SquareStack } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ColorDot } from "@/components/ui/color-swatch";
import { ListboxHeading, ListboxOption } from "@/components/ui/listbox";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { blockFragment, shortText } from "./note-block-ids";
import { NoteChip } from "./note-icons";
import {
  canEmbed,
  chooseNoteLink,
  highlightNoteLink,
  noteLinkSuggestion,
  type LinkCandidate,
  type NoteLinkSuggestion,
} from "./note-links";
import { type MenuSize, SuggestionListbox, useEditorSuggestion } from "./SuggestionListbox";
import { suggestOptionId } from "./note-suggest-plugin";

const MENU_SIZE: MenuSize = { width: 288, height: 288 };

function CandidateIcon({ candidate }: Readonly<{ candidate: LinkCandidate }>) {
  if (candidate.kind === "note") return <NoteChip icon={candidate.icon} color={candidate.color} className="size-5 rounded" />;
  if (candidate.kind === "heading" || candidate.kind === "create" || candidate.kind === "block") {
    const Icon = { heading: Hash, create: FilePlus2, block: Pilcrow }[candidate.kind];
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <ColorDot color={candidate.color ?? "transparent"} size="xs" />
    </span>
  );
}

function optionKey(item: LinkCandidate): string {
  if (item.kind === "heading") return `heading:${item.id}:${item.heading.slug}`;
  if (item.kind === "block") return `block:${item.id}:${item.block.id ?? item.block.at}`;
  return `${item.kind}:${item.id}`;
}

export function NoteLinkMenu({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const suggestion = useEditorSuggestion<NoteLinkSuggestion>(editor, noteLinkSuggestion);
  if (!suggestion) return null;
  const activeId = suggestion.items.length > 0 ? suggestOptionId(suggestion.menuId, suggestion.index) : null;
  const optionText = (item: LinkCandidate) => {
    if (item.kind === "heading") return item.heading.text;
    if (item.kind === "block") return shortText(item.block.text, 80) || `^${item.block.id ?? ""}`;
    if (item.kind === "create") return t(($) => $.notes.vault.switcher.create, { title: item.title });
    return item.title || item.id;
  };
  const firstProject = suggestion.items.findIndex((item) => item.kind === "project");
  const first = suggestion.items[0];
  const firstHeading = first?.kind === "heading" || first?.kind === "block" ? first : null;
  let empty = t(($) => $.notes.links.noMatches);
  if (suggestion.loading) empty = suggestion.blocks ? t(($) => $.notes.linksSearch.blocks.loading) : t(($) => $.notes.kb.links.loadingHeadings);
  else if (suggestion.blocks) empty = t(($) => $.notes.linksSearch.blocks.none);
  else if (suggestion.headings) empty = t(($) => $.notes.kb.links.noHeadings);
  return (
    <SuggestionListbox
      editor={editor}
      id={suggestion.menuId}
      label={t(($) => $.notes.links.menu)}
      from={suggestion.from}
      size={MENU_SIZE}
      activeId={activeId}
      className="max-h-72 w-72"
    >
      {suggestion.embed && <ListboxHeading>{t(($) => $.notes.kb.links.embedHeading)}</ListboxHeading>}
      {suggestion.items.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{empty}</p>}
      {suggestion.items.map((item, index) => {
        const selected = index === suggestion.index;
        const embeddable = !suggestion.embed && canEmbed(item);
        return (
          <div key={optionKey(item)} className="group/option relative">
            {index === 0 && item.kind === "note" && !suggestion.embed && <ListboxHeading>{t(($) => $.notes.links.notes)}</ListboxHeading>}
            {index === firstProject && <ListboxHeading>{t(($) => $.notes.links.projects)}</ListboxHeading>}
            {firstHeading && index === 0 && <ListboxHeading>{firstHeading.self ? t(($) => $.notes.kb.links.thisNote) : firstHeading.title}</ListboxHeading>}
            <ListboxOption
              id={suggestOptionId(suggestion.menuId, index)}
              selected={selected}
              data-link-kind={item.kind}
              onHighlight={() => highlightNoteLink(editor.view, index)}
              onChoose={() => chooseNoteLink(editor.view, index)}
            >
              <CandidateIcon candidate={item} />
              <span
                className="min-w-0 flex-1 truncate text-xs font-medium"
                style={item.kind === "heading" ? { paddingLeft: `${(item.heading.level - 1) * 0.5}rem` } : undefined}
              >
                {optionText(item)}
              </span>
              {item.kind === "note" && item.alias && (
                <span className="max-w-[40%] shrink-0 truncate text-[0.6875rem] text-muted-foreground">{item.alias}</span>
              )}
              {item.kind === "block" && item.block.id && (
                <span className={cn("shrink-0 font-mono text-[0.6875rem] text-muted-foreground", embeddable && "mr-6")}>{blockFragment(item.block.id)}</span>
              )}
            </ListboxOption>
            {embeddable && (
              <Tooltip label={t(($) => $.notes.kb.links.embed)} side="right" relative={false}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-embed-option
                  aria-label={t(($) => $.notes.kb.links.embedNamed, { title: optionText(item) })}
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
    </SuggestionListbox>
  );
}
