import { normalizeText } from "@oleafly/search-query";
import { Extension, type AnyExtension } from "@tiptap/core";
import { PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { i18n } from "@/i18n";
import { addDays, weekdayName } from "@/lib/notes-periodic";
import { DATE_KEY, DUE_KEY, fieldKey, fieldKeyLabel, isDateKey, isoDate, newField, PRIORITY_KEY, priorityLabel, SCHEDULED_KEY, validFieldKey, type Priority } from "./note-field-values";
import { candidateHref, candidateText, linkCandidates, type LinkableNote, type LinkCandidate } from "./note-links";
import { sendSuggestMeta, suggestionKey, suggestPlugin, type SuggestRange, type SuggestState } from "./note-suggest-plugin";
import { tagKey } from "./note-tags";
import { localDate } from "./note-templates";

export interface NoteAtOptions {
  getTags: () => readonly string[];
  getNotes: () => readonly LinkableNote[] | null;
  getCurrentNoteId?: () => string | null | undefined;
  subscribe?: (listener: () => void) => () => void;
  now?: () => Date;
}

export type AtGroup = "dates" | "fields" | "values" | "tags" | "notes";

export type AtAction =
  | { type: "date"; date: string }
  | { type: "pick" }
  | { type: "enter"; key: string; select?: boolean }
  | { type: "field"; key: string; value: string }
  | { type: "tag"; tag: string }
  | { type: "note"; candidate: Exclude<LinkCandidate, { kind: "create" }> };

export type AtIcon = "calendar" | "calendarPick" | "due" | "scheduled" | "priority" | "field" | "tag" | "note";

export interface AtItem {
  id: string;
  group: AtGroup;
  label: string;
  detail?: string;
  icon: AtIcon;
  priority?: Priority;
  action: AtAction;
  keywords: readonly string[];
}

export interface AtSuggestion {
  menuId: string;
  from: number;
  to: number;
  query: string;
  index: number;
  key: string;
  inField: boolean;
  hint: string | null;
  items: readonly AtItem[];
}

export interface AtPickRequest {
  from: number;
  to: number;
  key: string;
}

interface AtPluginSpec {
  noteAt: NoteAtOptions;
  menuId: string;
}

const HIDDEN = "￼";
const TRIGGER = /(?:^|[\s(])@([^\n@[\]()]{0,48})$/u;
const FIELD_QUERY = /^([^:]+?)::\s?(.*)$/u;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const SHOWN_EMPTY = { tags: 3, notes: 3 };
const SHOWN_MATCHED = { tags: 5, notes: 5 };
const PRIORITY_CHOICES: readonly Priority[] = ["high", "medium", "low"];
const atKey = new PluginKey<SuggestState<SuggestRange>>("noteAt");
const pickers = new WeakMap<EditorView, (request: AtPickRequest) => void>();
let menuCount = 0;

function triggerAt(state: EditorState): Omit<SuggestRange, "index"> | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.spec.code || mark.type.name === "link")) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 64), $from.parentOffset, undefined, HIDDEN);
  const match = TRIGGER.exec(before);
  if (!match) return null;
  const query = match[1];
  if (/^\s|\s{2}/u.test(query)) return null;
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

function inTask(state: EditorState, from: number): boolean {
  const $from = state.doc.resolve(from);
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "taskItem") return node.attrs.task === true;
  }
  return false;
}

function words(query: string): string[] {
  return normalizeText(query).split(/\s+/u).filter(Boolean);
}

function matches(item: AtItem, needle: readonly string[]): boolean {
  if (needle.length === 0) return true;
  const haystack = [item.label, ...item.keywords].map((text) => normalizeText(text));
  return needle.every((word) => haystack.some((text) => text.includes(word)));
}

function shortDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function nextWeekday(now: Date, day: number): Date {
  const ahead = (day - now.getDay() + 7) % 7 || 7;
  return addDays(now, ahead);
}

function dateItem(id: string, label: string, date: Date, locale: string, keywords: readonly string[]): AtItem {
  return { id, group: "dates", label, detail: shortDate(date, locale), icon: "calendar", action: { type: "date", date: localDate(date) }, keywords };
}

