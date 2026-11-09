import { Calendar, CheckSquare, ChevronDown, Hash, Link2, List, Plus, Text, Trash2, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readString, writeString } from "@/lib/local-storage";
import { cn } from "@/lib/utils";
import { NoteChip } from "./note-icons";
import { noteLinkHref, parseNoteLink } from "./note-link-format";
import type { LinkableNote } from "./note-links";
import {
  canAddProperty,
  convertValue,
  emptyValue,
  LIST_KEYS,
  PROPERTY_TYPES,
  readProperties,
  readPropertyTypes,
  removeProperty,
  renameProperty,
  savePropertyType,
  setProperty,
  type NoteProperty,
  type PropertyType,
  type PropertyValue,
} from "./note-properties";

const OPEN_KEY = "oleafly.notes.propertiesOpen";
const TYPE_ICONS: Readonly<Record<PropertyType, LucideIcon>> = {
  text: Text,
  list: List,
  number: Hash,
  checkbox: CheckSquare,
  date: Calendar,
  link: Link2,
};
const FIELD =
  "min-w-0 rounded-md border-0 bg-transparent px-1.5 py-1 text-sm transition-colors placeholder:text-muted-foreground/60 hover:bg-accent/50 focus:bg-accent/70 motion-reduce:transition-none";

export type FrontMatterUpdate = (update: (text: string) => string) => void;

interface NotePropertiesProps {
  frontMatter: string;
  onChange: FrontMatterUpdate;
  notes?: readonly LinkableNote[] | null;
  onOpenNote?: (note: LinkableNote) => void;
  onEditSource?: () => void;
  editable?: boolean;
}

function readOpen(): boolean {
  return readString(OPEN_KEY) !== "false";
}

function saveOpen(open: boolean): void {
  writeString(OPEN_KEY, String(open));
}

function TextField({
  value,
  label,
  type = "text",
  disabled,
  onCommit,
}: Readonly<{ value: string; label: string; type?: "text" | "number" | "date"; disabled?: boolean; onCommit: (value: string) => void }>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      type={type}
      aria-label={label}
      value={draft}
      disabled={disabled}
      inputMode={type === "number" ? "decimal" : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isImeEnter(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") setDraft(value);
      }}
      className={cn(FIELD, "w-full")}
    />
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
    const next = draft
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item && !items.includes(item));
    setDraft("");
    if (next.length > 0) onCommit([...items, ...next]);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeEnter(event)) return;
    if (event.key === "Enter" || event.key === ",") {
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
        <input
          aria-label={label}
          value={draft}
          placeholder={items.length === 0 ? t(($) => $.notes.kb.properties.addItem) : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          className={cn(FIELD, "w-24 flex-1 py-0.5 text-xs")}
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
        <button
          type="button"
          onClick={() => onOpen(linked)}
          aria-label={t(($) => $.notes.kb.properties.openNote, { title: linked.title })}
          className={cn(FIELD, "flex items-center gap-1.5 text-primary")}
        >
          <NoteChip icon={linked.icon} color={linked.color} className="size-4 rounded" />
          <span className="truncate">{linked.title}</span>
        </button>
      ) : (
        value && <span className="truncate px-1.5 text-sm text-muted-foreground">{linked?.title ?? t(($) => $.notes.links.missingNote)}</span>
      )}
      {!disabled && (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={label} className={cn(FIELD, "text-muted-foreground")}>
            {value ? t(($) => $.notes.kb.properties.changeNote) : t(($) => $.notes.kb.properties.chooseNote)}
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
      return <TextField type="date" label={label} value={typeof value === "string" ? value : ""} disabled={disabled} onCommit={(text) => onCommit(text || null)} />;
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
}: Readonly<{ property: NoteProperty; disabled: boolean; onType: (type: PropertyType) => void; onRemove: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const Icon = TYPE_ICONS[property.type];
  const typeLabel = t(($) => $.notes.kb.properties.types[property.type]);
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
        aria-label={t(($) => $.notes.kb.properties.type, { key: property.key, type: typeLabel })}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent motion-reduce:transition-none"
      >
        <Icon aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {!LIST_KEYS.has(property.key) && !property.readOnly && (
          <>
            <DropdownMenuRadioGroup value={property.type} onValueChange={(type) => onType(type as PropertyType)}>
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
        <DropdownMenuItem onSelect={onRemove} className="gap-2 text-xs text-destructive">
          <Trash2 aria-hidden className="size-3.5" />
          {t(($) => $.notes.kb.properties.remove)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KeyField({ name, disabled, onRename }: Readonly<{ name: string; disabled: boolean; onRename: (name: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <TextField label={t(($) => $.notes.kb.properties.name, { key: name })} value={name} disabled={disabled} onCommit={(next) => onRename(next)} />
  );
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
      <input
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
        className={cn(FIELD, "w-48")}
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
  const [known, setKnown] = useState(readPropertyTypes);
  const properties = useMemo(() => readProperties(frontMatter, known), [frontMatter, known]);
  const [open, setOpen] = useState(readOpen);
  const [adding, setAdding] = useState(false);
  const list = properties ?? [];
  const linkable = notes ?? [];

  const write = (update: (text: string) => string) => onChange(update);
  const commit = (key: string, value: PropertyValue) => write((text) => setProperty(text, key, value));
  const changeType = (property: NoteProperty, type: PropertyType) => {
    savePropertyType(property.key, type);
    setKnown(readPropertyTypes());
    commit(property.key, convertValue(property.value, type));
  };
  const add = (key: string) => {
    setAdding(false);
    setOpen(true);
    saveOpen(true);
    write((text) => setProperty(text, key, emptyValue(known[key] ?? "text")));
  };
  const toggle = () => {
    setOpen((current) => {
      saveOpen(!current);
      return !current;
    });
  };
  const startAdding = () => {
    setAdding(true);
    if (open) return;
    setOpen(true);
    saveOpen(true);
  };

  if (properties === null) {
    if (!frontMatter.trim()) return null;
    return (
      <div data-properties-invalid className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs text-muted-foreground">{t(($) => $.notes.kb.properties.invalid)}</p>
        {onEditSource && (
          <Button type="button" variant="outline" size="xs" onClick={onEditSource}>
            {t(($) => $.notes.kb.properties.editSource)}
          </Button>
        )}
      </div>
    );
  }
  if (list.length === 0 && !adding) {
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
    <section aria-label={t(($) => $.notes.kb.properties.title)} className="note-properties mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="-ml-1.5 flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent motion-reduce:transition-none"
      >
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
        {t(($) => $.notes.kb.properties.title)}
        <span className="tabular-nums">{list.length}</span>
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {list.map((property) => (
            <li key={property.key} data-property={property.key} className="grid grid-cols-[minmax(7rem,11rem)_1fr] items-start gap-1">
              <div className="flex min-w-0 items-center">
                <TypeMenu
                  property={property}
                  disabled={!editable}
                  onType={(type) => changeType(property, type)}
                  onRemove={() => write((text) => removeProperty(text, property.key))}
                />
                <KeyField name={property.key} disabled={!editable} onRename={(name) => write((text) => renameProperty(text, property.key, name))} />
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
    </section>
  );
}
