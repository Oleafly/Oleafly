import { normalizeText } from "@oleafly/search-query";
import { Extension, type AnyExtension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, type EditorView } from "@tiptap/pm/view";
import type { CSSProperties } from "react";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/toast";
import { blockFragment, blockOfFragment, shortText, textOfFragment } from "./note-block-ids";
import {
  blockFlashPlugin,
  docBlocks,
  ensureDocBlockId,
  revealBlock,
  revealTextBlock,
  type NoteBlock,
  type NoteBlockKind,
} from "./note-block-links";
import { readNoteFacts } from "./note-file";
import { noteColorStyle } from "./note-icons";
import { isLinkableId, isSpaceOrTab, noteLinkHref, parseNoteLink, uniqueSlugs, type NoteHeading, type NoteLinkTarget } from "./note-link-format";
import { isSelectionModifier } from "@/store/library-selection";
import { sendSuggestMeta, suggestionKey, suggestPlugin, type SuggestState } from "./note-suggest-plugin";
import { projectStyle } from "./project-color";

export interface LinkableNote {
  noteId: string;
  projectId: string;
  title: string;
  color?: string;
  icon?: string;
  aliases?: readonly string[];
}

export interface LinkableProject {
  projectId: string;
  title: string;
  color: string | null;
}

export interface BlockChoice {
  id: string | null;
  kind: NoteBlockKind;
  text: string;
  at: number;
  trailing: boolean;
  live: boolean;
}

export type LinkCandidate =
  | { kind: "note"; id: string; projectId: string; title: string; color?: string; icon?: string; alias?: string }
  | { kind: "project"; id: string; title: string; color: string | null }
  | { kind: "heading"; id: string; projectId: string; title: string; heading: NoteHeading; self: boolean; color?: string; icon?: string }
  | { kind: "block"; id: string; projectId: string; title: string; block: BlockChoice; self: boolean; color?: string; icon?: string }
  | { kind: "create"; id: string; title: string };

type LinkTarget = Exclude<LinkCandidate, { kind: "create" }>;

export interface OpenNoteOptions {
  newTab: boolean;
  projectId: string;
  heading?: string;
}

export type OpenNoteHandler = (noteId: string | null, options: OpenNoteOptions) => void;
export type OpenProjectHandler = (projectId: string, options: { newTab: boolean }) => void;

export interface NoteLinkOptions {
  getNotes: () => readonly LinkableNote[] | null;
  getProjects: () => readonly LinkableProject[] | null;
  getHeadings?: (projectId: string) => readonly NoteHeading[] | null;
  getBlocks?: (projectId: string) => readonly BlockChoice[] | null;
  assignBlockId?: (projectId: string, block: BlockChoice) => Promise<string | null>;
  onOpenNote: OpenNoteHandler;
  onOpenProject: OpenProjectHandler;
  currentProjectId?: string | null;
  subscribe?: (listener: () => void) => () => void;
  createNote?: (title: string) => Promise<LinkableNote | null>;
}

export interface LinkQuery {
  name: string;
  heading: string | null;
  alias: string | null;
}

export interface NoteLinkSuggestion {
  menuId: string;
  from: number;
  to: number;
  query: string;
  index: number;
  embed: boolean;
  alias: string | null;
  headings: boolean;
  blocks: boolean;
  loading: boolean;
  items: readonly LinkCandidate[];
}

interface SuggestRange {
  from: number;
  to: number;
  query: string;
  index: number;
  embed: boolean;
}

interface LinkPluginSpec {
  noteLinks: NoteLinkOptions;
  menuId: string;
}

export interface DocHeading extends NoteHeading {
  pos: number;
}

