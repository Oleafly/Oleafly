// @vitest-environment jsdom

import { createLayout, group, groupOfView, split, type ViewState, type WorkspaceLayout } from "@oleafly/workspace";
import { beforeEach, describe, expect, it } from "vitest";
import { registerNoteEditor, type OpenNoteEditor } from "@/lib/open-note-editors";
import {
  HISTORY_LIMIT,
  homeTabOf,
  type NotesPlace,
  noteScroll,
  placeOf,
  placeView,
  recordVisit,
  showHomeTab,
  stepIndexes,
  tabHistory,
  travel,
} from "./notes-history";
import {
  DEAD_LINKS_VIEW,
  GRAPH_VIEW,
  HOME_VIEW,
  noteView,
  noteViewId,
  openHomeInPlace,
  openNoteIn,
  openNoteInPlace,
  readNotesLayout,
  saveNotesLayout,
} from "./notes-layout";

const home: ViewState = { type: "home" };

function oneTab(): WorkspaceLayout {
  return createLayout(group("g1", [HOME_VIEW]), { [HOME_VIEW]: home }, "g1");
}

function openFromHome(layout: WorkspaceLayout, placeId: string, noteId: string, scroll?: number): WorkspaceLayout {
  return recordVisit(layout, openNoteInPlace(layout, placeId, noteId), placeId, noteViewId(noteId), scroll);
}

function homeHere(layout: WorkspaceLayout, placeId: string, homeId: string, scroll?: number): WorkspaceLayout {
  return recordVisit(layout, openHomeInPlace(layout, placeId, homeId), placeId, homeId, scroll);
}

function views(layout: WorkspaceLayout, viewId: string): string[] {
  return tabHistory(layout, viewId).entries.map((entry) => entry.view);
}

const always = () => true;

beforeEach(() => {
  localStorage.clear();
});

describe("places", () => {
  it("names every Home tab by one place and keeps its Home tab", () => {
    expect(placeOf(HOME_VIEW, home)).toEqual({ view: HOME_VIEW, tab: "mine" });
    expect(placeOf("home:3", { type: "home", params: { tab: "tasks" } })).toEqual({ view: HOME_VIEW, tab: "tasks" });
    expect(placeOf("home:3", { type: "home", params: { tab: "nonsense" } })).toEqual({ view: HOME_VIEW, tab: "mine" });
  });

  it("keeps a note's scroll only when it is past the top", () => {
    expect(placeOf("note:n1", noteView("n1"), 240.4)).toEqual({ view: "note:n1", scroll: 240 });
    expect(placeOf("note:n1", noteView("n1"), 0)).toEqual({ view: "note:n1" });
    expect(placeOf("note:n1", noteView("n1"))).toEqual({ view: "note:n1" });
  });

  it("turns a place back into the view that shows it", () => {
    expect(placeView({ view: "note:n2" })).toEqual(noteView("n2"));
    expect(placeView({ view: HOME_VIEW, tab: "mine" })).toEqual(home);
    expect(placeView({ view: HOME_VIEW, tab: "attachments" })).toEqual({ type: "home", params: { tab: "attachments" } });
    expect(placeView({ view: GRAPH_VIEW })).toEqual({ type: "graph" });
    expect(placeView({ view: DEAD_LINKS_VIEW })).toEqual({ type: "dead-links" });
  });
});

