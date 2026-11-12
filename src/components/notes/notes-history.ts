import type { JsonValue, ViewState, WorkspaceLayout } from "@oleafly/workspace";
import { openNoteEditor } from "@/lib/open-note-editors";
import { HOME_TABS, type HomeTab } from "./home-notes";
import { DEAD_LINKS_VIEW, GRAPH_VIEW, HOME_VIEW, isHomeView, newHomeViewId, noteIdOf, noteView, openInPlace } from "./notes-layout";

export const HISTORY_LIMIT = 50;
const HISTORY_PARAM = "history";
const DEFAULT_TAB: HomeTab = "mine";

export interface NotesPlace {
  view: string;
  tab?: HomeTab;
  scroll?: number;
}

export interface TabHistory {
  entries: readonly NotesPlace[];
  index: number;
}

export type HistoryDirection = -1 | 1;

function homeTab(value: unknown): HomeTab | undefined {
  return HOME_TABS.find((tab) => tab === value);
}

export function homeTabOf(view: ViewState | undefined): HomeTab {
  return homeTab(view?.params?.tab) ?? DEFAULT_TAB;
}

function placeable(view: string): boolean {
  return view === HOME_VIEW || view === GRAPH_VIEW || view === DEAD_LINKS_VIEW || Boolean(noteIdOf(view));
}

function validScroll(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function place(view: string, tab: HomeTab | undefined, scroll: unknown): NotesPlace {
  if (view === HOME_VIEW) return { view, tab: tab ?? DEFAULT_TAB };
  return validScroll(scroll) ? { view, scroll: Math.round(scroll) } : { view };
}

export function placeOf(viewId: string, view: ViewState | undefined, scroll?: number): NotesPlace {
  return isHomeView(viewId) ? place(HOME_VIEW, homeTabOf(view), undefined) : place(viewId, undefined, scroll);
}

function samePlace(left: NotesPlace, right: NotesPlace): boolean {
  return left.view === right.view && left.tab === right.tab;
}

export function placeView(target: NotesPlace): ViewState {
  const noteId = noteIdOf(target.view);
  if (noteId) return noteView(noteId);
  if (target.view === HOME_VIEW) return target.tab && target.tab !== DEFAULT_TAB ? { type: "home", params: { tab: target.tab } } : { type: "home" };
  return { type: target.view === GRAPH_VIEW ? "graph" : "dead-links" };
}

function parsePlace(value: unknown): NotesPlace | null {
  if (typeof value !== "object" || value === null) return null;
  const { view, tab, scroll } = value as Record<string, unknown>;
  return typeof view === "string" && placeable(view) ? place(view, homeTab(tab), scroll) : null;
}

function parseHistory(value: unknown): TabHistory | null {
  if (typeof value !== "object" || value === null) return null;
  const { entries, index } = value as Record<string, unknown>;
  if (!Array.isArray(entries) || !Number.isInteger(index)) return null;
  const places = entries.map(parsePlace);
  const at = index as number;
  if (at < 0 || at >= places.length || places.includes(null)) return null;
  const dropped = Math.min(at, Math.max(0, places.length - HISTORY_LIMIT));
  return { entries: (places as NotesPlace[]).slice(dropped, dropped + HISTORY_LIMIT), index: at - dropped };
}

function placeJson(entry: NotesPlace): JsonValue {
  if (entry.tab) return { view: entry.view, tab: entry.tab };
  return entry.scroll === undefined ? { view: entry.view } : { view: entry.view, scroll: entry.scroll };
}

function withHistory(layout: WorkspaceLayout, viewId: string, history: TabHistory): WorkspaceLayout {
  const view = layout.views[viewId];
  if (!view) return layout;
  const { [HISTORY_PARAM]: _old, ...rest } = view.params ?? {};
  const params = history.entries.length > 1 ? { ...rest, [HISTORY_PARAM]: { entries: history.entries.map(placeJson), index: history.index } } : rest;
  const next = Object.keys(params).length > 0 ? { type: view.type, params } : { type: view.type };
  return { ...layout, views: { ...layout.views, [viewId]: next } };
}

export function tabHistory(layout: WorkspaceLayout, viewId: string, scroll?: number): TabHistory {
  const view = layout.views[viewId];
  const here = placeOf(viewId, view, scroll);
  const kept = parseHistory(view?.params?.[HISTORY_PARAM]);
  const stored = kept?.entries[kept.index];
  if (!kept || stored?.view !== here.view) return { entries: [here], index: 0 };
  const current = scroll === undefined && stored.scroll !== undefined ? { ...here, scroll: stored.scroll } : here;
  return { entries: kept.entries.map((entry, index) => (index === kept.index ? current : entry)), index: kept.index };
}

export function recordVisit(
  before: WorkspaceLayout,
  after: WorkspaceLayout,
  fromId: string | null,
  toId: string,
  scroll?: number,
): WorkspaceLayout {
  if (!fromId || !(fromId in before.views) || !(toId in after.views)) return after;
  if (fromId !== toId && fromId in after.views) return after;
  const history = tabHistory(before, fromId, scroll);
  const arriving = placeOf(toId, after.views[toId]);
  if (samePlace(history.entries[history.index], arriving)) return fromId === toId ? after : withHistory(after, toId, history);
  const entries = [...history.entries.slice(0, history.index + 1), arriving].slice(-HISTORY_LIMIT);
  return withHistory(after, toId, { entries, index: entries.length - 1 });
}

export function stepIndexes(history: TabHistory, direction: HistoryDirection, exists: (entry: NotesPlace) => boolean): number[] {
  const indexes: number[] = [];
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    if (exists(history.entries[index])) indexes.push(index);
  }
  return indexes;
}

function homeViewIdFor(layout: WorkspaceLayout, viewId: string): string {
  return isHomeView(viewId) ? viewId : newHomeViewId(layout);
}

export function travel(
  layout: WorkspaceLayout,
  viewId: string,
  index: number,
  scroll?: number,
): { layout: WorkspaceLayout; viewId: string; place: NotesPlace } | null {
  const history = tabHistory(layout, viewId, scroll);
  const target = history.entries[index];
  if (!target || index === history.index) return null;
  const targetId = target.view === HOME_VIEW ? homeViewIdFor(layout, viewId) : target.view;
  const view = placeView(target);
  const moved = openInPlace(layout, viewId, targetId, view);
  if (!moved) return null;
  const shown = { ...moved, views: { ...moved.views, [targetId]: view } };
  return { layout: withHistory(shown, targetId, { entries: history.entries, index }), viewId: targetId, place: target };
}

export function showHomeTab(layout: WorkspaceLayout, viewId: string, tab: HomeTab): WorkspaceLayout {
  const view = layout.views[viewId];
  if (!view || !isHomeView(viewId) || homeTabOf(view) === tab) return layout;
  const { tab: _old, ...rest } = view.params ?? {};
  const params = tab === DEFAULT_TAB ? rest : { ...rest, tab };
  return { ...layout, views: { ...layout.views, [viewId]: Object.keys(params).length > 0 ? { type: view.type, params } : { type: view.type } } };
}

export function noteScroll(viewId: string | null): number | undefined {
  const noteId = noteIdOf(viewId);
  return noteId ? openNoteEditor(noteId)?.root?.scrollTop : undefined;
}