export function dateItems(query: string, now: Date, locale: string): AtItem[] {
  const needle = words(query);
  const typed = isoDate(query);
  const t = i18n.t.bind(i18n);
  const relative = [
    dateItem("today", t(($) => $.notes.at.today), now, locale, ["today", "now"]),
    dateItem("tomorrow", t(($) => $.notes.at.tomorrow), addDays(now, 1), locale, ["tomorrow"]),
    dateItem("yesterday", t(($) => $.notes.at.yesterday), addDays(now, -1), locale, ["yesterday"]),
  ];
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const name = weekdayName(day, locale);
    return dateItem(`next-${WEEKDAYS[day]}`, t(($) => $.notes.at.next, { weekday: name }), nextWeekday(now, day), locale, ["next", WEEKDAYS[day], name]);
  });
  const pick: AtItem = {
    id: "pick",
    group: "dates",
    label: t(($) => $.notes.at.pick),
    icon: "calendarPick",
    action: { type: "pick" },
    keywords: ["date", "pick", "calendar", "choose"],
  };
  if (needle.length === 0) return [...relative, weekdays[0], pick];
  const found = [...relative, ...weekdays, pick].filter((item) => matches(item, needle));
  return typed ? [dateItem(`iso-${localDate(typed)}`, localDate(typed), typed, locale, []), ...found] : found;
}

function fieldItems(query: string): AtItem[] {
  const t = i18n.t.bind(i18n);
  const needle = words(query);
  const fields: AtItem[] = [
    { id: "due", group: "fields", label: t(($) => $.notes.at.due), icon: "due", action: { type: "enter", key: DUE_KEY }, keywords: ["due", "deadline", "date"] },
    { id: "scheduled", group: "fields", label: t(($) => $.notes.at.scheduled), icon: "scheduled", action: { type: "enter", key: SCHEDULED_KEY }, keywords: ["scheduled", "plan", "date"] },
    { id: "priority", group: "fields", label: t(($) => $.notes.at.priority), icon: "priority", action: { type: "enter", key: PRIORITY_KEY }, keywords: ["priority", "important"] },
  ];
  const custom: AtItem = { id: "custom", group: "fields", label: t(($) => $.notes.at.custom), icon: "field", action: { type: "enter", key: "field", select: true }, keywords: ["custom", "field", "property"] };
  if (needle.length === 0) return [...fields, custom];
  const priorities = PRIORITY_CHOICES.map(
    (priority): AtItem => ({
      id: `priority-${priority}`,
      group: "fields",
      label: t(($) => $.notes.at.priorityValue, { priority: priorityLabel(priority) }),
      icon: "priority",
      priority,
      action: { type: "field", key: PRIORITY_KEY, value: priority },
      keywords: ["priority", priority, priorityLabel(priority)],
    }),
  );
  return [...fields, ...priorities, custom].filter((item) => matches(item, needle));
}

function addFieldItem(query: string): AtItem[] {
  const key = query.trim();
  if (!key || /\s/u.test(key) || [DUE_KEY, SCHEDULED_KEY, PRIORITY_KEY, "field"].includes(fieldKey(key)) || !validFieldKey(key)) return [];
  return [{ id: `add-${fieldKey(key)}`, group: "fields", label: i18n.t(($) => $.notes.at.addField, { key }), icon: "field", action: { type: "enter", key }, keywords: [key] }];
}

function tagItems(tags: readonly string[], query: string): AtItem[] {
  const needle = tagKey(query.trim());
  if (/\s/u.test(needle)) return [];
  const seen = new Set<string>();
  const found: AtItem[] = [];
  const limit = needle ? SHOWN_MATCHED.tags : SHOWN_EMPTY.tags;
  for (const tag of tags) {
    const key = tagKey(tag);
    if (seen.has(key) || !key.includes(needle)) continue;
    seen.add(key);
    found.push({ id: `tag-${key}`, group: "tags", label: tag, icon: "tag", action: { type: "tag", tag }, keywords: [] });
  }
  found.sort((left, right) => Number(!tagKey(left.label).startsWith(needle)) - Number(!tagKey(right.label).startsWith(needle)));
  return found.slice(0, limit);
}

