import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useNearViewport } from "@/hooks/use-near-viewport";
import { appQueryClient } from "@/lib/query";
import type { NoteSearchHit } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { NoteChip } from "./note-icons";
import { isLinkableId, noteLinkHref } from "./note-link-format";
import type { OpenNoteHandler } from "./note-links";
import { linkFirstMention, phraseQuery } from "./note-search";
import { NoteLinkSection, NoteListItem, useNotePanelSections } from "./NoteListItem";
import { useNotesData, VAULT_QUERY, vaultOwner } from "./notes-data";
import { isSelectionModifier } from "@/store/library-selection";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { backlinksOf, useNoteLinkIndex } from "./use-note-links";
import { NoteSnippet } from "./NoteSnippet";

export const MENTION_LIMIT = 20;
export const MENTION_NAMES = 6;

function mentionedInBody(hit: NoteSearchHit): boolean {
  return hit.snippets.some((snippet) => snippet.ranges.length > 0);
}

export function NoteMentions({
  noteId,
  onOpenNote,
  className,
}: Readonly<{ noteId: string | null | undefined; onOpenNote: OpenNoteHandler; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const { notes, searchNotes, loadNote, saveNote } = data;
  const index = useNoteLinkIndex();
  const backlinks = backlinksOf(index, noteId);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [linking, setLinking] = useState<string | null>(null);
  const open = useNotesPrefsStore((state) => state.mentionsOpen);
  const panel = useNotePanelSections();
  const [toggledFor, setToggledFor] = useState<string | null>(null);
  const toggled = toggledFor !== null && toggledFor === noteId;

  const target = isLinkableId(noteId) ? index.notes?.find((note) => note.noteId === noteId) : undefined;
  const self = target ? notes.find((note) => note.id === target.projectId) : undefined;
  const names = useMemo(() => {
    if (!self) return [];
    const unique = new Map<string, string>();
    for (const name of [self.title, ...(self.aliases ?? [])]) {
      const trimmed = name.trim();
      if (trimmed.length >= 2 && !unique.has(trimmed.toLowerCase())) unique.set(trimmed.toLowerCase(), trimmed);
    }
    return [...unique.values()].slice(0, MENTION_NAMES);
  }, [self]);
  const selfId = self?.id;

  const [nearRef, near] = useNearViewport<HTMLElement>();
  const searchable = searchNotes !== undefined && names.length > 0;
  const query = useQuery(
    {
      queryKey: ["notes", "mentions", vaultOwner(searchNotes), ...names],
      queryFn: () => Promise.all(names.map((name) => (searchNotes ? searchNotes(phraseQuery(name), MENTION_LIMIT) : Promise.resolve([])))),
      enabled: open && (near || toggled) && searchable,
      ...VAULT_QUERY,
    },
    appQueryClient(),
  );
  const found = open || !query.isPlaceholderData ? query.data : undefined;
  const hits = useMemo(() => {
    const seen = new Set<string>();
    const known = new Set(notes.map((note) => note.id));
    return (found ?? [])
      .flat()
      .filter((hit) => {
        if (hit.id === selfId || seen.has(hit.id) || !known.has(hit.id) || removed.has(hit.id) || !mentionedInBody(hit)) return false;
        seen.add(hit.id);
        return true;
      })
      .slice(0, MENTION_LIMIT);
  }, [found, notes, removed, selfId]);

  const linked = new Set(backlinks.map((backlink) => backlink.projectId));
  const shown = hits.filter((hit) => !linked.has(hit.id));
  if (!target || !searchable) return null;
  const unknown = found === undefined;
  if (!panel && !toggled && (unknown ? open : shown.length === 0)) return near ? null : <div ref={nearRef} aria-hidden />;

  const link = async (hit: NoteSearchHit) => {
    setLinking(hit.id);
    try {
      const source = await loadNote(hit.id);
      const next = linkFirstMention(source.text, names, noteLinkHref("note", target.noteId));
      if (next === null) {
        toast.info(t(($) => $.notes.vault.mentions.notFound, { title: hit.title }));
        return;
      }
      await saveNote(hit.id, next, source.version);
      setRemoved((current) => new Set(current).add(hit.id));
      toast.success(t(($) => $.notes.vault.mentions.linked, { title: hit.title }));
    } catch (error) {
      notifyError("link note mention", error, t(($) => $.notes.vault.mentions.failed, { title: hit.title }));
    } finally {
      setLinking(null);
    }
  };

  return (
    <NoteLinkSection
      ref={nearRef}
      data-note-mentions=""
      title={t(($) => $.notes.vault.mentions.title)}
      open={open}
      count={unknown ? undefined : shown.length}
      empty={t(($) => $.notes.info.noMentions)}
      onOpenChange={(next) => {
        setToggledFor(target.noteId);
        useNotesPrefsStore.getState().set("mentionsOpen", next);
      }}
      aria-busy={open && unknown}
      className={className}
    >
      {shown.map((hit) => {
        const note = notes.find((candidate) => candidate.id === hit.id);
        const snippet = hit.snippets.find((candidate) => candidate.ranges.length > 0);
        const linkLabel = t(($) => $.notes.vault.mentions.linkLabel, { title: hit.title });
        return (
          <li key={hit.id}>
            <NoteListItem
              icon={<NoteChip icon={note?.icon} color={note?.color} />}
              title={hit.title}
              snippet={snippet ? <NoteSnippet text={snippet.text} ranges={snippet.ranges} /> : undefined}
              onClick={(event) => onOpenNote(hit.noteId, { newTab: isSelectionModifier(event), projectId: hit.id })}
              trailing={
                <Tooltip label={linkLabel} side="left">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 shrink-0 gap-1 px-2 text-xs"
                    aria-label={linkLabel}
                    disabled={linking !== null}
                    onClick={() => void link(hit)}
                  >
                    <Link2 aria-hidden className="size-3.5" />
                    {t(($) => $.notes.vault.mentions.link)}
                  </Button>
                </Tooltip>
              }
            />
          </li>
        );
      })}
    </NoteLinkSection>
  );
}