export const NOTE_LIMIT = 6;
export const PROJECT_LIMIT = 4;
export const HEADING_LIMIT = 12;
export const BLOCK_LIMIT = 12;
const TRIGGER = /(!?)\[\[([^[\]\n￼]{0,80})$/u;
const LOOK_BEHIND = 96;
const linkKey = new PluginKey<SuggestState<SuggestRange>>("noteLinks");
const foldedNames = new WeakMap<object, readonly string[]>();
let menuCount = 0;

function namesOf(item: { title: string; aliases?: readonly string[] }): readonly string[] {
  let names = foldedNames.get(item);
  if (!names) {
    names = [item.title, ...(item.aliases ?? [])].map(normalizeText);
    foldedNames.set(item, names);
  }
  return names;
}

export function parseLinkQuery(query: string): LinkQuery {
  const bar = query.indexOf("|");
  const main = bar < 0 ? query : query.slice(0, bar);
  const alias = bar < 0 ? null : query.slice(bar + 1).trim();
  const hash = main.indexOf("#");
  return {
    name: (hash < 0 ? main : main.slice(0, hash)).trim(),
    heading: hash < 0 ? null : main.slice(hash + 1).trim(),
    alias: alias || null,
  };
}

function rankOf(names: readonly string[], needle: string): { rank: number; name: number } | null {
  let best: { rank: number; name: number } | null = null;
  names.forEach((name, index) => {
    const at = name.indexOf(needle);
    if (at < 0) return;
    const rank = (at === 0 ? 0 : 2) + (index === 0 ? 0 : 1);
    if (!best || rank < best.rank) best = { rank, name: index };
  });
  return best;
}

function ranked<T extends { title: string; aliases?: readonly string[] }>(
  items: readonly T[],
  needle: string,
  limit: number,
): { item: T; alias?: string }[] {
  const scored: { item: T; rank: number; order: number; alias?: string }[] = [];
  items.forEach((item, order) => {
    if (!needle) {
      scored.push({ item, rank: 0, order });
      return;
    }
    const best = rankOf(namesOf(item), needle);
    if (best) scored.push({ item, rank: best.rank, order, alias: best.name > 0 ? item.aliases?.[best.name - 1] : undefined });
  });
  scored.sort((left, right) => left.rank - right.rank || left.order - right.order);
  return scored.slice(0, limit).map(({ item, alias }) => ({ item, alias }));
}

function noteCandidate(note: LinkableNote, alias?: string): LinkCandidate {
  const candidate: LinkCandidate = {
    kind: "note",
    id: note.noteId,
    projectId: note.projectId,
    title: note.title,
    color: note.color,
    icon: note.icon,
  };
  if (alias) candidate.alias = alias;
  return candidate;
}

export function linkCandidates(
  notes: readonly LinkableNote[],
  projects: readonly LinkableProject[],
  query: string,
  currentProjectId?: string | null,
  embed = false,
): LinkCandidate[] {
  const needle = normalizeText(parseLinkQuery(query).name);
  const others = notes.filter((note) => note.projectId !== currentProjectId);
  const found = ranked(others, needle, NOTE_LIMIT).map(({ item, alias }) => noteCandidate(item, alias));
  if (embed) return found;
  return [
    ...found,
    ...ranked(projects, needle, PROJECT_LIMIT).map(
      ({ item }): LinkCandidate => ({ kind: "project", id: item.projectId, title: item.title, color: item.color }),
    ),
  ];
}

export function headingTarget(
  notes: readonly LinkableNote[],
  name: string,
  currentProjectId?: string | null,
): LinkableNote | null {
  if (!name) return notes.find((note) => note.projectId === currentProjectId) ?? null;
  const wanted = normalizeText(name);
  const exact = notes.find((note) => namesOf(note).includes(wanted));
  if (exact) return exact;
  const others = notes.filter((note) => note.projectId !== currentProjectId);
  return ranked(others, wanted, 1)[0]?.item ?? null;
}

export function docHeadings(doc: ProseMirrorNode): DocHeading[] {
  const found: { level: number; text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    found.push({ level: Number(node.attrs.level ?? 1), text: node.textContent.replaceAll(/\s+/gu, " ").trim(), pos });
    return false;
  });
  const slugs = uniqueSlugs(found.map((heading) => heading.text));
  return found.map((heading, index) => ({ ...heading, slug: slugs[index] })).filter((heading) => heading.text !== "");
}

export function headingCandidates(
  target: LinkableNote,
  headings: readonly NoteHeading[],
  query: string,
  self: boolean,
): LinkCandidate[] {
  const needle = normalizeText(query);
  return headings
    .filter((heading) => !needle || normalizeText(heading.text).includes(needle))
    .slice(0, HEADING_LIMIT)
    .map((heading) => ({
      kind: "heading",
      id: target.noteId,
      projectId: target.projectId,
      title: target.title,
      heading: { level: heading.level, text: heading.text, slug: heading.slug },
      self,
      color: target.color,
      icon: target.icon,
    }));
}

export function blockChoices(blocks: readonly NoteBlock[]): BlockChoice[] {
  return blocks.map((block) => ({ id: block.id, kind: block.kind, text: block.text, at: block.idLine, trailing: block.trailing, live: false }));
}

export function docBlockChoices(doc: ProseMirrorNode, skip = -1): BlockChoice[] {
  return docBlocks(doc)
    .filter((block) => skip < block.pos || skip >= block.pos + block.node.nodeSize)
    .map((block) => ({ id: block.id, kind: block.kind, text: block.text, at: block.pos, trailing: false, live: true }));
}

export function blockCandidates(target: LinkableNote, blocks: readonly BlockChoice[], query: string, self: boolean): LinkCandidate[] {
  const needle = normalizeText(query);
  return blocks
    .filter((block) => !needle || normalizeText(block.text).includes(needle) || block.id?.includes(needle) === true)
    .slice(0, BLOCK_LIMIT)
    .map((block) => ({
      kind: "block",
      id: target.noteId,
      projectId: target.projectId,
      title: target.title,
      block,
      self,
      color: target.color,
      icon: target.icon,
    }));
}

function triggerAt(state: EditorState): Omit<SuggestRange, "index"> | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.spec.code)) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - LOOK_BEHIND), $from.parentOffset, undefined, "￼");
  const match = TRIGGER.exec(before);
  if (!match) return null;
  return { from: $from.pos - match[0].length, to: $from.pos, query: match[2], embed: match[1] === "!" };
}

