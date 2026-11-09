import { Link2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { logError } from "@/lib/log";
import type { NoteSearchHit } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { NoteChip } from "./note-icons";
import { isLinkableId, noteLinkHref } from "./note-link-format";
import type { OpenNoteHandler } from "./note-links";
import { highlightParts, linkFirstMention, phraseQuery } from "./note-search";
import { useNotesData } from "./notes-data";
import { isSelectionModifier } from "@/store/library-selection";
import { backlinksOf, useNoteLinkIndex } from "./use-note-links";
import { useVaultKey, vaultQuery } from "./vault-loads";

export const MENTION_LIMIT = 20;
export const MENTION_NAMES = 6;
export const MENTION_DELAY_MS = 300;

function mentionedInBody(hit: NoteSearchHit): boolean {
  return hit.snippets.some((snippet) => snippet.ranges.length > 0);
}

export function Highlighted({ text, ranges }: Readonly<{ text: string; ranges: readonly (readonly [number, number])[] }>) {
  return (
    <>
      {highlightParts(text, ranges).map((part) =>
        part.match ? (
          <mark key={part.start} className="rounded-sm bg-primary/15 px-px text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={part.start}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function NoteMentions({
  noteId,
  onOpenNote,
  className,
}: Readonly<{ noteId: string | null | undefined; onOpenNote: OpenNoteHandler; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const headingId = useId();
  const data = useNotesData();
  const { notes, searchNotes, loadNote, saveNote } = data;
  const vault = useVaultKey();
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const index = useNoteLinkIndex();
  const backlinks = backlinksOf(index, noteId);
  const [hits, setHits] = useState<readonly NoteSearchHit[]>([]);
  const [linking, setLinking] = useState<string | null>(null);

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

  useEffect(() => {
    if (!searchNotes || names.length === 0) {
      setHits([]);
      return;
    }
    let live = true;
    const run = () =>
      Promise.all(
        names.map((name) =>
          vaultQuery(searchNotes, vault, `${MENTION_LIMIT}\u0000${phraseQuery(name)}`, () => searchNotes(phraseQuery(name), MENTION_LIMIT)),
        ),
      ).then(
        (lists) => {
          if (!live) return;
          const seen = new Set<string>();
          const known = new Set(notesRef.current.map((note) => note.id));
          const merged: NoteSearchHit[] = [];
          for (const hit of lists.flat()) {
            if (hit.id === selfId || seen.has(hit.id) || !known.has(hit.id) || !mentionedInBody(hit)) continue;
            seen.add(hit.id);
            merged.push(hit);
          }
          setHits(merged.slice(0, MENTION_LIMIT));
        },
        (error: unknown) => void logError("find note mentions", error),
      );
    const timer = window.setTimeout(run, MENTION_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [names, searchNotes, selfId, vault]);

  const linked = new Set(backlinks.map((backlink) => backlink.projectId));
  const shown = hits.filter((hit) => !linked.has(hit.id));
  if (!target || shown.length === 0) return null;

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
      setHits((current) => current.filter((candidate) => candidate.id !== hit.id));
      toast.success(t(($) => $.notes.vault.mentions.linked, { title: hit.title }));
    } catch (error) {
      notifyError("link note mention", error, t(($) => $.notes.vault.mentions.failed, { title: hit.title }));
    } finally {
      setLinking(null);
    }
  };

  return (
    <section aria-labelledby={headingId} data-note-mentions className={cn("mt-12 border-t pt-4", className)}>
      <h2 id={headingId} className="px-2 text-xs font-medium text-muted-foreground">
        {t(($) => $.notes.vault.mentions.title)}
      </h2>
      <ul className="mt-2 space-y-0.5">
        {shown.map((hit) => {
          const note = notes.find((candidate) => candidate.id === hit.id);
          const snippet = hit.snippets.find((candidate) => candidate.ranges.length > 0);
          return (
            <li key={hit.id} className="group/mention flex items-start gap-1">
              <button
                type="button"
                onClick={(event) =>
                  onOpenNote(hit.noteId, { newTab: isSelectionModifier(event), projectId: hit.id })
                }
                className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent motion-reduce:transition-none"
              >
                <NoteChip icon={note?.icon} color={note?.color} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{hit.title}</span>
                  {snippet && (
                    <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      <Highlighted text={snippet.text} ranges={snippet.ranges} />
                    </span>
                  )}
                </span>
              </button>
              <Tooltip label={t(($) => $.notes.vault.mentions.linkLabel, { title: hit.title })} side="left">
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 shrink-0 gap-1 px-2 text-xs"
                  aria-label={t(($) => $.notes.vault.mentions.linkLabel, { title: hit.title })}
                  disabled={linking !== null}
                  onClick={() => void link(hit)}
                >
                  <Link2 aria-hidden className="size-3.5" />
                  {t(($) => $.notes.vault.mentions.link)}
                </Button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
