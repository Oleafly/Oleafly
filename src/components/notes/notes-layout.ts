import {
  closeView,
  createLayout,
  group,
  groupOfView,
  groupsOf,
  moveView,
  normalize,
  openView,
  parseLayout,
  type GroupNode,
  type ViewState,
  type WorkspaceLayout,
} from "@oleafly/workspace";
import { readJson, writeJson } from "@/lib/local-storage";

export const NOTES_LAYOUT_KEY = "oleafly.notes.layout";
export const HOME_VIEW = "home";
export const ARTIFACTS_VIEW = "artifacts";
export const ARTIFACTS_SHARE = 0.32;
export const GRAPH_VIEW = "graph";
export const LOCAL_GRAPH_VIEW = "local-graph";
export const OUTLINE_VIEW = "outline";
export const DEAD_LINKS_VIEW = "dead-links";
export const INFO_VIEW = "info";
export const SIDE_SHARE = 0.3;
const SIDE_VIEWS: ReadonlySet<string> = new Set([ARTIFACTS_VIEW, LOCAL_GRAPH_VIEW, OUTLINE_VIEW, INFO_VIEW]);
const NOTE_PREFIX = "note:";
const HOME_PREFIX = "home:";
const EXTRA_HOME = /^home:([1-9]\d*)$/u;

export function isHomeView(viewId: string): boolean {
  return viewId === HOME_VIEW || EXTRA_HOME.test(viewId);
}

export function isSideView(viewId: string | null | undefined): boolean {
  return viewId !== null && viewId !== undefined && SIDE_VIEWS.has(viewId);
}

export function sideView(viewId: string): ViewState | null {
  if (viewId === ARTIFACTS_VIEW) return { type: "artifacts" };
  if (viewId === LOCAL_GRAPH_VIEW) return { type: "graph", params: { local: true } };
  if (viewId === OUTLINE_VIEW) return { type: "outline" };
  if (viewId === INFO_VIEW) return { type: "info" };
  return null;
}

export function homeViews(layout: WorkspaceLayout): string[] {
  return groupsOf(layout.root).flatMap((candidate) => candidate.views.filter(isHomeView));
}

export function newHomeViewId(layout: WorkspaceLayout): string {
  if (!(HOME_VIEW in layout.views)) return HOME_VIEW;
  const numbers = Object.keys(layout.views).map((id) => Number(EXTRA_HOME.exec(id)?.[1] ?? 1));
  return `${HOME_PREFIX}${Math.max(1, ...numbers) + 1}`;
}

export function noteViewId(noteId: string): string {
  return `${NOTE_PREFIX}${noteId}`;
}

export function noteIdOf(viewId: string | null | undefined): string | null {
  return viewId?.startsWith(NOTE_PREFIX) ? viewId.slice(NOTE_PREFIX.length) : null;
}

export function noteView(noteId: string): ViewState {
  return { type: "note", params: { noteId } };
}

export function defaultNotesLayout(): WorkspaceLayout {
  return createLayout(group("g1", [HOME_VIEW]), { [HOME_VIEW]: { type: "home" } }, "g1");
}

function knownView(id: string, view: ViewState): boolean {
  if (isHomeView(id)) return view.type === "home";
  if (id === ARTIFACTS_VIEW) return view.type === "artifacts";
  if (id === GRAPH_VIEW) return view.type === "graph" && view.params?.local !== true;
  if (id === LOCAL_GRAPH_VIEW) return view.type === "graph" && view.params?.local === true;
  if (id === OUTLINE_VIEW) return view.type === "outline";
  if (id === DEAD_LINKS_VIEW) return view.type === "dead-links";
  if (id === INFO_VIEW) return view.type === "info";
  const noteId = noteIdOf(id);
  return noteId !== null && noteId !== "" && view.type === "note" && view.params?.noteId === noteId;
}

export function cleanNotesLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const views = Object.fromEntries(Object.entries(layout.views).filter(([id, view]) => knownView(id, view)));
  const cleaned = normalize({ ...layout, views });
  return Object.keys(cleaned.views).length === 0 ? defaultNotesLayout() : cleaned;
}

function storedLayout(value: unknown): WorkspaceLayout | null {
  const parsed = parseLayout(value);
  return parsed ? cleanNotesLayout(parsed) : null;
}

export function readNotesLayout(): WorkspaceLayout {
  return readJson(NOTES_LAYOUT_KEY, null, storedLayout) ?? defaultNotesLayout();
}