function hrefOf(node: ProseMirrorNode): string | null {
  const link = node.marks.find((mark) => mark.type.name === "link");
  return typeof link?.attrs.href === "string" ? link.attrs.href : null;
}

function cssText(style: CSSProperties | undefined): string {
  return Object.entries(style ?? {})
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join("; ");
}

function missing(attrs: Record<string, string>, label: string): Record<string, string> {
  return { ...attrs, class: `${attrs.class} note-link-missing`, "data-missing": "true", "data-tooltip": label };
}

function linkAttrs(
  target: NoteLinkTarget,
  start: boolean,
  notes: ReadonlyMap<string, LinkableNote> | null,
  projects: ReadonlyMap<string, LinkableProject> | null,
  creatable: boolean,
): Record<string, string> {
  const attrs: Record<string, string> = {
    class: start ? "note-link note-link-start" : "note-link",
    "data-note-link": target.kind,
  };
  if (target.heading) attrs["data-note-heading"] = target.heading;
  if (target.kind === "note") {
    if (!notes) return attrs;
    const note = notes.get(target.id);
    if (!note) return missing(attrs, creatable ? i18n.t(($) => $.notes.links.missingNoteCreate) : i18n.t(($) => $.notes.links.missingNote));
    return { ...attrs, "data-note-id": target.id, style: cssText(noteColorStyle(note.color)) };
  }
  if (!projects) return attrs;
  const project = projects.get(target.id);
  if (!project) return missing(attrs, i18n.t(($) => $.notes.links.missingProject));
  return { ...attrs, style: cssText(projectStyle(project.color)), "data-project-color": project.color ?? "none" };
}

interface LinkIndexes {
  notes: ReadonlyMap<string, LinkableNote> | null;
  projects: ReadonlyMap<string, LinkableProject> | null;
  creatable: boolean;
}

const noteIndexes = new WeakMap<readonly LinkableNote[], ReadonlyMap<string, LinkableNote>>();
const projectIndexes = new WeakMap<readonly LinkableProject[], ReadonlyMap<string, LinkableProject>>();

