import { FilePlus2, Link2, Link2Off, Unlink } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { notifyError } from "@/lib/toast";
import { textFragment } from "./note-block-ids";
import { type DeadLink, findDeadLinks, firstLinkLabel, fixNoteLinks, type LinkFix, type LinkMatch } from "./note-dead-links";
import { NoteChip } from "./note-icons";
import { linkedNoteCreator } from "./note-links";
import { NoteLinkSection, NoteListItem } from "./NoteListItem";
import { useNotesData } from "./notes-data";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import type { NoteItem } from "./types";
import { useNoteLinkIndex, useNoteLinkRecords } from "./use-note-links";
import { NoteSnippet } from "./NoteSnippet";

const NO_KEYS: ReadonlySet<string> = new Set();

function matchOf(link: DeadLink): LinkMatch {
  return { noteId: link.targetId, block: link.missing === "block" ? link.block : null };
}

function useDeadLinks() {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const records = useNoteLinkRecords();
  const index = useNoteLinkIndex();
  const [busy, setBusy] = useState<ReadonlySet<string>>(NO_KEYS);
  const [fixed, setFixed] = useState<ReadonlySet<string>>(NO_KEYS);
  const sources = useMemo(() => new Map(data.notes.map((note) => [note.id, note])), [data.notes]);
  const dead = useMemo(() => {
    if (!records.data || !index.notes) return null;
    return findDeadLinks(records.data, index.notes)
      .filter((link) => sources.has(link.sourceId) && !fixed.has(link.key))
      .sort((left, right) => {
        const leftTitle = sources.get(left.sourceId)?.title ?? "";
        const rightTitle = sources.get(right.sourceId)?.title ?? "";
        return leftTitle.localeCompare(rightTitle) || left.line - right.line;
      });
  }, [fixed, index.notes, records.data, sources]);

  const store = { load: data.loadNote, save: data.saveNote };
  const run = (link: DeadLink, work: () => Promise<number>, failure: string) => {
    setBusy((current) => new Set([...current, link.key]));
    work()
      .then((count) => {
        if (count > 0) setFixed((current) => new Set([...current, link.key]));
      })
      .catch((error: unknown) => notifyError("fix a dead note link", error, failure))
      .finally(() =>
        setBusy((current) => {
          const next = new Set(current);
          next.delete(link.key);
          return next;
        }),
      );
  };
  const apply = (link: DeadLink, fix: LinkFix) =>
    run(link, () => fixNoteLinks(link.sourceId, matchOf(link), fix, store), t(($) => $.notes.linksSearch.dead.fixFailed));
  const createNoteFrom = data.createNoteFrom;
  const create = createNoteFrom
    ? (link: DeadLink) =>
        run(
          link,
          async () => {
            const source = await data.loadNote(link.sourceId);
            const title = firstLinkLabel(source.text, matchOf(link)) ?? link.snippet;
            const note = await linkedNoteCreator((name) => createNoteFrom({ title: name }), data.loadNote)(title);
            return note ? fixNoteLinks(link.sourceId, matchOf(link), { kind: "relink", noteId: note.noteId }, store) : 0;
          },
          t(($) => $.notes.failures.createNote),
        )
    : undefined;
  return { failed: records.failed, dead, sources, busy, apply, create };
}

type DeadLinks = ReturnType<typeof useDeadLinks>;

function DeadLinkFixes({ link, links }: Readonly<{ link: DeadLink; links: DeadLinks }>) {
  const { t } = useTranslation(["notes"]);
  const pending = links.busy.has(link.key);
  const { create } = links;
  return (
    <span className="mt-1 flex shrink-0 gap-0.5">
      {link.missing === "note" && create && (
        <TooltipIconButton label={t(($) => $.notes.linksSearch.dead.create)} disabled={pending} onClick={() => create(link)}>
          <FilePlus2 aria-hidden className="size-4" />
        </TooltipIconButton>
      )}
      {link.missing === "block" && (
        <TooltipIconButton
          label={t(($) => $.notes.linksSearch.dead.relink, { title: link.target?.title ?? "" })}
          disabled={pending}
          onClick={() => links.apply(link, { kind: "relink", noteId: link.targetId })}
        >
          <Unlink aria-hidden className="size-4" />
        </TooltipIconButton>
      )}
      <TooltipIconButton label={t(($) => $.notes.linksSearch.dead.remove)} disabled={pending} onClick={() => links.apply(link, { kind: "remove" })}>
        <Link2Off aria-hidden className="size-4" />
      </TooltipIconButton>
    </span>
  );
}

