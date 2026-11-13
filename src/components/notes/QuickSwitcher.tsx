import { Command } from "cmdk";
import { FilePlus2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { COMMAND_GROUP as GROUP, COMMAND_ITEM as ITEM, CommandDialogShell } from "@/components/ui/command-dialog";
import { EmptyState } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { useModalLayer } from "@/components/ui/use-modal-accessibility";
import { notifyError } from "@/lib/toast";
import { isSelectionModifier } from "@/store/library-selection";
import { isMac, shortcut } from "@/lib/utils";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { NoteChip } from "./note-icons";
import { hasExactTitle, switcherMatches, type SwitcherMatch } from "./note-search";
import { useNotesData } from "./notes-data";
import { ReferenceChoices, useReferenceMatches, useReferenceNote } from "./ReferenceChoices";
import type { CitationItem } from "./types";
import { setQuickSwitcherOpen, useVaultStore } from "./vault-store";

const CREATE_VALUE = "\u0000create";

interface OpenHandlers {
  onOpenNote: (id: string) => void;
  onOpenNoteInNewTab: (id: string) => void;
}

function MatchRow({ match, onSelect }: Readonly<{ match: SwitcherMatch; onSelect: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const { note, alias } = match;
  return (
    <Command.Item value={note.id} onSelect={onSelect} className={ITEM}>
      <NoteChip icon={note.icon} color={note.color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{note.title}</span>
        {alias && (
          <span className="block truncate text-xs text-muted-foreground">
            {t(($) => $.notes.vault.switcher.alias, { alias })}
          </span>
        )}
      </span>
      <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{note.project}</span>
    </Command.Item>
  );
}

export function QuickSwitcher({ onOpenNote, onOpenNoteInNewTab }: Readonly<OpenHandlers>) {
  const { t } = useTranslation(["notes"]);
  const open = useVaultStore((state) => state.switcherOpen);
  useModalLayer(open);
  const { notes, createNoteFrom } = useNotesData();
  const opened = useNotesPrefsStore((state) => state.opened);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const searched = useDeferredValue(query);
  const matches = useMemo(() => (open ? switcherMatches(notes, searched, opened) : []), [notes, open, opened, searched]);
  const title = searched.trim();
  const canCreate = title !== "" && createNoteFrom !== undefined && !hasExactTitle(notes, title);
  const recent = title === "" ? matches.filter((match) => opened[match.note.id] !== undefined) : [];
  const rest = title === "" ? matches.filter((match) => opened[match.note.id] === undefined) : matches;
  const references = useReferenceMatches(searched, open);
  const referenceNote = useReferenceNote();
  const first = matches[0]?.note.id ?? (canCreate ? CREATE_VALUE : "");

  useEffect(() => {
    setSelected(first);
  }, [first]);

  const choose = (id: string, newTab: boolean) => {
    setQuickSwitcherOpen(false);
    if (newTab) onOpenNoteInNewTab(id);
    else onOpenNote(id);
  };

  const create = () => {
    if (!createNoteFrom) return;
    setQuickSwitcherOpen(false);
    createNoteFrom({ title: query.trim() }).then(onOpenNote, (error: unknown) =>
      notifyError("create note", error, t(($) => $.notes.vault.switcher.createFailed)),
    );
  };

  const fromReference = (reference: CitationItem) => {
    if (!referenceNote) return;
    setQuickSwitcherOpen(false);
    referenceNote(reference).then(onOpenNote, (error: unknown) =>
      notifyError("create note from a reference", error, t(($) => $.notes.vault.switcher.createFailed)),
    );
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || !isSelectionModifier(event)) return;
    event.preventDefault();
    if (selected === CREATE_VALUE) create();
    else if (matches.some((match) => match.note.id === selected)) choose(selected, true);
  };

  const modKey = shortcut("⌘", isMac).replace(/\+$/u, "");
  return (
    <CommandDialogShell
      open={open}
      onOpenChange={setQuickSwitcherOpen}
      label={t(($) => $.notes.vault.switcher.label)}
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
      onKeyDown={onKeyDown}
      query={query}
      onQueryChange={setQuery}
      placeholder={t(($) => $.notes.vault.switcher.placeholder)}
      footer={
        <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            {t(($) => $.notes.vault.switcher.openHint)}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>{modKey}</Kbd>
            <Kbd>↵</Kbd>
            {t(($) => $.notes.vault.switcher.newTabHint)}
          </span>
        </div>
      }
    >
      {matches.length === 0 && !canCreate && references.entries.length === 0 && references.hits.length === 0 && (
        <EmptyState
          className="py-6"
          description={notes.length === 0 ? t(($) => $.notes.vault.switcher.empty) : t(($) => $.notes.vault.switcher.noMatches)}
        />
      )}
      {recent.length > 0 && (
        <Command.Group heading={t(($) => $.notes.vault.switcher.recent)} className={GROUP}>
          {recent.map((match) => (
            <MatchRow key={match.note.id} match={match} onSelect={() => choose(match.note.id, false)} />
          ))}
        </Command.Group>
      )}
      {rest.length > 0 && (
        <Command.Group heading={t(($) => $.notes.vault.switcher.notes)} className={GROUP}>
          {rest.map((match) => (
            <MatchRow key={match.note.id} match={match} onSelect={() => choose(match.note.id, false)} />
          ))}
        </Command.Group>
      )}
      {canCreate && (
        <Command.Group className={GROUP}>
          <Command.Item value={CREATE_VALUE} onSelect={create} className={ITEM}>
            <FilePlus2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t(($) => $.notes.vault.switcher.create, { title })}</span>
          </Command.Item>
        </Command.Group>
      )}
      {referenceNote && <ReferenceChoices matches={references} onPick={fromReference} />}
    </CommandDialogShell>
  );
}

export function NotesVaultLayer({
  onOpenNote,
  onOpenNoteInNewTab,
  onToday,
}: Readonly<OpenHandlers & { onToday?: () => void }>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { bindings } = useShortcutStore.getState();
      if (matchesShortcut(event, bindings.notesQuickSwitcher)) {
        event.preventDefault();
        setQuickSwitcherOpen(!useVaultStore.getState().switcherOpen);
      } else if (onToday && matchesShortcut(event, bindings.notesTodayNote)) {
        event.preventDefault();
        onToday();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToday]);
  useEffect(() => () => setQuickSwitcherOpen(false), []);
  return <QuickSwitcher onOpenNote={onOpenNote} onOpenNoteInNewTab={onOpenNoteInNewTab} />;
}