function indexed<T, K extends object>(cache: WeakMap<K, ReadonlyMap<string, T>>, list: K, build: () => Map<string, T>): ReadonlyMap<string, T> {
  let found = cache.get(list);
  if (!found) {
    found = build();
    cache.set(list, found);
  }
  return found;
}

function linkIndexes(options: NoteLinkOptions, editable: boolean): LinkIndexes {
  const notes = options.getNotes();
  const projects = options.getProjects();
  return {
    notes: notes ? indexed(noteIndexes, notes, () => new Map(notes.map((note) => [note.noteId, note]))) : null,
    projects: projects ? indexed(projectIndexes, projects, () => new Map(projects.map((project) => [project.projectId, project]))) : null,
    creatable: editable && options.createNote !== undefined,
  };
}

function blockDecorations(block: ProseMirrorNode, blockPos: number, indexes: LinkIndexes): Decoration[] {
  const found: Decoration[] = [];
  let lastHref: string | null = null;
  let lastEnd = -1;
  block.descendants((node, offset) => {
    if (!node.isText) return;
    const href = hrefOf(node);
    const target = parseNoteLink(href);
    if (!target) return;
    const pos = blockPos + 1 + offset;
    const end = pos + node.nodeSize;
    const start = href !== lastHref || pos !== lastEnd;
    lastHref = href;
    lastEnd = end;
    found.push(Decoration.inline(pos, end, linkAttrs(target, start, indexes.notes, indexes.projects, indexes.creatable)));
  });
  return found;
}

function specOf(state: EditorState): LinkPluginSpec | null {
  const plugin = linkKey.get(state);
  return plugin ? (plugin.spec as unknown as LinkPluginSpec) : null;
}

function headingItems(state: EditorState, options: NoteLinkOptions, query: LinkQuery): { items: LinkCandidate[]; loading: boolean } {
  const notes = options.getNotes() ?? [];
  const target = headingTarget(notes, query.name, options.currentProjectId);
  if (!target) return { items: [], loading: options.getNotes() === null };
  const self = target.projectId === options.currentProjectId;
  if (query.heading?.startsWith("^")) {
    const blocks = self ? docBlockChoices(state.doc, state.selection.from) : (options.getBlocks?.(target.projectId) ?? null);
    if (!blocks) return { items: [], loading: true };
    return { items: blockCandidates(target, blocks, query.heading.slice(1), self), loading: false };
  }
  const headings = self ? docHeadings(state.doc) : (options.getHeadings?.(target.projectId) ?? null);
  if (!headings) return { items: [], loading: true };
  return { items: headingCandidates(target, headings, query.heading ?? "", self), loading: false };
}

export function linkedNoteCreator(
  create: (title: string) => Promise<string>,
  load: (projectId: string) => Promise<{ text: string }>,
): (title: string) => Promise<LinkableNote | null> {
  return async (title) => {
    try {
      const projectId = await create(title);
      const { id } = readNoteFacts((await load(projectId)).text);
      return isLinkableId(id) ? { noteId: id, projectId, title } : null;
    } catch (error) {
      notifyError("create a linked note", error, i18n.t(($) => $.notes.vault.switcher.createFailed));
      return null;
    }
  };
}

export function createCandidate(options: NoteLinkOptions, query: LinkQuery, embed: boolean): LinkCandidate | null {
  const notes = options.getNotes();
  if (!options.createNote || !notes || embed || query.heading !== null || query.name === "") return null;
  const wanted = normalizeText(query.name);
  const exists = notes.some((note) => namesOf(note).some((name) => name.trim() === wanted));
  return exists ? null : { kind: "create", id: query.name, title: query.name };
}

interface CachedSuggestion {
  notes: readonly LinkableNote[] | null;
  projects: readonly LinkableProject[] | null;
  suggestion: NoteLinkSuggestion | null;
}

const suggestions = new WeakMap<EditorState, CachedSuggestion>();