describe("recording visits", () => {
  it("starts every tab with only the place it shows", () => {
    expect(tabHistory(oneTab(), HOME_VIEW)).toEqual({ entries: [{ view: HOME_VIEW, tab: "mine" }], index: 0 });
  });

  it("pushes each place opened in the same tab and follows the tab's new view id", () => {
    let layout = openFromHome(oneTab(), HOME_VIEW, "n1");
    layout = homeHere(layout, "note:n1", "home:2");
    layout = openFromHome(layout, "home:2", "n2");
    expect(Object.keys(layout.views)).toEqual(["note:n2"]);
    expect(views(layout, "note:n2")).toEqual([HOME_VIEW, "note:n1", HOME_VIEW, "note:n2"]);
    expect(tabHistory(layout, "note:n2").index).toBe(3);
  });

  it("keeps the scroll of the note being left", () => {
    let layout = openFromHome(oneTab(), HOME_VIEW, "n1");
    layout = homeHere(layout, "note:n1", "home:2", 512);
    expect(tabHistory(layout, "home:2").entries[1]).toEqual({ view: "note:n1", scroll: 512 });
  });

  it("starts a note opened in a new tab with its own history", () => {
    const first = openFromHome(oneTab(), HOME_VIEW, "n1");
    const opened = recordVisit(first, openNoteIn(first, "n2", null), "note:n1", "note:n2");
    expect(views(opened, "note:n2")).toEqual(["note:n2"]);
    expect(views(opened, "note:n1")).toEqual([HOME_VIEW, "note:n1"]);
  });

  it("keeps the history of each tab apart", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["home"]), group("g2", ["home:2"])]), { home, "home:2": home });
    let next = openFromHome(layout, "home", "n1");
    next = openFromHome(next, "home:2", "n2");
    next = homeHere(next, "note:n2", "home:3");
    expect(views(next, "note:n1")).toEqual([HOME_VIEW, "note:n1"]);
    expect(views(next, "home:3")).toEqual([HOME_VIEW, "note:n2", HOME_VIEW]);
  });

  it("drops the places ahead when going somewhere new after going back", () => {
    let layout = openFromHome(oneTab(), HOME_VIEW, "n1");
    layout = homeHere(layout, "note:n1", "home:2");
    layout = openFromHome(layout, "home:2", "n2");
    const back = travel(layout, "note:n2", 1);
    if (!back) throw new Error("no way back");
    const next = openFromHome(back.layout, back.viewId, "n3");
    expect(views(next, "note:n3")).toEqual([HOME_VIEW, "note:n1", "note:n3"]);
    expect(stepIndexes(tabHistory(next, "note:n3"), 1, always)).toEqual([]);
  });

  it(`keeps no more than ${HISTORY_LIMIT} places, dropping the oldest`, () => {
    let layout = oneTab();
    let viewId = HOME_VIEW;
    for (let step = 0; step < HISTORY_LIMIT + 10; step += 1) {
      layout = openFromHome(layout, viewId, `n${step}`);
      viewId = noteViewId(`n${step}`);
      const homeId = `home:${step + 2}`;
      layout = homeHere(layout, viewId, homeId);
      viewId = homeId;
    }
    const kept = tabHistory(layout, viewId);
    expect(kept.entries).toHaveLength(HISTORY_LIMIT);
    expect(kept.index).toBe(HISTORY_LIMIT - 1);
    expect(kept.entries.at(-2)).toEqual({ view: noteViewId(`n${HISTORY_LIMIT + 9}`) });
  });

  it("pushes nothing when the place does not change, and nothing for a tab that is not replaced", () => {
    const layout = openFromHome(oneTab(), HOME_VIEW, "n1");
    expect(recordVisit(layout, layout, "note:n1", "note:n1")).toBe(layout);
    expect(recordVisit(layout, layout, "note:gone", "note:n1")).toBe(layout);
    expect(recordVisit(layout, layout, null, "note:n1")).toBe(layout);
  });

  it("pushes a switch between Home's tabs", () => {
    const tasks = recordVisit(oneTab(), showHomeTab(oneTab(), HOME_VIEW, "tasks"), HOME_VIEW, HOME_VIEW);
    const files = recordVisit(tasks, showHomeTab(tasks, HOME_VIEW, "attachments"), HOME_VIEW, HOME_VIEW);
    expect(homeTabOf(files.views[HOME_VIEW])).toBe("attachments");
    expect(tabHistory(files, HOME_VIEW).entries.map((entry) => entry.tab)).toEqual(["mine", "tasks", "attachments"]);
  });

  it("leaves no history on a tab that has only been one place", () => {
    const layout = recordVisit(oneTab(), oneTab(), HOME_VIEW, HOME_VIEW);
    expect(layout.views[HOME_VIEW]).toEqual(home);
    expect(showHomeTab(oneTab(), HOME_VIEW, "mine")).toEqual(oneTab());
  });
});

