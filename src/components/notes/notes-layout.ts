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

export const NOTES_LAYOUT_KEY = "oleafly.notes.layout";
export const HOME_VIEW = "home";
export const ARTIFACTS_VIEW = "artifacts";
export const ARTIFACTS_SHARE = 0.32;
const NOTE_PREFIX = "note:";
const HOME_PREFIX = "home:";
const EXTRA_HOME = /^home:([1-9]\d*)$/u;

export function isHomeView(viewId: string): boolean {
  return viewId === HOME_VIEW || EXTRA_HOME.test(viewId);
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
  const noteId = noteIdOf(id);
  return noteId !== null && noteId !== "" && view.type === "note" && view.params?.noteId === noteId;
}

export function cleanNotesLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const views = Object.fromEntries(Object.entries(layout.views).filter(([id, view]) => knownView(id, view)));
  const cleaned = normalize({ ...layout, views });
  return Object.keys(cleaned.views).length === 0 ? defaultNotesLayout() : cleaned;
}

export function readNotesLayout(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(NOTES_LAYOUT_KEY);
    const parsed = raw ? parseLayout(JSON.parse(raw)) : null;
    return parsed ? cleanNotesLayout(parsed) : defaultNotesLayout();
  } catch {
    return defaultNotesLayout();
  }
}

export function saveNotesLayout(layout: WorkspaceLayout): void {
  try {
    localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    return;
  }
}

export function holdsNotes(candidate: GroupNode): boolean {
  return candidate.views.some((view) => isHomeView(view) || noteIdOf(view) !== null);
}

export function stageGroup(layout: WorkspaceLayout, focused: string | null): GroupNode {
  const groups = groupsOf(layout.root);
  const owner = focused && focused !== ARTIFACTS_VIEW ? groupOfView(layout, focused) : null;
  if (owner) return owner;
  const stage = groups.find((candidate) => candidate.id === layout.stage);
  if (stage) return stage;
  return (
    groups.find(holdsNotes) ??
    groups.find((candidate) => !candidate.views.every((view) => view === ARTIFACTS_VIEW)) ??
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

export function openNoteInPlace(layout: WorkspaceLayout, placeId: string, noteId: string): WorkspaceLayout {
  const owner = groupOfView(layout, placeId);
  if (!owner) return openNoteIn(layout, noteId, null);
  const viewId = noteViewId(noteId);
  const target = { groupId: owner.id, zone: "center" as const, index: owner.views.indexOf(placeId) };
  const placed = groupOfView(layout, viewId) ? moveView(layout, viewId, target) : openView(layout, viewId, noteView(noteId), target);
  return closeView(placed, placeId);
}

export function openNoteViews(layout: WorkspaceLayout): string[] {
  return groupsOf(layout.root).flatMap((candidate) => candidate.views.filter((view) => noteIdOf(view) !== null));
}