export function noteLinkSuggestion(state: EditorState): NoteLinkSuggestion | null {
  const spec = specOf(state);
  const suggest = linkKey.getState(state)?.suggest;
  if (!spec || !suggest) return null;
  const notes = spec.noteLinks.getNotes();
  const projects = spec.noteLinks.getProjects();
  const cached = suggestions.get(state);
  if (cached?.notes === notes && cached.projects === projects) return cached.suggestion;
  const suggestion = buildSuggestion(state, spec, suggest);
  suggestions.set(state, { notes, projects, suggestion });
  return suggestion;
}

function buildSuggestion(state: EditorState, spec: LinkPluginSpec, suggest: SuggestRange): NoteLinkSuggestion {
  const options = spec.noteLinks;
  const query = parseLinkQuery(suggest.query);
  const create = createCandidate(options, query, suggest.embed);
  const found =
    query.heading === null
      ? {
          items: [
            ...linkCandidates(options.getNotes() ?? [], options.getProjects() ?? [], suggest.query, options.currentProjectId, suggest.embed),
            ...(create ? [create] : []),
          ],
          loading: false,
        }
      : headingItems(state, options, query);
  return {
    ...suggest,
    menuId: spec.menuId,
    alias: query.alias,
    headings: query.heading !== null,
    blocks: query.heading?.startsWith("^") === true,
    loading: found.loading,
    index: Math.min(suggest.index, Math.max(0, found.items.length - 1)),
    items: found.items,
  };
}

export function highlightNoteLink(view: EditorView, index: number): void {
  sendSuggestMeta(view, linkKey, { index });
}

export function closeNoteLinkMenu(view: EditorView): void {
  sendSuggestMeta(view, linkKey, { dismiss: true });
}

export function candidateHref(candidate: LinkTarget, blockId?: string): string {
  if (candidate.kind === "heading") return noteLinkHref("note", candidate.id, candidate.heading.slug);
  if (candidate.kind === "block") return noteLinkHref("note", candidate.id, blockFragment(blockId ?? candidate.block.id ?? ""));
  return noteLinkHref(candidate.kind, candidate.id);
}

export function candidateText(candidate: LinkTarget, alias: string | null): string {
  if (alias) return alias;
  if (candidate.kind === "heading" || candidate.kind === "block") {
    const part = candidate.kind === "heading" ? candidate.heading.text : shortText(candidate.block.text) || blockFragment(candidate.block.id ?? "");
    return candidate.self ? part : `${candidate.title.trim() || candidate.id} > ${part}`;
  }
  return candidate.title.trim() || candidate.id;
}

export function canEmbed(candidate: LinkCandidate): boolean {
  return candidate.kind === "note" || ((candidate.kind === "heading" || candidate.kind === "block") && !candidate.self);
}

const creating = new WeakSet<EditorView>();

function createAndLink(view: EditorView, suggestion: NoteLinkSuggestion, title: string): boolean {
  const create = specOf(view.state)?.noteLinks.createNote;
  if (!create) return false;
  if (creating.has(view)) return true;
  creating.add(view);
  const { from, query } = suggestion;
  create(title)
    .then((note) => {
      const current = view.isDestroyed ? null : noteLinkSuggestion(view.state);
      if (note && current?.from === from && current.query === query) insertNoteLink(view, noteCandidate(note));
    })
    .catch(() => undefined)
    .finally(() => creating.delete(view));
  return true;
}

function blockIdFor(view: EditorView, candidate: Extract<LinkCandidate, { kind: "block" }>): string | null {
  if (candidate.block.id) return candidate.block.id;
  if (!candidate.self) return null;
  const block = docBlocks(view.state.doc).find((entry) => entry.pos === candidate.block.at);
  return block ? ensureDocBlockId(view, block) : null;
}

function assignAndLink(view: EditorView, suggestion: NoteLinkSuggestion, candidate: Extract<LinkCandidate, { kind: "block" }>, asEmbed?: boolean): boolean {
  const assign = specOf(view.state)?.noteLinks.assignBlockId;
  if (!assign) return false;
  if (creating.has(view)) return true;
  creating.add(view);
  const { from, query } = suggestion;
  assign(candidate.projectId, candidate.block)
    .then((id) => {
      const current = view.isDestroyed ? null : noteLinkSuggestion(view.state);
      if (id && current?.from === from && current.query === query) {
        insertNoteLink(view, { ...candidate, block: { ...candidate.block, id } }, asEmbed);
      }
    })
    .catch(() => undefined)
    .finally(() => creating.delete(view));
  return true;
}

