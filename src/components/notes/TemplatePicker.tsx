import { Command, defaultFilter } from "cmdk";
import { FileText } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { COMMAND_GROUP as GROUP, COMMAND_ITEM, CommandDialogShell } from "@/components/ui/command-dialog";
import { useModalLayer } from "@/components/ui/use-modal-accessibility";
import { compareText } from "@/lib/intl";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { NoteChip } from "./note-icons";
import { fold } from "./note-search";
import { draftFromNote, draftFromTemplate, isTemplateNote, NOTE_TEMPLATES, type NoteTemplate } from "./note-templates";
import { type NoteDraft, useNotesData } from "./notes-data";
import type { NoteItem } from "./types";

const BLANK_VALUE = "\u0000blank";
const ITEM = cn(COMMAND_ITEM, "items-start data-[disabled=true]:opacity-50");

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

function matches(query: string, ...texts: string[]): boolean {
  const search = fold(query.trim());
  return search === "" || texts.some((text) => defaultFilter(fold(text), search) > 0);
}

function Choice({
  value,
  icon,
  name,
  description,
  disabled,
  onSelect,
}: Readonly<{ value: string; icon: ReactNode; name: string; description: string; disabled: boolean; onSelect: () => void }>) {
  return (
    <Command.Item value={value} disabled={disabled} onSelect={onSelect} className={ITEM}>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </Command.Item>
  );
}

export function TemplatePicker({ open, onOpenChange, onCreated }: Readonly<TemplatePickerProps>) {
  const { t, i18n } = useTranslation(["notes"]);
  useModalLayer(open);
  const { notes, createNoteFrom, loadNote } = useNotesData();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const name = (template: NoteTemplate) => t(($) => $.notes.vault.templates.names[template.id]);
  const describe = (template: NoteTemplate) => t(($) => $.notes.vault.templates.descriptions[template.id]);
  const blank = t(($) => $.notes.vault.templates.blank);
  const builtIn = NOTE_TEMPLATES.filter((template) => matches(query, name(template), describe(template)));
  const yours = useMemo(
    () => notes.filter(isTemplateNote).sort((left, right) => compareText(left.title, right.title)),
    [notes],
  );
  const shownYours = yours.filter((note) => matches(query, note.title));
  const showBlank = matches(query, blank);

  const create = (draft: () => Promise<NoteDraft>) => {
    if (!createNoteFrom || busy) return;
    setBusy(true);
    draft()
      .then((value) => createNoteFrom(value))
      .then(
        (id) => {
          onOpenChange(false);
          onCreated(id);
        },
        (error: unknown) => notifyError("create note from template", error, t(($) => $.notes.vault.templates.failed)),
      )
      .finally(() => setBusy(false));
  };

  const fromTemplate = (template: NoteTemplate) =>
    create(async () => draftFromTemplate(template, name(template), new Date(), i18n.language));
  const fromNote = (note: NoteItem) =>
    create(async () => draftFromNote(note.title, (await loadNote(note.id)).text, new Date(), i18n.language));
  const fromBlank = () => create(async () => ({ title: t(($) => $.notes.document.untitled) }));

  const nothing = !showBlank && builtIn.length === 0 && shownYours.length === 0;
  return (
    <CommandDialogShell
      open={open}
      onOpenChange={onOpenChange}
      label={t(($) => $.notes.vault.templates.label)}
      shouldFilter={false}
      loop
      query={query}
      onQueryChange={setQuery}
      placeholder={t(($) => $.notes.vault.templates.placeholder)}
      placement="top-[16%]"
      listClassName="max-h-[min(64vh,440px)]"
    >
      {nothing && <p className="py-6 text-center text-sm text-muted-foreground">{t(($) => $.notes.vault.templates.empty)}</p>}
      {showBlank && (
        <Command.Group className={GROUP}>
          <Choice
            value={BLANK_VALUE}
            icon={<FileText aria-hidden className="size-4" />}
            name={blank}
            description={t(($) => $.notes.vault.templates.blankDescription)}
            disabled={busy}
            onSelect={fromBlank}
          />
        </Command.Group>
      )}
      {builtIn.length > 0 && (
        <Command.Group heading={t(($) => $.notes.vault.templates.builtIn)} className={GROUP}>
          {builtIn.map((template) => (
            <Choice
              key={template.id}
              value={template.id}
              icon={<NoteChip icon={template.icon} color={template.color} className="size-5" />}
              name={name(template)}
              description={describe(template)}
              disabled={busy}
              onSelect={() => fromTemplate(template)}
            />
          ))}
        </Command.Group>
      )}
      {shownYours.length > 0 && (
        <Command.Group heading={t(($) => $.notes.vault.templates.yours)} className={GROUP}>
          {shownYours.map((note) => (
            <Choice
              key={note.id}
              value={`note:${note.id}`}
              icon={<NoteChip icon={note.icon} color={note.color} className="size-5" />}
              name={note.title}
              description={t(($) => $.notes.vault.templates.yoursDescription)}
              disabled={busy}
              onSelect={() => fromNote(note)}
            />
          ))}
        </Command.Group>
      )}
    </CommandDialogShell>
  );
}