function noteItems(notes: readonly LinkableNote[] | null, query: string, current: string | null | undefined): AtItem[] {
  if (!notes) return [];
  const limit = query.trim() ? SHOWN_MATCHED.notes : SHOWN_EMPTY.notes;
  const others = current ? notes.filter((note) => note.noteId !== current) : notes;
  return linkCandidates(others, [], query.trim(), null)
    .slice(0, limit)
    .flatMap((candidate): AtItem[] =>
      candidate.kind === "note" ? [{ id: `note-${candidate.id}`, group: "notes", label: candidate.title || candidate.id, icon: "note", action: { type: "note", candidate }, keywords: [] }] : [],
    );
}

function valueItems(key: string, value: string, now: Date, locale: string): { items: AtItem[]; hint: string | null } {
  const t = i18n.t.bind(i18n);
  const canonical = fieldKey(key);
  if (canonical === PRIORITY_KEY) {
    const needle = words(value);
    const items = PRIORITY_CHOICES.map(
      (priority): AtItem => ({
        id: `value-${priority}`,
        group: "values",
        label: priorityLabel(priority),
        icon: "priority",
        priority,
        action: { type: "field", key, value: priority },
        keywords: [priority],
      }),
    ).filter((item) => matches(item, needle));
    return { items, hint: null };
  }
  const dates = isDateKey(key) || !value.trim() ? dateItems(value, now, locale).map((item) => ({ ...item, group: "values" as const })) : [];
  const set: AtItem[] =
    value.trim() && !isDateKey(key)
      ? [{ id: "value-set", group: "values", label: t(($) => $.notes.at.setField, { key: fieldKeyLabel(key), value: value.trim() }), icon: "field", action: { type: "field", key, value: value.trim() }, keywords: [] }]
      : [];
  const items = [...set, ...dates];
  return { items, hint: items.length === 0 || (!isDateKey(key) && !value.trim()) ? t(($) => $.notes.at.typeValue, { key: fieldKeyLabel(key) }) : null };
}

function specOf(state: EditorState): AtPluginSpec | null {
  const plugin = atKey.get(state);
  return plugin ? (plugin.spec as unknown as AtPluginSpec) : null;
}

interface CachedSuggestion {
  tags: readonly string[];
  notes: readonly LinkableNote[] | null;
  suggestion: AtSuggestion | null;
}

const suggestions = new WeakMap<EditorState, CachedSuggestion>();

export function atSuggestion(state: EditorState): AtSuggestion | null {
  const spec = specOf(state);
  const suggest = atKey.getState(state)?.suggest;
  if (!spec || !suggest) return null;
  const tags = spec.noteAt.getTags();
  const notes = spec.noteAt.getNotes();
  const cached = suggestions.get(state);
  if (cached?.tags === tags && cached.notes === notes) return cached.suggestion;
  const suggestion = buildSuggestion(state, spec, suggest, tags, notes);
  suggestions.set(state, { tags, notes, suggestion });
  return suggestion;
}

function buildSuggestion(state: EditorState, spec: AtPluginSpec, suggest: SuggestRange, tags: readonly string[], notes: readonly LinkableNote[] | null): AtSuggestion | null {
  const options = spec.noteAt;
  const now = options.now?.() ?? new Date();
  const locale = i18n.language;
  const field = FIELD_QUERY.exec(suggest.query);
  const base = { ...suggest, menuId: spec.menuId };
  if (field && validFieldKey(field[1])) {
    const key = field[1].trim();
    const { items, hint } = valueItems(key, field[2], now, locale);
    return { ...base, key, inField: true, hint, items, index: Math.min(suggest.index, Math.max(0, items.length - 1)) };
  }
  if (suggest.query.includes(":")) return null;
  const items = [
    ...dateItems(suggest.query, now, locale),
    ...fieldItems(suggest.query),
    ...tagItems(tags, suggest.query),
    ...noteItems(notes, suggest.query, options.getCurrentNoteId?.()),
    ...addFieldItem(suggest.query),
  ];
  if (items.length === 0) return null;
  const key = inTask(state, suggest.from) ? DUE_KEY : DATE_KEY;
  return { ...base, key, inField: false, hint: null, items, index: Math.min(suggest.index, items.length - 1) };
}

export function highlightAt(view: EditorView, index: number): void {
  sendSuggestMeta(view, atKey, { index });
}