function trailingSpaceCount(text: string): number {
  let start = text.length;
  while (start > 0 && isSpaceOrTab(text[start - 1])) start -= 1;
  return text.length - start;
}

export function insertNoteLink(view: EditorView, candidate: LinkCandidate, asEmbed?: boolean): boolean {
  const suggestion = noteLinkSuggestion(view.state);
  const link = view.state.schema.marks.link;
  if (!suggestion || !link) return false;
  if (candidate.kind === "create") return createAndLink(view, suggestion, candidate.title);
  let blockId: string | undefined;
  if (candidate.kind === "block") {
    const id = blockIdFor(view, candidate);
    if (!id) return assignAndLink(view, suggestion, candidate, asEmbed);
    blockId = id;
  }
  const { state } = view;
  const { from, to } = suggestion;
  const text = candidateText(candidate, suggestion.alias);
  const href = candidateHref(candidate, blockId);
  const embed = (asEmbed ?? suggestion.embed) && canEmbed(candidate) && state.schema.nodes.image !== undefined;
  if (embed) {
    const $from = state.doc.resolve(from);
    const lead = trailingSpaceCount($from.parent.textBetween(0, $from.parentOffset, undefined, "￼"));
    const tr = state.tr.replaceRangeWith(from - lead, to, state.schema.nodes.image.create({ src: href, alt: text }));
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return true;
  }
  const following = state.doc.textBetween(to, Math.min(to + 1, state.doc.resolve(to).end()), undefined, "￼");
  const nodes = [state.schema.text(text, [link.create({ href })])];
  if (!/^\s/u.test(following)) nodes.push(state.schema.text(" "));
  const tr = state.tr.replaceWith(from, to, nodes);
  tr.setSelection(TextSelection.create(tr.doc, from + text.length + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export function chooseNoteLink(view: EditorView, index: number, asEmbed?: boolean): boolean {
  const candidate = noteLinkSuggestion(view.state)?.items[index];
  return candidate ? insertNoteLink(view, candidate, asEmbed) : false;
}

export function scrollViewToHeading(view: EditorView, slug: string): boolean {
  const block = blockOfFragment(slug);
  if (block) return revealBlock(view, block);
  const text = textOfFragment(slug);
  if (text) return revealTextBlock(view, text);
  const heading = docHeadings(view.state.doc).find((candidate) => candidate.slug === slug);
  if (!heading) return false;
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, heading.pos + 1));
  view.dispatch(tr);
  const dom = view.nodeDOM(heading.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView?.({ block: "start" });
  return true;
}

function linkSpan(view: EditorView, anchor: Element, href: string): { from: number; to: number; text: string } | null {
  let pos: number;
  try {
    pos = view.posAtDOM(anchor, 0);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(pos);
  const start = $pos.start();
  let from = -1;
  let to = -1;
  let found: { from: number; to: number } | null = null;
  $pos.parent.forEach((child, offset) => {
    if (found) return;
    const childFrom = start + offset;
    if (hrefOf(child) === href) {
      if (from < 0) from = childFrom;
      to = childFrom + child.nodeSize;
      return;
    }
    if (from >= 0 && pos >= from && pos <= to) found = { from, to };
    from = -1;
  });
  if (!found && from >= 0 && pos >= from && pos <= to) found = { from, to };
  if (!found) return null;
  const span: { from: number; to: number } = found;
  return { ...span, text: view.state.doc.textBetween(span.from, span.to, " ").trim() };
}

function holdsLink(doc: ProseMirrorNode, span: { from: number; to: number; text: string }, href: string): boolean {
  if (span.to > doc.content.size) return false;
  let linked = true;
  doc.nodesBetween(span.from, span.to, (node) => {
    if (node.isText && hrefOf(node) !== href) linked = false;
  });
  return linked && doc.textBetween(span.from, span.to, " ").trim() === span.text;
}

function recreateMissing(view: EditorView, anchor: Element, href: string, options: NoteLinkOptions, newTab: boolean): void {
  const create = options.createNote;
  const link = view.state.schema.marks.link;
  const span = view.editable && create && link ? linkSpan(view, anchor, href) : null;
  if (!create || !link || !span || span.text === "" || creating.has(view)) return;
  creating.add(view);
  create(span.text)
    .then((note) => {
      if (!note || view.isDestroyed) return;
      if (holdsLink(view.state.doc, span, href)) {
        const next = noteLinkHref("note", note.noteId);
        view.dispatch(view.state.tr.removeMark(span.from, span.to, link).addMark(span.from, span.to, link.create({ href: next })));
      }
      options.onOpenNote(note.noteId, { newTab, projectId: note.projectId });
    })
    .catch(() => undefined)
    .finally(() => creating.delete(view));
}

function openNoteTarget(view: EditorView, anchor: Element, target: NoteLinkTarget, options: NoteLinkOptions, newTab: boolean): void {
  const notes = options.getNotes();
  const note = notes?.find((candidate) => candidate.noteId === target.id);
  if (!note) {
    if (notes) recreateMissing(view, anchor, anchor.getAttribute("href") ?? "", options, newTab);
    return;
  }
  if (target.heading && note.projectId === options.currentProjectId && !newTab) {
    scrollViewToHeading(view, target.heading);
    return;
  }
  const opened: OpenNoteOptions = { newTab, projectId: note.projectId };
  if (target.heading) opened.heading = target.heading;
  options.onOpenNote(target.id, opened);
}

function openClicked(view: EditorView, event: MouseEvent, options: NoteLinkOptions): boolean {
  if (event.button !== 0 || !(event.target instanceof Element)) return false;
  const anchor = event.target.closest("a");
  if (!anchor || !view.dom.contains(anchor)) return false;
  const target = parseNoteLink(anchor.getAttribute("href"));
  if (!target) return false;
  event.preventDefault();
  if (!view.state.selection.empty) return true;
  const newTab = isSelectionModifier(event);
  if (target.kind === "note") {
    openNoteTarget(view, anchor, target, options, newTab);
    return true;
  }
  const projects = options.getProjects();
  if (!projects || projects.some((project) => project.projectId === target.id)) {
    options.onOpenProject(target.id, { newTab });
  }
  return true;
}

function handleKey(view: EditorView, event: KeyboardEvent): boolean {
  const suggestion = noteLinkSuggestion(view.state);
  return suggestionKey(
    event,
    suggestion && {
      count: suggestion.items.length,
      index: suggestion.index,
      close: () => closeNoteLinkMenu(view),
      highlight: (index) => highlightNoteLink(view, index),
      choose: (key) =>
        insertNoteLink(view, suggestion.items[suggestion.index], key.key === "Enter" && key.shiftKey ? true : undefined),
    },
  );
}

function linkPlugin(options: NoteLinkOptions) {
  const menuId = `note-link-menu-${++menuCount}`;
  const spec: LinkPluginSpec = { noteLinks: options, menuId };
  let editable = true;
  return suggestPlugin<SuggestRange>({
    key: linkKey,
    menuId,
    spec,
    decorator: () => {
      const indexes = linkIndexes(options, editable);
      return (block, pos) => blockDecorations(block, pos, indexes);
    },
    redecorates: (view) => {
      if (view.editable === editable) return false;
      editable = view.editable;
      return options.createNote !== undefined;
    },
    trigger: triggerAt,
    options: (state) => {
      const suggestion = noteLinkSuggestion(state);
      return suggestion ? { index: suggestion.index, count: suggestion.items.length } : null;
    },
    handleKeyDown: handleKey,
    click: (view, event) => openClicked(view, event, options),
    subscribe: options.subscribe,
  });
}

export function noteLinkExtensions(options: NoteLinkOptions): AnyExtension[] {
  return [
    Extension.create<NoteLinkOptions>({
      name: "noteLinks",
      priority: 1000,
      addOptions: () => options,
      addProseMirrorPlugins() {
        return [linkPlugin(this.options), blockFlashPlugin()];
      },
    }),
  ];
}
