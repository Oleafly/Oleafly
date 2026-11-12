import { Calendar, CheckSquare, Hash, Link2, List, Plus, Text, Trash2, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PROPERTY_TYPES, type PropertyType, useNotesPrefsStore } from "@/store/notes-prefs";
import { cn } from "@/lib/utils";
import { NoteChip } from "./note-icons";
import { noteLinkHref, parseNoteLink } from "./note-link-format";
import type { LinkableNote } from "./note-links";
import { NoteSectionToggle, useNotePanelSections } from "./NoteListItem";
import {
  canAddProperty,
  conversionLoss,
  convertValue,
  emptyValue,
  LIST_KEYS,
  readProperties,
  removeProperty,
  renameProperty,
  setProperty,
  type NoteProperty,
  type PropertyValue,
} from "./note-properties";

const TYPE_ICONS: Readonly<Record<PropertyType, LucideIcon>> = {
  text: Text,
  list: List,
  number: Hash,
  checkbox: CheckSquare,
  date: Calendar,
  link: Link2,
};
const BARE = "h-8 min-w-0 border-0 bg-transparent px-1.5 hover:bg-accent/50";

export type FrontMatterUpdate = (update: (text: string) => string) => void;

interface NotePropertiesProps {
  frontMatter: string;
  onChange: FrontMatterUpdate;
  notes?: readonly LinkableNote[] | null;
  onOpenNote?: (note: LinkableNote) => void;
  onEditSource?: () => void;
  editable?: boolean;
}

function focusAfterRemoving(list: HTMLElement | null, key: string): HTMLElement | null {
  const rows = [...(list?.children ?? [])].filter(
    (row): row is HTMLElement => row instanceof HTMLElement && row.dataset.property !== undefined,
  );
  const index = rows.findIndex((row) => row.dataset.property === key);
  const neighbour = index < 0 ? undefined : (rows[index + 1] ?? rows[index - 1]);
  return (
    neighbour?.querySelector<HTMLElement>("[data-property-menu]") ??
    list?.closest("article")?.querySelector<HTMLElement>(".ProseMirror") ??
    null
  );
}

function TextField({
  value,
  label,
  type = "text",
  disabled,
  error,
  onCommit,
}: Readonly<{
  value: string;
  label: string;
  type?: "text" | "number";
  disabled?: boolean;
  error?: (draft: string) => string | null;
  onCommit: (value: string) => void;
}>) {
  const [draft, setDraft] = useState<string | null>(null);
  const hint = useId();
  const shown = draft ?? value;
  const problem = draft === null ? null : (error?.(draft) ?? null);
  const commit = () => {
    if (draft !== null && draft !== value && problem === null) onCommit(draft);
    setDraft(null);
  };
  const input = (
    <Input
      type={type}
      aria-label={label}
      aria-invalid={problem === null ? undefined : true}
      aria-describedby={problem === null ? undefined : hint}
      value={shown}
      disabled={disabled}
      inputMode={type === "number" ? "decimal" : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isImeEnter(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          if (problem === null) commit();
        }
        if (event.key === "Escape") setDraft(null);
      }}
      className={BARE}
    />
  );
  if (!error) return input;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      {input}
      {problem !== null && (
        <span id={hint} className="px-1.5 text-xs text-destructive">
          {problem}
        </span>
      )}
    </span>
  );
}

