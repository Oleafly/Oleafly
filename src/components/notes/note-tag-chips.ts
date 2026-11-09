import { Extension, type AnyExtension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, type DecorationSet, type EditorView } from "@tiptap/pm/view";
import { i18n } from "@/i18n";
import { sendSuggestMeta, suggestionKey, suggestOptionId, suggestPlugin, type SuggestState } from "./note-suggest-plugin";
import { plainTextTags, tagKey } from "./note-tags";

export interface NoteTagOptions {
  getTags: () => readonly string[];
  getOpenTag: () => ((tag: string) => void) | null | undefined;
  subscribe?: (listener: () => void) => () => void;
}

export interface TagSuggestion {
  menuId: string;
  from: number;
  to: number;
  query: string;
  index: number;
  items: readonly string[];
}

interface SuggestRange {
  from: number;
  to: number;
  query: string;
  index: number;
}

interface TagRange {
  from: number;
  to: number;
  tag: string;
}

interface TagPluginSpec {
  noteTags: NoteTagOptions;
  menuId: string;
}

export const TAG_LIMIT = 8;
const HIDDEN = "￼";
const TRIGGER = /(?:^|[\s(])#([\p{L}\p{N}_\-/]{1,48})$/u;
const tagPluginKey = new PluginKey<SuggestState<SuggestRange>>("noteTags");
let menuCount = 0;

function hiddenFor(node: ProseMirrorNode): boolean {
  return node.marks.some((mark) => mark.type.spec.code || mark.type.name === "link");
}

export function textblockText(block: ProseMirrorNode): string {
  let text = "";
  block.forEach((child) => {
    if (child.isText && !hiddenFor(child)) text += child.text ?? "";
    else text += HIDDEN.repeat(child.isText ? (child.text ?? "").length : child.nodeSize);
  });
  return text;
}

function blockTags(block: ProseMirrorNode, pos: number): TagRange[] {
  if (block.type.spec.code) return [];
  return plainTextTags(textblockText(block)).map((range) => ({ from: pos + 1 + range.from, to: pos + 1 + range.to, tag: range.tag }));
}

type Chip = (range: TagRange) => Decoration;

function chipMaker(options: NoteTagOptions): Chip {
  const open = Boolean(options.getOpenTag());
  const label = i18n.t(($) => $.notes.kb.tags.open);
  return ({ from, to, tag }) =>
    Decoration.inline(
      from,
      to,
      open ? { class: "note-tag", "data-tag": tag, "data-tooltip": label } : { class: "note-tag", "data-tag": tag },
      { tag },
    );
}

function rangesOf(decorations: DecorationSet): TagRange[] {
  return decorations
    .find()
    .map((decoration) => ({ from: decoration.from, to: decoration.to, tag: String((decoration.spec as { tag?: unknown }).tag) }))
    .sort((left, right) => left.from - right.from);
}

export function tagCandidates(tags: readonly string[], query: string, limit = TAG_LIMIT): string[] {
  const needle = tagKey(query);
  const seen = new Set<string>();
  const scored: { tag: string; rank: number; order: number }[] = [];
  tags.forEach((tag, order) => {
    const key = tagKey(tag);
    if (seen.has(key)) return;
    seen.add(key);
    const at = key.indexOf(needle);
    if (at < 0) return;
    scored.push({ tag, rank: at === 0 ? 0 : 1, order });
  });
  scored.sort((left, right) => left.rank - right.rank || left.order - right.order);
  const items = scored.slice(0, limit).map((entry) => entry.tag);
  return items.length === 1 && tagKey(items[0]) === needle ? [] : items;
}

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
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

function specOf(state: EditorState): TagPluginSpec | null {
  const plugin = tagPluginKey.get(state);
  return plugin ? (plugin.spec as unknown as TagPluginSpec) : null;
}

const suggestions = new WeakMap<EditorState, { tags: readonly string[]; suggestion: TagSuggestion | null }>();

export function tagSuggestion(state: EditorState): TagSuggestion | null {
  const spec = specOf(state);
  const plugin = tagPluginKey.getState(state);
  const suggest = plugin?.suggest;
  if (!spec || !plugin || !suggest) return null;
  const tags = spec.noteTags.getTags();
  const cached = suggestions.get(state);
  if (cached?.tags === tags) return cached.suggestion;
  const local = rangesOf(plugin.decorations).filter((range) => range.to !== suggest.to).map((range) => range.tag);
  const items = tagCandidates([...tags, ...local], suggest.query);
  const suggestion = items.length === 0 ? null : { ...suggest, menuId: spec.menuId, index: Math.min(suggest.index, items.length - 1), items };
  suggestions.set(state, { tags, suggestion });
  return suggestion;
}

export const tagOptionId = suggestOptionId;

export function highlightTag(view: EditorView, index: number): void {
  sendSuggestMeta(view, tagPluginKey, { index });
}

export function closeTagMenu(view: EditorView): void {
  sendSuggestMeta(view, tagPluginKey, { dismiss: true });
}

export function insertTag(view: EditorView, index: number): boolean {
  const suggestion = tagSuggestion(view.state);
  const tag = suggestion?.items[index];
  if (!suggestion || tag === undefined) return false;
  const { state } = view;
  const following = state.doc.textBetween(suggestion.to, Math.min(suggestion.to + 1, state.doc.resolve(suggestion.to).end()), undefined, HIDDEN);
  const text = `#${tag}${/^\s/u.test(following) ? "" : " "}`;
  const tr = state.tr.insertText(text, suggestion.from, suggestion.to);
  tr.setSelection(TextSelection.create(tr.doc, suggestion.from + tag.length + 2));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function handleKey(view: EditorView, event: KeyboardEvent): boolean {
  const suggestion = tagSuggestion(view.state);
  return suggestionKey(
    event,
    suggestion && {
      count: suggestion.items.length,
      index: suggestion.index,
      close: () => closeTagMenu(view),
      highlight: (index) => highlightTag(view, index),
      choose: (key) => (key.key === "Enter" && key.shiftKey ? false : insertTag(view, suggestion.index)),
    },
  );
}

function openClicked(event: MouseEvent, options: NoteTagOptions): boolean {
  const open = options.getOpenTag();
  if (!open || event.button !== 0 || !(event.target instanceof Element)) return false;
  const chip = event.target.closest<HTMLElement>(".note-tag[data-tag]");
  const tag = chip?.dataset.tag;
  if (!tag) return false;
  open(tag);
  return false;
}

function tagPlugin(options: NoteTagOptions) {
  const menuId = `note-tag-menu-${++menuCount}`;
  const spec: TagPluginSpec = { noteTags: options, menuId };
  return suggestPlugin<SuggestRange>({
    key: tagPluginKey,
    menuId,
    spec,
    decorator: () => {
      const chip = chipMaker(options);
      return (block, pos) => blockTags(block, pos).map(chip);
    },
    trigger: triggerAt,
    options: (state) => {
      const suggestion = tagSuggestion(state);
      return suggestion ? { index: suggestion.index, count: suggestion.items.length } : null;
    },
    handleKeyDown: handleKey,
    click: (_view, event) => openClicked(event, options),
    subscribe: options.subscribe,
  });
}

export function noteTagExtensions(options: NoteTagOptions): AnyExtension[] {
  return [
    Extension.create<NoteTagOptions>({
      name: "noteTags",
      priority: 990,
      addOptions: () => options,
      addProseMirrorPlugins() {
        return [tagPlugin(this.options)];
      },
    }),
  ];
}