describe("walking the history", () => {
  function walked(): WorkspaceLayout {
    let layout = showHomeTab(oneTab(), HOME_VIEW, "tasks");
    layout = openFromHome(layout, HOME_VIEW, "n1");
    layout = homeHere(layout, "note:n1", "home:2", 300);
    return openFromHome(layout, "home:2", "n2");
  }

  it("lists the places behind and ahead, nearest first, skipping missing notes", () => {
    const history = tabHistory(walked(), "note:n2");
    expect(stepIndexes(history, -1, always)).toEqual([2, 1, 0]);
    expect(stepIndexes(history, 1, always)).toEqual([]);
    const live = (entry: NotesPlace) => entry.view !== "note:n1";
    expect(stepIndexes(history, -1, live)).toEqual([2, 0]);
    expect(stepIndexes({ entries: history.entries, index: 0 }, 1, live)).toEqual([2, 3]);
  });

  it("goes back to a note in the same tab and hands back its scroll", () => {
    const back = travel(walked(), "note:n2", 1, 90);
    if (!back) throw new Error("no way back");
    expect(back.viewId).toBe("note:n1");
    expect(back.place).toEqual({ view: "note:n1", scroll: 300 });
    expect(Object.keys(back.layout.views)).toEqual(["note:n1"]);
    const history = tabHistory(back.layout, "note:n1");
    expect(history.index).toBe(1);
    expect(history.entries[3]).toEqual({ view: "note:n2", scroll: 90 });
    const forward = travel(back.layout, "note:n1", 3);
    expect(forward?.place).toEqual({ view: "note:n2", scroll: 90 });
    expect(forward && tabHistory(forward.layout, "note:n2").index).toBe(3);
  });

  it("brings Home back on the Home tab it was showing", () => {
    const back = travel(walked(), "note:n2", 0);
    if (!back) throw new Error("no way back");
    expect(back.viewId).toBe(HOME_VIEW);
    expect(homeTabOf(back.layout.views[HOME_VIEW])).toBe("tasks");
    expect(tabHistory(back.layout, HOME_VIEW).index).toBe(0);
  });

  it("switches Home's tab in place when going back between two of them", () => {
    const tasks = recordVisit(oneTab(), showHomeTab(oneTab(), HOME_VIEW, "tasks"), HOME_VIEW, HOME_VIEW);
    const back = travel(tasks, HOME_VIEW, 0);
    expect(back?.viewId).toBe(HOME_VIEW);
    expect(back && homeTabOf(back.layout.views[HOME_VIEW])).toBe("mine");
  });

  it("brings a note that is open in another tab into this one", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["home"]), group("g2", ["home:2"])]), { home, "home:2": home });
    let next = openFromHome(layout, "home", "n1");
    next = homeHere(next, "note:n1", "home:3");
    next = openFromHome(next, "home:2", "n1");
    const back = travel(next, "home:3", 1);
    if (!back) throw new Error("no way back");
    expect(groupOfView(back.layout, "note:n1")?.id).toBe("g1");
    expect(tabHistory(back.layout, "note:n1").entries.map((entry) => entry.view)).toEqual([HOME_VIEW, "note:n1", HOME_VIEW]);
  });

  it("does nothing for the place the tab is on or for a place it never had", () => {
    expect(travel(walked(), "note:n2", 3)).toBeNull();
    expect(travel(walked(), "note:n2", 9)).toBeNull();
  });
});

describe("saving the history", () => {
  it("keeps each tab's history with the saved layout and reads it back", () => {
    const layout = openFromHome(oneTab(), HOME_VIEW, "n1", 0);
    const left = homeHere(layout, "note:n1", "home:2", 128);
    saveNotesLayout(left);
    const restored = readNotesLayout();
    expect(tabHistory(restored, "home:2")).toEqual(tabHistory(left, "home:2"));
    expect(travel(restored, "home:2", 1)?.place).toEqual({ view: "note:n1", scroll: 128 });
  });

  it("ignores a saved history that is broken or belongs to another place", () => {
    const broken = (history: unknown): WorkspaceLayout =>
      createLayout(group("g1", ["note:n1"]), { "note:n1": { type: "note", params: { noteId: "n1", history: history as never } } });
    expect(views(broken({ entries: [{ view: "note:n1" }], index: 4 }), "note:n1")).toEqual(["note:n1"]);
    expect(views(broken({ entries: [{ view: "elsewhere" }, { view: "note:n1" }], index: 1 }), "note:n1")).toEqual(["note:n1"]);
    expect(views(broken({ entries: [{ view: "note:n2" }], index: 0 }), "note:n1")).toEqual(["note:n1"]);
    expect(views(broken("nonsense"), "note:n1")).toEqual(["note:n1"]);
  });

  it("trims a saved history that grew past the limit, keeping the place the tab is on", () => {
    const entries = Array.from({ length: HISTORY_LIMIT + 20 }, (_, index) => ({ view: index % 2 === 0 ? "note:n1" : HOME_VIEW, tab: "mine" }));
    const layout = createLayout(group("g1", ["note:n1"]), {
      "note:n1": { type: "note", params: { noteId: "n1", history: { entries, index: 10 } } },
    });
    const history = tabHistory(layout, "note:n1");
    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(history.index).toBe(0);
    expect(history.entries[0]).toEqual({ view: "note:n1" });
  });
});

describe("reading the scroll of an open note", () => {
  it("reads it from the note's editor and nothing for other views", () => {
    const root = document.createElement("div");
    root.scrollTop = 420;
    const stop = registerNoteEditor("n7", { root } as unknown as OpenNoteEditor);
    expect(noteScroll("note:n7")).toBe(420);
    expect(noteScroll("note:n8")).toBeUndefined();
    expect(noteScroll(HOME_VIEW)).toBeUndefined();
    expect(noteScroll(null)).toBeUndefined();
    stop();
  });
});