export function saveNotesLayout(layout: WorkspaceLayout): void {
  writeJson(NOTES_LAYOUT_KEY, layout);
}

export function closeSavedNoteView(noteId: string): void {
  const saved = readNotesLayout();
  const next = closeView(saved, noteViewId(noteId));
  if (next !== saved) saveNotesLayout(next);
}

export function holdsNotes(candidate: GroupNode): boolean {
  return candidate.views.some((view) => isHomeView(view) || noteIdOf(view) !== null);
}

export function stageGroup(layout: WorkspaceLayout, focused: string | null): GroupNode {
  const groups = groupsOf(layout.root);
  const owner = focused && !isSideView(focused) ? groupOfView(layout, focused) : null;
  if (owner) return owner;
  const stage = groups.find((candidate) => candidate.id === layout.stage);
  if (stage) return stage;
  return (
    groups.find(holdsNotes) ??
    groups.find((candidate) => !candidate.views.every(isSideView)) ??
    groups[0]
  );
}

export function openNoteIn(layout: WorkspaceLayout, noteId: string, groupId: string | null): WorkspaceLayout {
  const target = groupsOf(layout.root).find((candidate) => candidate.id === groupId) ?? stageGroup(layout, null);
  return openView(layout, noteViewId(noteId), noteView(noteId), { groupId: target.id, zone: "center" });
}

export function openHomeIn(layout: WorkspaceLayout, viewId: string, groupId: string): WorkspaceLayout {
  return openView(layout, viewId, { type: "home" }, { groupId, zone: "center" });
}

export function openInPlace(layout: WorkspaceLayout, placeId: string, viewId: string, view: ViewState): WorkspaceLayout | null {
  const owner = groupOfView(layout, placeId);
  if (!owner) return null;
  if (placeId === viewId) return layout;
  const target = { groupId: owner.id, zone: "center" as const, index: owner.views.indexOf(placeId) };
  const placed = groupOfView(layout, viewId) ? moveView(layout, viewId, target) : openView(layout, viewId, view, target);
  return closeView(placed, placeId);
}

export function openNoteInPlace(layout: WorkspaceLayout, placeId: string, noteId: string): WorkspaceLayout {
  return openInPlace(layout, placeId, noteViewId(noteId), noteView(noteId)) ?? openNoteIn(layout, noteId, null);
}

export function openHomeInPlace(layout: WorkspaceLayout, placeId: string, homeId: string): WorkspaceLayout {
  return openInPlace(layout, placeId, homeId, { type: "home" }) ?? openHomeIn(layout, homeId, stageGroup(layout, null).id);
}

export function openNoteViews(layout: WorkspaceLayout): string[] {
  return groupsOf(layout.root).flatMap((candidate) => candidate.views.filter((view) => noteIdOf(view) !== null));
}

export function toggleSideView(layout: WorkspaceLayout, viewId: string, focused: string | null): WorkspaceLayout {
  if (viewId in layout.views) return closeView(layout, viewId);
  const view = sideView(viewId);
  if (!view) return layout;
  const companion = groupsOf(layout.root).find(
    (candidate) => candidate.views.length > 0 && candidate.views.every(isSideView),
  );
  if (companion) return openView(layout, viewId, view, { groupId: companion.id, zone: "center" });
  const stage = stageGroup(layout, focused);
  return openView(layout, viewId, view, { groupId: stage.id, zone: "right" }, SIDE_SHARE);
}

export function openGraphIn(layout: WorkspaceLayout, focused: string | null): WorkspaceLayout {
  const stage = stageGroup(layout, focused);
  return openView(layout, GRAPH_VIEW, { type: "graph" }, { groupId: stage.id, zone: "center" });
}

export function openDeadLinksIn(layout: WorkspaceLayout, focused: string | null): WorkspaceLayout {
  const stage = stageGroup(layout, focused);
  return openView(layout, DEAD_LINKS_VIEW, { type: "dead-links" }, { groupId: stage.id, zone: "center" });
}

export function openNoteFrom(layout: WorkspaceLayout, noteId: string, focused: string | null): WorkspaceLayout {
  const stage = stageGroup(layout, focused);
  const current = noteIdOf(stage.active);
  if (stage.active && current !== null && current !== noteId && !groupOfView(layout, noteViewId(noteId))) {
    return openNoteInPlace(layout, stage.active, noteId);
  }
  return openNoteIn(layout, noteId, stage.id);
}