export function closeAtMenu(view: EditorView): void {
  sendSuggestMeta(view, atKey, { dismiss: true });
}

export function setAtPicker(view: EditorView, picker: ((request: AtPickRequest) => void) | null): void {
  if (picker) pickers.set(view, picker);
  else pickers.delete(view);
}

function spaceAfter(state: EditorState, to: number): boolean {
  const end = state.doc.resolve(to).end();
  return /^\s/u.test(state.doc.textBetween(to, Math.min(to + 1, end), undefined, HIDDEN));
}

export function insertAtField(view: EditorView, range: { from: number; to: number }, key: string, value: string): boolean {
  const { state } = view;
  const type = state.schema.nodes.noteField;
  if (!type) return false;
  const nodes = [type.create(newField(key, value))];
  if (!spaceAfter(state, range.to)) nodes.push(state.schema.text(" "));
  const tr = state.tr.replaceWith(range.from, range.to, nodes);
  tr.setSelection(TextSelection.create(tr.doc, range.from + 2));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function insertText(view: EditorView, range: { from: number; to: number }, text: string, select?: { from: number; to: number }): boolean {
  const tr = view.state.tr.insertText(text, range.from, range.to);
  const anchor = select ? range.from + select.from : range.from + text.length;
  const head = select ? range.from + select.to : anchor;
  tr.setSelection(TextSelection.create(tr.doc, anchor, head));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function insertLink(view: EditorView, range: { from: number; to: number }, candidate: Exclude<LinkCandidate, { kind: "create" }>): boolean {
  const { state } = view;
  const link = state.schema.marks.link;
  if (!link) return false;
  const text = candidateText(candidate, null);
  const nodes = [state.schema.text(text, [link.create({ href: candidateHref(candidate) })])];
  if (!spaceAfter(state, range.to)) nodes.push(state.schema.text(" "));
  const tr = state.tr.replaceWith(range.from, range.to, nodes);
  tr.setSelection(TextSelection.create(tr.doc, range.from + text.length + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export function chooseAt(view: EditorView, index: number): boolean {
  const suggestion = atSuggestion(view.state);
  const item = suggestion?.items[index];
  if (!suggestion || !item) return false;
  const range = { from: suggestion.from, to: suggestion.to };
  const { action } = item;
  switch (action.type) {
    case "date":
      return insertAtField(view, range, suggestion.key, action.date);
    case "field":
      return insertAtField(view, range, action.key, action.value);
    case "pick": {
      const picker = pickers.get(view);
      if (!picker) return false;
      closeAtMenu(view);
      picker({ ...range, key: suggestion.key });
      return true;
    }
    case "enter":
      return action.select ? insertText(view, range, `@${action.key}`, { from: 1, to: 1 + action.key.length }) : insertText(view, range, `@${action.key}:: `);
    case "tag":
      return insertText(view, range, spaceAfter(view.state, range.to) ? `#${action.tag}` : `#${action.tag} `);
    case "note":
      return insertLink(view, range, action.candidate);
  }
}

function handleKey(view: EditorView, event: KeyboardEvent): boolean {
  const suggestion = atSuggestion(view.state);
  return suggestionKey(
    event,
    suggestion && {
      count: suggestion.items.length,
      index: suggestion.index,
      close: () => closeAtMenu(view),
      highlight: (index) => highlightAt(view, index),
      choose: () => chooseAt(view, suggestion.index),
    },
  );
}

function atPlugin(options: NoteAtOptions) {
  const menuId = `note-at-menu-${++menuCount}`;
  const spec: AtPluginSpec = { noteAt: options, menuId };
  return suggestPlugin<SuggestRange>({
    key: atKey,
    menuId,
    spec,
    trigger: triggerAt,
    options: (state) => {
      const suggestion = atSuggestion(state);
      return suggestion ? { index: suggestion.index, count: suggestion.items.length } : null;
    },
    handleKeyDown: handleKey,
    subscribe: options.subscribe,
  });
}

export function noteAtExtensions(options: NoteAtOptions): AnyExtension[] {
  return [
    Extension.create<NoteAtOptions>({
      name: "noteAt",
      priority: 995,
      addOptions: () => options,
      addProseMirrorPlugins() {
        return [atPlugin(this.options)];
      },
    }),
  ];
}