function useDeadLinkMeta(): (link: DeadLink) => string {
  const { t } = useTranslation(["notes"]);
  return (link) =>
    link.missing === "note"
      ? t(($) => $.notes.linksSearch.dead.noteMeta, { line: link.line })
      : t(($) => $.notes.linksSearch.dead.blockMeta, { line: link.line, block: `^${link.block ?? ""}`, title: link.target?.title ?? "" });
}

export function NoteDeadLinksSection({
  noteId,
  editable,
  onOpenNoteAt,
}: Readonly<{ noteId: string; editable: boolean; onOpenNoteAt: (id: string, fragment: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  const links = useDeadLinks();
  const metaOf = useDeadLinkMeta();
  const open = useNotesPrefsStore((state) => state.deadLinksOpen);
  const own = links.dead?.filter((link) => link.sourceId === noteId);
  if (links.failed) return null;
  return (
    <NoteLinkSection
      title={t(($) => $.notes.linksSearch.dead.title)}
      open={open}
      count={own?.length}
      empty={t(($) => $.notes.info.noDeadLinks)}
      onOpenChange={(next) => useNotesPrefsStore.getState().set("deadLinksOpen", next)}
      aria-busy={open && own === undefined}
    >
      {own?.map((link) => (
        <li key={link.key} data-dead-link={link.missing}>
          <NoteListItem
            icon={<Link2Off aria-hidden className="size-4 text-muted-foreground" />}
            title={metaOf(link)}
            snippet={link.snippet ? <NoteSnippet text={link.snippet} /> : undefined}
            onClick={() => onOpenNoteAt(link.sourceId, textFragment(link.snippet))}
            trailing={editable ? <DeadLinkFixes link={link} links={links} /> : undefined}
          />
        </li>
      ))}
    </NoteLinkSection>
  );
}

export function NoteDeadLinks({ onOpenNoteAt }: Readonly<{ onOpenNoteAt: (id: string, fragment: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  const links = useDeadLinks();
  const metaOf = useDeadLinkMeta();
  const { dead, sources } = links;

  if (links.failed) return <EmptyState className="h-full p-6" description={t(($) => $.notes.linksSearch.dead.failed)} />;
  if (dead === null) return <LoadingState className="h-full p-6" label={t(($) => $.notes.linksSearch.dead.loading)} />;
  if (dead.length === 0) {
    return (
      <EmptyState
        className="h-full p-6"
        icon={<Link2 aria-hidden className="size-6" />}
        title={t(($) => $.notes.linksSearch.dead.title)}
        description={t(($) => $.notes.linksSearch.dead.none)}
      />
    );
  }
  const notesGone = dead.filter((link) => link.missing === "note");
  const blocksGone = dead.filter((link) => link.missing === "block");
  const row = (link: DeadLink, source: NoteItem) => (
    <li key={link.key} data-dead-link={link.missing}>
      <NoteListItem
        icon={<NoteChip icon={source.icon} color={source.color} />}
        title={source.title}
        meta={metaOf(link)}
        snippet={link.snippet ? <NoteSnippet text={link.snippet} /> : undefined}
        onClick={() => onOpenNoteAt(source.id, textFragment(link.snippet))}
        trailing={<DeadLinkFixes link={link} links={links} />}
      />
    </li>
  );
  const section = (title: string, group: readonly DeadLink[], kind: string) =>
    group.length > 0 && (
      <NoteLinkSection title={`${title} (${group.length})`} data-dead-links={kind} className="mt-6 first:mt-0 first:border-t-0 first:pt-0">
        {group.flatMap((link) => {
          const source = sources.get(link.sourceId);
          return source ? [row(link, source)] : [];
        })}
      </NoteLinkSection>
    );
  return (
    <div className="h-full overflow-y-auto" data-note-dead-links="">
      <div className="mx-auto w-full max-w-[44rem] px-4 py-8">
        <h1 className="text-xl font-semibold">{t(($) => $.notes.linksSearch.dead.title)}</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">{t(($) => $.notes.linksSearch.dead.summary, { count: dead.length })}</p>
        {section(t(($) => $.notes.linksSearch.dead.missingNotes), notesGone, "note")}
        {section(t(($) => $.notes.linksSearch.dead.missingBlocks), blocksGone, "block")}
      </div>
    </div>
  );
}
