import { Extension, type AnyExtension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, type EditorView } from "@tiptap/pm/view";
import type { CSSProperties } from "react";
import { i18n } from "@/i18n";
import { noteColorStyle } from "./note-icons";
import { noteLinkHref, parseNoteLink, uniqueSlugs, type NoteHeading, type NoteLinkTarget } from "./note-link-format";
import { isSelectionModifier } from "@/store/library-selection";
import { sendSuggestMeta, suggestionKey, suggestOptionId, suggestPlugin, type SuggestState } from "./note-suggest-plugin";
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

export type LinkCandidate =
  | { kind: "note"; id: string; projectId: string; title: string; color?: string; icon?: string; alias?: string }
  | { kind: "project"; id: string; title: string; color: string | null }
  | { kind: "heading"; id: string; projectId: string; title: string; heading: NoteHeading; self: boolean; color?: string; icon?: string };

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
  onOpenNote: OpenNoteHandler;
  onOpenProject: OpenProjectHandler;
  currentProjectId?: string | null;
  subscribe?: (listener: () => void) => () => void;
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
const TRIGGER = /(!?)\[\[([^[\]\n￼]{0,80})$/u;
const LOOK_BEHIND = 96;
const linkKey = new PluginKey<SuggestState<SuggestRange>>("noteLinks");
let menuCount = 0;

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
    const at = name.toLocaleLowerCase().indexOf(needle);
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
    const names = [item.title, ...(item.aliases ?? [])];
    const best = rankOf(names, needle);
    if (best) scored.push({ item, rank: best.rank, order, alias: best.name > 0 ? names[best.name] : undefined });
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
  const needle = parseLinkQuery(query).name.toLocaleLowerCase();
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
  const wanted = name.toLocaleLowerCase();
  const exact = notes.find((note) =>
    [note.title, ...(note.aliases ?? [])].some((candidate) => candidate.toLocaleLowerCase() === wanted),
  );
  if (exact) return exact;
  const others = notes.filter((note) => note.projectId !== currentProjectId);
  return ranked(others, wanted, 1)[0]?.item ?? null;
}

export function docHeadings(doc: ProseMirrorNode): DocHeading[] {
  const found: { level: number; text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    found.push({ level: Number(node.attrs.level ?? 1), text: node.textContent.replace(/\s+/gu, " ").trim(), pos });
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
  const needle = query.toLocaleLowerCase();
  return headings
    .filter((heading) => !needle || heading.text.toLocaleLowerCase().includes(needle))
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
): Record<string, string> {
  const attrs: Record<string, string> = {
    class: start ? "note-link note-link-start" : "note-link",
    "data-note-link": target.kind,
  };
  if (target.heading) attrs["data-note-heading"] = target.heading;
  if (target.kind === "note") {
    if (!notes) return attrs;
    const note = notes.get(target.id);
    if (!note) return missing(attrs, i18n.t(($) => $.notes.links.missingNote));
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

function linkIndexes(options: NoteLinkOptions): LinkIndexes {
  const notes = options.getNotes();
  const projects = options.getProjects();
  return {
    notes: notes ? indexed(noteIndexes, notes, () => new Map(notes.map((note) => [note.noteId, note]))) : null,
    projects: projects ? indexed(projectIndexes, projects, () => new Map(projects.map((project) => [project.projectId, project]))) : null,
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
    found.push(Decoration.inline(pos, end, linkAttrs(target, start, indexes.notes, indexes.projects)));
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
  const headings = self ? docHeadings(state.doc) : (options.getHeadings?.(target.projectId) ?? null);
  if (!headings) return { items: [], loading: true };
  return { items: headingCandidates(target, headings, query.heading ?? "", self), loading: false };
}

export function noteLinkSuggestion(state: EditorState): NoteLinkSuggestion | null {
  const spec = specOf(state);
  const suggest = linkKey.getState(state)?.suggest;
  if (!spec || !suggest) return null;
  const options = spec.noteLinks;
  const query = parseLinkQuery(suggest.query);
  const found =
    query.heading === null
      ? {
          items: linkCandidates(options.getNotes() ?? [], options.getProjects() ?? [], suggest.query, options.currentProjectId, suggest.embed),
          loading: false,
        }
      : headingItems(state, options, query);
  return {
    ...suggest,
    menuId: spec.menuId,
    alias: query.alias,
    headings: query.heading !== null,
    loading: found.loading,
    index: Math.min(suggest.index, Math.max(0, found.items.length - 1)),
    items: found.items,
  };
}

export const noteLinkOptionId = suggestOptionId;

export function highlightNoteLink(view: EditorView, index: number): void {
  sendSuggestMeta(view, linkKey, { index });
}

export function closeNoteLinkMenu(view: EditorView): void {
  sendSuggestMeta(view, linkKey, { dismiss: true });
}

export function candidateHref(candidate: LinkCandidate): string {
  if (candidate.kind === "heading") return noteLinkHref("note", candidate.id, candidate.heading.slug);
  return noteLinkHref(candidate.kind, candidate.id);
}

export function candidateText(candidate: LinkCandidate, alias: string | null): string {
  if (alias) return alias;
  if (candidate.kind === "heading") {
    return candidate.self ? candidate.heading.text : `${candidate.title.trim() || candidate.id} > ${candidate.heading.text}`;
  }
  return candidate.title.trim() || candidate.id;
}

export function canEmbed(candidate: LinkCandidate): boolean {
  return candidate.kind !== "project" && !(candidate.kind === "heading" && candidate.self);
}

export function insertNoteLink(view: EditorView, candidate: LinkCandidate, asEmbed?: boolean): boolean {
  const suggestion = noteLinkSuggestion(view.state);
  const { state } = view;
  const link = state.schema.marks.link;
  if (!suggestion || !link) return false;
  const { from, to } = suggestion;
  const text = candidateText(candidate, suggestion.alias);
  const href = candidateHref(candidate);
  const embed = (asEmbed ?? suggestion.embed) && canEmbed(candidate) && state.schema.nodes.image !== undefined;
  if (embed) {
    const $from = state.doc.resolve(from);
    const lead = /[ \t]*$/u.exec($from.parent.textBetween(0, $from.parentOffset, undefined, "￼"))?.[0].length ?? 0;
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
  const heading = docHeadings(view.state.doc).find((candidate) => candidate.slug === slug);
  if (!heading) return false;
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, heading.pos + 1));
  view.dispatch(tr);
  const dom = view.nodeDOM(heading.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView?.({ block: "start" });
  return true;
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
    const note = options.getNotes()?.find((candidate) => candidate.noteId === target.id);
    if (!note) return true;
    if (target.heading && note.projectId === options.currentProjectId && !newTab) {
      scrollViewToHeading(view, target.heading);
      return true;
    }
    const opened: OpenNoteOptions = { newTab, projectId: note.projectId };
    if (target.heading) opened.heading = target.heading;
    options.onOpenNote(target.id, opened);
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
  return suggestPlugin<SuggestRange>({
    key: linkKey,
    menuId,
    spec,
    decorator: () => {
      const indexes = linkIndexes(options);
      return (block, pos) => blockDecorations(block, pos, indexes);
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
        return [linkPlugin(this.options)];
      },
    }),
  ];
}
