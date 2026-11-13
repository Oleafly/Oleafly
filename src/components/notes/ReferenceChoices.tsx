import type { ZoteroHit } from "@oleafly/backend-port";
import { Command } from "cmdk";
import { BookOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { COMMAND_GROUP, COMMAND_ITEM } from "@/components/ui/command-dialog";
import { useFreshZoteroHits, ZoteroHitRow } from "@/components/zotero/fresh-hits";
import { useFilesStore } from "@/store/files";
import { citekeyOf, matchingCitations, zoteroReference } from "./note-citations";
import { draftFromReference } from "./note-templates";
import { useNotesData } from "./notes-data";
import type { CitationItem } from "./types";

const LIMIT = 6;
const ICON = <BookOpen aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;

export interface ReferenceMatches {
  readonly entries: readonly CitationItem[];
  readonly hits: readonly ZoteroHit[];
}

export function useReferenceMatches(query: string, open: boolean): ReferenceMatches {
  const { citations, projectCitations } = useNotesData();
  const projectId = useFilesStore((state) => state.projectId);
  const [found, setFound] = useState<readonly CitationItem[]>([]);
  const searching = open && query.trim() !== "";
  useEffect(() => {
    if (!searching || !projectId || !projectCitations) return;
    let live = true;
    projectCitations(projectId).then(
      (entries) => {
        if (live) setFound(entries);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectCitations, projectId, searching]);
  const known = useMemo(() => [...new Map([...(citations ?? []), ...found].map((entry) => [entry.key, entry])).values()], [citations, found]);
  const entries = useMemo(() => (searching ? matchingCitations(known, query).slice(0, LIMIT) : []), [known, query, searching]);
  const keys = useMemo(() => known.map((entry) => entry.key), [known]);
  const { hits } = useFreshZoteroHits(searching ? query : "", keys, LIMIT);
  return { entries, hits };
}

export function useReferenceNote(): ((reference: CitationItem) => Promise<string>) | undefined {
  const { notes, createNoteFrom } = useNotesData();
  const { i18n } = useTranslation(["notes"]);
  if (!createNoteFrom) return undefined;
  return async (reference) => {
    const existing = notes.find((note) => citekeyOf(note) === reference.key);
    return existing ? existing.id : createNoteFrom(draftFromReference(reference, new Date(), i18n.language));
  };
}

export function ReferenceChoices({
  matches,
  disabled = false,
  onPick,
}: Readonly<{ matches: ReferenceMatches; disabled?: boolean; onPick: (reference: CitationItem) => void }>) {
  const { t } = useTranslation(["notes"]);
  if (matches.entries.length === 0 && matches.hits.length === 0) return null;
  return (
    <Command.Group heading={t(($) => $.notes.citations.fromReference)} className={COMMAND_GROUP}>
      {matches.entries.map((entry) => (
        <Command.Item key={entry.key} value={`reference:${entry.key}`} disabled={disabled} onSelect={() => onPick(entry)} className={COMMAND_ITEM}>
          {ICON}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{entry.label}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{entry.key}</span>
          </span>
        </Command.Item>
      ))}
      {matches.hits.map((hit) => (
        <Command.Item
          key={`${hit.library}:${hit.itemKey}`}
          value={`zotero:${hit.library}:${hit.itemKey}`}
          disabled={disabled}
          onSelect={() => onPick(zoteroReference(hit))}
          className={COMMAND_ITEM}
        >
          {ICON}
          <ZoteroHitRow hit={hit} />
        </Command.Item>
      ))}
    </Command.Group>
  );
}