function ListField({
  items,
  label,
  disabled,
  onCommit,
}: Readonly<{ items: readonly string[]; label: string; disabled?: boolean; onCommit: (items: string[]) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [draft, setDraft] = useState("");
  const add = () => {
    const next = draft.trim();
    setDraft("");
    if (next && !items.includes(next)) onCommit([...items, next]);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeEnter(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && draft === "" && items.length > 0) {
      onCommit(items.slice(0, -1));
    }
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 px-1 py-0.5">
      {items.map((item) => (
        <span key={item} className="inline-flex max-w-full items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-xs">
          <span className="truncate">{item}</span>
          {!disabled && (
            <button
              type="button"
              aria-label={t(($) => $.notes.kb.properties.removeItem, { item })}
              onClick={() => onCommit(items.filter((candidate) => candidate !== item))}
              className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-accent motion-reduce:transition-none"
            >
              <X aria-hidden className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <Input
          aria-label={label}
          value={draft}
          placeholder={items.length === 0 ? t(($) => $.notes.kb.properties.addItem) : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          className={cn(BARE, "h-6 w-24 flex-1 text-xs")}
        />
      )}
    </div>
  );
}

function LinkField({
  value,
  label,
  notes,
  disabled,
  onCommit,
  onOpen,
}: Readonly<{
  value: string | null;
  label: string;
  notes: readonly LinkableNote[];
  disabled?: boolean;
  onCommit: (value: string | null) => void;
  onOpen?: (note: LinkableNote) => void;
}>) {
  const { t } = useTranslation(["notes"]);
  const target = parseNoteLink(value);
  const linked = target ? notes.find((note) => note.noteId === target.id) : undefined;
  return (
    <div className="flex min-w-0 items-center gap-1">
      {linked && onOpen ? (
        <Button type="button" variant="ghostPrimary" size="sm" onClick={() => onOpen(linked)} aria-label={t(($) => $.notes.kb.properties.openNote, { title: linked.title })} className="min-w-0 gap-1.5 px-1.5 text-sm font-normal">
          <NoteChip icon={linked.icon} color={linked.color} className="size-4 rounded" />
          <span className="truncate">{linked.title}</span>
        </Button>
      ) : (
        value && <span className="truncate px-1.5 text-sm text-muted-foreground">{linked?.title ?? t(($) => $.notes.links.missingNote)}</span>
      )}
      {!disabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" aria-label={label} className="px-1.5 text-sm font-normal text-muted-foreground">
              {value ? t(($) => $.notes.kb.properties.changeNote) : t(($) => $.notes.kb.properties.chooseNote)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
            {notes.map((note) => (
              <DropdownMenuItem key={note.noteId} onSelect={() => onCommit(noteLinkHref("note", note.noteId))} className="gap-2 text-xs">
                <NoteChip icon={note.icon} color={note.color} className="size-4 rounded" />
                <span className="truncate">{note.title}</span>
              </DropdownMenuItem>
            ))}
            {value && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onCommit(null)} className="text-xs">
                  {t(($) => $.notes.kb.properties.clearLink)}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function ValueField({
  property,
  notes,
  disabled,
  onCommit,
  onOpenNote,
}: Readonly<{
  property: NoteProperty;
  notes: readonly LinkableNote[];
  disabled: boolean;
  onCommit: (value: PropertyValue) => void;
  onOpenNote?: (note: LinkableNote) => void;
}>) {
  const { t } = useTranslation(["notes"]);
  const label = t(($) => $.notes.kb.properties.value, { key: property.key });
  const { value } = property;
  if (property.readOnly) return <span className="truncate px-1.5 py-1 font-mono text-xs text-muted-foreground">{String(value)}</span>;
  switch (property.type) {
    case "checkbox":
      return (
        <span className="flex h-8 items-center px-1.5">
          <Checkbox aria-label={label} checked={value === true} disabled={disabled} onCheckedChange={(checked) => onCommit(checked === true)} />
        </span>
      );
    case "list":
      return <ListField items={Array.isArray(value) ? value : []} label={label} disabled={disabled} onCommit={onCommit} />;
    case "number":
      return (
        <TextField
          type="number"
          label={label}
          value={typeof value === "number" ? String(value) : ""}
          disabled={disabled}
          onCommit={(text) => onCommit(convertValue(text, "number"))}
        />
      );
    case "date":
      return <DatePicker clearable aria-label={label} value={typeof value === "string" ? value : null} disabled={disabled} onChange={onCommit} buttonClassName={cn(BARE, "w-fit")} />;
    case "link":
      return (
        <LinkField
          value={typeof value === "string" ? value : null}
          label={label}
          notes={notes}
          disabled={disabled}
          onCommit={onCommit}
          onOpen={onOpenNote}
        />
      );
    default:
      return <TextField label={label} value={value === null ? "" : String(value)} disabled={disabled} onCommit={(text) => onCommit(text === "" ? null : text)} />;
  }
}

function TypeMenu({
  property,
  disabled,
  onType,
  onRemove,
  onRemoved,
}: Readonly<{
  property: NoteProperty;
  disabled: boolean;
  onType: (type: PropertyType) => void;
  onRemove: () => void;
  onRemoved: () => void;
}>) {
  const { t } = useTranslation(["notes"]);
  const Icon = TYPE_ICONS[property.type];
  const typeLabel = t(($) => $.notes.kb.properties.types[property.type]);
  const pending = useRef<PropertyType | null>(null);
  const removed = useRef(false);
  if (disabled) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-property-menu
        aria-label={t(($) => $.notes.kb.properties.type, { key: property.key, type: typeLabel })}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent motion-reduce:transition-none"
      >
        <Icon aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44"
        onCloseAutoFocus={(event) => {
          if (removed.current) {
            removed.current = false;
            event.preventDefault();
            onRemoved();
            return;
          }
          const type = pending.current;
          pending.current = null;
          if (type !== null) onType(type);
        }}
      >
        {!LIST_KEYS.has(property.key) && !property.readOnly && (
          <>
            <DropdownMenuRadioGroup
              value={property.type}
              onValueChange={(type) => {
                pending.current = type as PropertyType;
              }}
            >
              {PROPERTY_TYPES.map((type) => {
                const TypeIcon = TYPE_ICONS[type];
                return (
                  <DropdownMenuRadioItem key={type} value={type} className="gap-2 text-xs">
                    <TypeIcon aria-hidden className="size-3.5" />
                    {t(($) => $.notes.kb.properties.types[type])}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onSelect={() => {
            removed.current = true;
            onRemove();
          }}
          className="gap-2 text-xs text-destructive"
        >
          <Trash2 aria-hidden className="size-3.5" />
          {t(($) => $.notes.kb.properties.remove)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KeyField({
  name,
  frontMatter,
  disabled,
  onRename,
}: Readonly<{ name: string; frontMatter: string; disabled: boolean; onRename: (name: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  const taken = t(($) => $.notes.kb.properties.taken);
  const problem = (draft: string) => {
    const next = draft.trim();
    return next === "" || next === name || canAddProperty(frontMatter, next) ? null : taken;
  };
  return (
    <TextField
      label={t(($) => $.notes.kb.properties.name, { key: name })}
      value={name}
      disabled={disabled}
      error={problem}
      onCommit={(next) => {
        if (next.trim() !== "") onRename(next);
      }}
    />
  );
}

interface PendingConversion {
  property: NoteProperty;
  type: PropertyType;
  loss: "items" | "value";
}

function NewProperty({ frontMatter, onAdd, onCancel }: Readonly<{ frontMatter: string; onAdd: (key: string) => void; onCancel: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const [name, setName] = useState("");
  const hint = useId();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const taken = name.trim() !== "" && !canAddProperty(frontMatter, name);
  const commit = () => {
    if (name.trim() === "") onCancel();
    else if (!taken) onAdd(name.trim());
  };
  return (
    <div className="flex items-center gap-1 pl-7">
      <Input
        ref={field}
        aria-label={t(($) => $.notes.kb.properties.newName)}
        aria-invalid={taken || undefined}
        aria-describedby={taken ? hint : undefined}
        placeholder={t(($) => $.notes.kb.properties.newName)}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (isImeEnter(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") onCancel();
        }}
        className={cn(BARE, "w-48")}
      />
      {taken && (
        <span id={hint} className="text-xs text-destructive">
          {t(($) => $.notes.kb.properties.taken)}
        </span>
      )}
    </div>
  );
}

export function NoteProperties({ frontMatter, onChange, notes, onOpenNote, onEditSource, editable = true }: Readonly<NotePropertiesProps>) {
  const { t } = useTranslation(["notes"]);
  const known = useNotesPrefsStore((state) => state.propertyTypes);
  const properties = useMemo(() => readProperties(frontMatter, known), [frontMatter, known]);
  const open = useNotesPrefsStore((state) => state.propertiesOpen);
  const panel = useNotePanelSections();
  const setOpen = (value: boolean) => useNotesPrefsStore.getState().set("propertiesOpen", value);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<PendingConversion | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const refocus = useRef<HTMLElement | null>(null);
  const list = properties ?? [];
  const linkable = notes ?? [];

  const write = (update: (text: string) => string) => onChange(update);
  const remove = (key: string) => {
    refocus.current = focusAfterRemoving(listRef.current, key);
    write((text) => removeProperty(text, key));
  };
  const restoreFocus = () => {
    const target = refocus.current;
    refocus.current = null;
    if (target?.isConnected) target.focus();
  };
  const commit = (key: string, value: PropertyValue) => write((text) => setProperty(text, key, value));
  const applyType = (property: NoteProperty, type: PropertyType) => {
    useNotesPrefsStore.getState().set("propertyTypes", { ...known, [property.key]: type });
    commit(property.key, convertValue(property.value, type));
  };
  const changeType = (property: NoteProperty, type: PropertyType) => {
    if (type === property.type) return;
    const loss = conversionLoss(property.value, type);
    if (loss === null) applyType(property, type);
    else setConverting({ property, type, loss });
  };
  const add = (key: string) => {
    setAdding(false);
    setOpen(true);
    write((text) => setProperty(text, key, emptyValue(known[key] ?? "text")));
  };
  const toggle = () => {
    setOpen(!open);
  };
  const startAdding = () => {
    setAdding(true);
    if (!open) setOpen(true);
  };

  if (properties === null) {
    if (!frontMatter.trim()) return null;
    return (
      <div data-properties-invalid className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", panel ? "border-b px-3.5 py-2" : "mb-4")}>
        <p className="text-xs text-muted-foreground">{t(($) => $.notes.kb.properties.invalid)}</p>
        {onEditSource && (
          <Button type="button" variant="outline" size="xs" onClick={onEditSource}>
            {t(($) => $.notes.kb.properties.editSource)}
          </Button>
        )}
      </div>
    );
  }
  if (list.length === 0 && !adding && !panel) {
    if (!editable) return null;
    return (
      <button
        type="button"
        data-add-property
        onClick={startAdding}
        className="-ml-1.5 mt-1 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:opacity-100 group-hover/header:opacity-100 motion-reduce:transition-none"
      >
        <Plus aria-hidden className="size-4" />
        {t(($) => $.notes.kb.properties.add)}
      </button>
    );
  }
  return (
    <section aria-label={t(($) => $.notes.kb.properties.title)} className={cn("note-properties", panel ? "border-b px-1.5 py-1" : "mt-3")}>
      <NoteSectionToggle open={open} count={list.length} onClick={toggle} className={panel ? undefined : "-ml-1.5"}>
        {t(($) => $.notes.kb.properties.title)}
      </NoteSectionToggle>
      {open && (
        <ul ref={listRef} className={cn("flex flex-col gap-0.5", panel ? "pb-1" : "mt-1")}>
          {list.length === 0 && !adding && !editable && (
            <li className="px-2 py-1 text-xs text-muted-foreground">{t(($) => $.notes.info.noProperties)}</li>
          )}
          {list.map((property) => (
            <li
              key={property.key}
              data-property={property.key}
              className={cn(
                "grid items-start gap-1",
                panel ? "grid-cols-[minmax(5rem,8rem)_minmax(0,1fr)]" : "grid-cols-[minmax(7rem,11rem)_1fr]",
              )}
            >
              <div className="flex min-w-0 items-center">
                <TypeMenu
                  property={property}
                  disabled={!editable}
                  onType={(type) => changeType(property, type)}
                  onRemove={() => remove(property.key)}
                  onRemoved={restoreFocus}
                />
                <KeyField
                  name={property.key}
                  frontMatter={frontMatter}
                  disabled={!editable}
                  onRename={(name) => write((text) => renameProperty(text, property.key, name))}
                />
              </div>
              <ValueField
                property={property}
                notes={linkable}
                disabled={!editable}
                onCommit={(value) => commit(property.key, value)}
                onOpenNote={onOpenNote}
              />
            </li>
          ))}
          {adding && (
            <li>
              <NewProperty frontMatter={frontMatter} onAdd={add} onCancel={() => setAdding(false)} />
            </li>
          )}
          {editable && !adding && (
            <li>
            <button
              type="button"
              data-add-property
              onClick={startAdding}
              className="flex h-7 w-fit items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent motion-reduce:transition-none"
            >
              <Plus aria-hidden className="size-3.5" />
              {t(($) => $.notes.kb.properties.add)}
            </button>
            </li>
          )}
        </ul>
      )}
      {converting && (
        <ConfirmationDialog
          open
          title={t(($) => $.notes.kb.properties.convert.title, {
            key: converting.property.key,
            type: t(($) => $.notes.kb.properties.types[converting.type]),
          })}
          description={
            converting.loss === "items"
              ? t(($) => $.notes.kb.properties.convert.list)
              : t(($) => $.notes.kb.properties.convert.value)
          }
          confirmLabel={t(($) => $.notes.kb.properties.convert.confirm)}
          onCancel={() => setConverting(null)}
          onConfirm={() => {
            setConverting(null);
            applyType(converting.property, converting.type);
          }}
        />
      )}
    </section>
  );
}
