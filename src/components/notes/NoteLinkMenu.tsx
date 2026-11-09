import type { Editor } from "@tiptap/core";
import { FilePlus2, Hash, SquareStack } from "lucide-react";
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
import { type MenuSize, SuggestionListbox, SuggestionOption, useEditorSuggestion } from "./SuggestionListbox";

const MENU_SIZE: MenuSize = { width: 288, height: 288 };

function Heading({ children }: Readonly<{ children: string }>) {
  return (
    <p className="px-2.5 pb-1 pt-1 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

function CandidateIcon({ candidate }: Readonly<{ candidate: LinkCandidate }>) {
  if (candidate.kind === "note") return <NoteChip icon={candidate.icon} color={candidate.color} className="size-5 rounded" />;
  if (candidate.kind === "heading" || candidate.kind === "create") {
    const Icon = candidate.kind === "heading" ? Hash : FilePlus2;
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
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
  if (!suggestion) return null;
  const activeId = suggestion.items.length > 0 ? noteLinkOptionId(suggestion.menuId, suggestion.index) : null;
  const optionText = (item: LinkCandidate) => {
    if (item.kind === "heading") return item.heading.text;
    if (item.kind === "create") return t(($) => $.notes.vault.switcher.create, { title: item.title });
    return item.title || item.id;
  };
  const firstProject = suggestion.items.findIndex((item) => item.kind === "project");
  const firstHeading = suggestion.items[0]?.kind === "heading" ? suggestion.items[0] : null;
  let empty = t(($) => $.notes.links.noMatches);
  if (suggestion.loading) empty = t(($) => $.notes.kb.links.loadingHeadings);
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
            <SuggestionOption
              id={noteLinkOptionId(suggestion.menuId, index)}
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
            </SuggestionOption>
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
