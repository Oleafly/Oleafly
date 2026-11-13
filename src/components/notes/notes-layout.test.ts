// @vitest-environment jsdom

import { closeView, createLayout, group, groupOfView, groupsOf, split, toggleMaximize, type ViewState, type WorkspaceLayout } from "@oleafly/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACTS_SHARE,
  ARTIFACTS_VIEW,
  cleanNotesLayout,
  closeSavedNoteView,
  defaultNotesLayout,
  HOME_VIEW,
  holdsNotes,
  homeViews,
  isHomeView,
  newHomeViewId,
  NOTES_LAYOUT_KEY,
  noteIdOf,
  noteView,
  noteViewId,
  openHomeIn,
  openHomeInPlace,
  openNoteIn,
  openNoteInPlace,
  openNoteViews,
  readNotesLayout,
  saveNotesLayout,
  stageGroup,
} from "./notes-layout";

const home: ViewState = { type: "home" };
const artifacts: ViewState = { type: "artifacts" };

function notesLayout(): WorkspaceLayout {
  return createLayout(
    split("s1", "row", [group("g1", [HOME_VIEW, "note:n1"], "note:n1"), group("g2", ["note:n2", ARTIFACTS_VIEW])], [0.6, 0.4]),
    { [HOME_VIEW]: home, "note:n1": noteView("n1"), "note:n2": noteView("n2"), [ARTIFACTS_VIEW]: artifacts },
  );
}

function rawLayout(root: WorkspaceLayout["root"], views: Record<string, ViewState>): WorkspaceLayout {
  return { schema: 1, root, views, maximized: null };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("note view ids", () => {
  it("prefixes a note id and reads it back", () => {
    expect(noteViewId("abc")).toBe("note:abc");
    expect(noteIdOf(noteViewId("abc"))).toBe("abc");
    expect(noteIdOf("note:")).toBe("");
  });

  it("reads no note id from other views or from nothing", () => {
    expect(noteIdOf(HOME_VIEW)).toBeNull();
    expect(noteIdOf(ARTIFACTS_VIEW)).toBeNull();
    expect(noteIdOf("notes:abc")).toBeNull();
    expect(noteIdOf(null)).toBeNull();
    expect(noteIdOf(undefined)).toBeNull();
  });

  it("describes a note view by its note id", () => {
    expect(noteView("abc")).toEqual({ type: "note", params: { noteId: "abc" } });
  });

  it("gives the artifacts view about a third of the width", () => {
    expect(ARTIFACTS_SHARE).toBe(0.32);
  });
});

describe("Home view ids", () => {
  it("knows the first Home and numbered extra Homes", () => {
    expect(isHomeView(HOME_VIEW)).toBe(true);
    expect(isHomeView("home:2")).toBe(true);
    expect(isHomeView("home:15")).toBe(true);
  });

  it("rejects ids that only look like a Home", () => {
    for (const id of ["home:", "home:0", "home:02", "home:x", "home:2a", "homes", "note:home", ARTIFACTS_VIEW]) {
      expect(isHomeView(id)).toBe(false);
    }
  });

  it("lists the open Home views in layout order", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["note:n1", "home:3"]), group("g2", [HOME_VIEW])]), {
      "note:n1": noteView("n1"),
      "home:3": home,
      [HOME_VIEW]: home,
    });
    expect(homeViews(layout)).toEqual(["home:3", HOME_VIEW]);
    expect(homeViews(closeView(defaultNotesLayout(), HOME_VIEW))).toEqual([]);
  });

  it("names a new Home after the first free id", () => {
    expect(newHomeViewId(closeView(defaultNotesLayout(), HOME_VIEW))).toBe(HOME_VIEW);
    expect(newHomeViewId(defaultNotesLayout())).toBe("home:2");
    expect(newHomeViewId(notesLayout())).toBe("home:2");
    const many = createLayout(group("g1", [HOME_VIEW, "home:5", "home:2"]), { [HOME_VIEW]: home, "home:5": home, "home:2": home });
    expect(newHomeViewId(many)).toBe("home:6");
    const extraOnly = createLayout(group("g1", ["home:4"]), { "home:4": home });
    expect(newHomeViewId(extraOnly)).toBe(HOME_VIEW);
  });
});

describe("defaultNotesLayout", () => {
  it("is one group showing Home, which is the stage", () => {
    expect(defaultNotesLayout()).toEqual({
      schema: 1,
      root: { kind: "group", id: "g1", views: [HOME_VIEW], active: HOME_VIEW },
      views: { [HOME_VIEW]: home },
      maximized: null,
      stage: "g1",
    });
  });

  it("returns a fresh layout each time", () => {
    const first = defaultNotesLayout();
    first.views.extra = home;
    expect(defaultNotesLayout().views).not.toHaveProperty("extra");
  });
});

describe("cleanNotesLayout", () => {
  it("keeps a layout made only of known views", () => {
    expect(cleanNotesLayout(notesLayout())).toEqual(notesLayout());
  });

  it("drops views whose id and type disagree", () => {
    const layout = rawLayout(group("g1", [HOME_VIEW, ARTIFACTS_VIEW, "note:n1"]), {
      [HOME_VIEW]: { type: "artifacts" },
      [ARTIFACTS_VIEW]: { type: "home" },
      "note:n1": noteView("n1"),
    });
    const cleaned = cleanNotesLayout(layout);
    expect(Object.keys(cleaned.views)).toEqual(["note:n1"]);
    expect(cleaned.root).toEqual({ kind: "group", id: "g1", views: ["note:n1"], active: "note:n1" });
  });

  it("drops note views that do not point at their own note", () => {
    const layout = rawLayout(
      group("g1", ["note:", "note:n2", "note:n3", "note:n4", "other", "note:n1"], "note:n2"),
      {
        "note:": { type: "note", params: { noteId: "" } },
        "note:n2": noteView("n9"),
        "note:n3": { type: "note" },
        "note:n4": { type: "home", params: { noteId: "n4" } },
        other: { type: "note", params: { noteId: "other" } },
        "note:n1": noteView("n1"),
      },
    );
    const cleaned = cleanNotesLayout(layout);
    expect(cleaned.views).toEqual({ "note:n1": noteView("n1") });
    expect(cleaned.root).toEqual({ kind: "group", id: "g1", views: ["note:n1"], active: "note:n1" });
  });

  it("keeps the stage it was given", () => {
    const layout = { ...notesLayout(), stage: "g2" };
    expect(cleanNotesLayout(layout).stage).toBe("g2");
  });

  it("collapses groups that lose every view", () => {
    const layout = rawLayout(split("s1", "row", [group("g1", ["stray"]), group("g2", [HOME_VIEW])]), {
      stray: { type: "stray" },
      [HOME_VIEW]: home,
    });
    expect(cleanNotesLayout(layout).root).toEqual({ kind: "group", id: "g2", views: [HOME_VIEW], active: HOME_VIEW });
  });

  it("keeps extra Home tabs and drops ones whose id or type is wrong", () => {
    const layout = rawLayout(group("g1", [HOME_VIEW, "home:2", "home:0", "home:x", "home:3"], "home:2"), {
      [HOME_VIEW]: home,
      "home:2": home,
      "home:0": home,
      "home:x": home,
      "home:3": artifacts,
    });
    const cleaned = cleanNotesLayout(layout);
    expect(cleaned.views).toEqual({ [HOME_VIEW]: home, "home:2": home });
    expect(cleaned.root).toEqual({ kind: "group", id: "g1", views: [HOME_VIEW, "home:2"], active: "home:2" });
  });

  it("falls back to the default layout when nothing is left", () => {
    const layout = rawLayout(group("g7", ["stray"]), { stray: { type: "stray" } });
    expect(cleanNotesLayout(layout)).toEqual(defaultNotesLayout());
    expect(cleanNotesLayout(rawLayout(group("g7", []), {}))).toEqual(defaultNotesLayout());
  });
});

describe("readNotesLayout", () => {
  it.each([
    ["nothing is saved", null],
    ["an empty saved value", ""],
    ["a saved value that is not JSON", "{not json"],
    ["JSON that is not a layout", JSON.stringify({ schema: 2, root: null, views: {} })],
    ["a saved null", "null"],
  ])("gives the default layout when %s", (_case, saved) => {
    if (saved !== null) localStorage.setItem(NOTES_LAYOUT_KEY, saved);
    expect(readNotesLayout()).toEqual(defaultNotesLayout());
  });

  it("restores a saved layout", () => {
    localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify(notesLayout()));
    expect(readNotesLayout()).toEqual(notesLayout());
  });

  it("restores the stage of a saved layout", () => {
    saveNotesLayout({ ...notesLayout(), stage: "g2" });
    expect(readNotesLayout()).toEqual({ ...notesLayout(), stage: "g2" });
  });

  it("cleans unknown views out of a saved layout", () => {
    const saved = rawLayout(group("g1", [HOME_VIEW, "chat:1"], "chat:1"), { [HOME_VIEW]: home, "chat:1": { type: "chat" } });
    localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify(saved));
    expect(readNotesLayout()).toEqual({
      schema: 1,
      root: { kind: "group", id: "g1", views: [HOME_VIEW], active: HOME_VIEW },
      views: { [HOME_VIEW]: home },
      maximized: null,
    });
  });

  it("restores a layout saved before Home could open in several tabs", () => {
    const before = createLayout(
      split("s1", "row", [group("g1", [HOME_VIEW, "note:n1"], "note:n1"), group("g2", ["note:n2"])]),
      { [HOME_VIEW]: home, "note:n1": noteView("n1"), "note:n2": noteView("n2") },
      "g1",
    );
    localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify(before));
    const restored = readNotesLayout();
    expect(restored).toEqual(before);
    expect(newHomeViewId(restored)).toBe("home:2");
  });

  it("restores the extra Home tabs of a saved layout", () => {
    const saved = createLayout(split("s1", "row", [group("g1", [HOME_VIEW, "note:n1"]), group("g2", ["home:2", "home:7"], "home:7")]), {
      [HOME_VIEW]: home,
      "note:n1": noteView("n1"),
      "home:2": home,
      "home:7": home,
    });
    saveNotesLayout(saved);
    expect(readNotesLayout()).toEqual(saved);
  });

  it("gives the default layout when storage cannot be read", () => {
    localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify(notesLayout()));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    expect(readNotesLayout()).toEqual(defaultNotesLayout());
  });
});

describe("saveNotesLayout", () => {
  it("saves the layout as JSON", () => {
    saveNotesLayout(notesLayout());
    expect(JSON.parse(localStorage.getItem(NOTES_LAYOUT_KEY) ?? "null")).toEqual(notesLayout());
  });

  it("round-trips through readNotesLayout", () => {
    saveNotesLayout(notesLayout());
    expect(readNotesLayout()).toEqual(notesLayout());
  });

  it("ignores storage that cannot be written", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveNotesLayout(notesLayout())).not.toThrow();
    expect(setItem).toHaveBeenCalledOnce();
    expect(localStorage.getItem(NOTES_LAYOUT_KEY)).toBeNull();
  });
});

describe("closeSavedNoteView", () => {
  it("closes the saved tab of a note that left the library", () => {
    saveNotesLayout(notesLayout());
    closeSavedNoteView("n1");
    expect(readNotesLayout()).toEqual(closeView(notesLayout(), "note:n1"));
  });

  it("leaves the saved layout alone when the note has no tab", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    closeSavedNoteView("n9");
    saveNotesLayout(notesLayout());
    closeSavedNoteView("n9");
    expect(setItem).toHaveBeenCalledOnce();
  });
});

describe("stageGroup", () => {
  it("picks the group of the focused view", () => {
    expect(stageGroup(notesLayout(), "note:n2").id).toBe("g2");
    expect(stageGroup(notesLayout(), HOME_VIEW).id).toBe("g1");
  });

  it("ignores focus on the artifacts view", () => {
    expect(stageGroup(notesLayout(), ARTIFACTS_VIEW).id).toBe("g1");
  });

  it("prefers the stage group over the first group with Home or a note", () => {
    const layout = { ...notesLayout(), stage: "g2" };
    expect(stageGroup(layout, null).id).toBe("g2");
    expect(stageGroup(layout, ARTIFACTS_VIEW).id).toBe("g2");
    expect(stageGroup(layout, "note:closed").id).toBe("g2");
  });

  it("prefers the focused view's own group over the stage", () => {
    const layout = { ...notesLayout(), stage: "g2" };
    expect(stageGroup(layout, "note:n1").id).toBe("g1");
  });

  it("keeps using the stage after its last view closes", () => {
    const layout = createLayout(
      split("s1", "row", [group("g1", [HOME_VIEW]), group("g2", ["note:n1"])]),
      { [HOME_VIEW]: home, "note:n1": noteView("n1") },
      "g1",
    );
    const emptied = closeView(layout, HOME_VIEW);
    expect(emptied.stage).toBe("g1");
    expect(stageGroup(emptied, null)).toEqual({ kind: "group", id: "g1", views: [], active: null });
    expect(stageGroup(closeView(defaultNotesLayout(), HOME_VIEW), null).id).toBe("g1");
  });

  it("falls back when the stage names a group that is gone", () => {
    const layout = { ...notesLayout(), stage: "g9" };
    expect(stageGroup(layout, null).id).toBe("g1");
  });

  it("picks the first group with Home or a note when nothing usable is focused", () => {
    const layout = createLayout(split("s1", "row", [group("g1", [ARTIFACTS_VIEW]), group("g2", ["note:n1"]), group("g3", [HOME_VIEW])]), {
      [ARTIFACTS_VIEW]: artifacts,
      "note:n1": noteView("n1"),
      [HOME_VIEW]: home,
    });
    expect(stageGroup(layout, null).id).toBe("g2");
    expect(stageGroup(layout, "note:closed").id).toBe("g2");
    expect(stageGroup(layout, ARTIFACTS_VIEW).id).toBe("g2");
  });

  it("finds an extra Home tab as readily as a note", () => {
    const layout = createLayout(split("s1", "row", [group("g1", [ARTIFACTS_VIEW]), group("g2", ["home:2"])]), {
      [ARTIFACTS_VIEW]: artifacts,
      "home:2": home,
    });
    expect(stageGroup(layout, null).id).toBe("g2");
  });

  it("finds Home as readily as a note", () => {
    const layout = createLayout(split("s1", "column", [group("g1", [ARTIFACTS_VIEW]), group("g2", [HOME_VIEW])]), {
      [ARTIFACTS_VIEW]: artifacts,
      [HOME_VIEW]: home,
    });
    expect(stageGroup(layout, null).id).toBe("g2");
  });

  it("falls back to a group that is not only artifacts", () => {
    const layout = createLayout(split("s1", "row", [group("g1", [ARTIFACTS_VIEW]), group("g2", ["other"])]), {
      [ARTIFACTS_VIEW]: artifacts,
      other: { type: "other" },
    });
    expect(stageGroup(layout, null).id).toBe("g2");
  });

  it("falls back to the first group when every group holds only artifacts", () => {
    const layout = createLayout(group("g4", [ARTIFACTS_VIEW]), { [ARTIFACTS_VIEW]: artifacts });
    expect(stageGroup(layout, null).id).toBe("g4");
  });

  it("uses the empty root group of an empty layout", () => {
    const layout = createLayout(group("g1", []), {});
    expect(stageGroup(layout, null)).toEqual({ kind: "group", id: "g1", views: [], active: null });
  });
});

describe("openNoteViews", () => {
  it("lists the open note views across groups in layout order", () => {
    expect(openNoteViews(notesLayout())).toEqual(["note:n1", "note:n2"]);
  });

  it("lists nothing when no note is open", () => {
    expect(openNoteViews(defaultNotesLayout())).toEqual([]);
  });
});

describe("holdsNotes", () => {
  it("holds notes when a group shows a note or any Home", () => {
    expect(holdsNotes(group("g1", ["note:n1"]))).toBe(true);
    expect(holdsNotes(group("g1", [ARTIFACTS_VIEW, HOME_VIEW]))).toBe(true);
    expect(holdsNotes(group("g1", ["home:3"]))).toBe(true);
  });

  it("does not hold notes when a group shows only artifacts or nothing", () => {
    expect(holdsNotes(group("g1", [ARTIFACTS_VIEW]))).toBe(false);
    expect(holdsNotes(group("g1", []))).toBe(false);
  });
});

describe("openNoteIn", () => {
  it("opens a note at the end of the group it names", () => {
    const next = openNoteIn(notesLayout(), "n3", "g2");
    expect(groupOfView(next, "note:n3")).toMatchObject({ id: "g2", views: ["note:n2", ARTIFACTS_VIEW, "note:n3"], active: "note:n3" });
    expect(next.views["note:n3"]).toEqual(noteView("n3"));
  });

  it("opens in the stage group when no group or a missing group is named", () => {
    const layout = { ...notesLayout(), stage: "g2" };
    expect(groupOfView(openNoteIn(layout, "n3", null), "note:n3")?.id).toBe("g2");
    expect(groupOfView(openNoteIn(layout, "n3", "g9"), "note:n3")?.id).toBe("g2");
    expect(groupOfView(openNoteIn(notesLayout(), "n3", "s1"), "note:n3")?.id).toBe("g1");
  });

  it("selects a note that is already open where it is", () => {
    const next = openNoteIn(notesLayout(), "n2", "g1");
    expect(groupOfView(next, "note:n2")).toMatchObject({ id: "g2", active: "note:n2" });
    expect(groupsOf(next.root).map((candidate) => candidate.views)).toEqual(groupsOf(notesLayout().root).map((candidate) => candidate.views));
  });
});

describe("openHomeIn", () => {
  it("opens a Home view at the end of a group", () => {
    const next = openHomeIn(notesLayout(), "home:2", "g2");
    expect(groupOfView(next, "home:2")).toMatchObject({ id: "g2", views: ["note:n2", ARTIFACTS_VIEW, "home:2"], active: "home:2" });
    expect(next.views["home:2"]).toEqual(home);
  });

  it("selects a Home view that is already open", () => {
    const next = openHomeIn(notesLayout(), HOME_VIEW, "g2");
    expect(groupOfView(next, HOME_VIEW)).toMatchObject({ id: "g1", active: HOME_VIEW });
  });
});

describe("openNoteInPlace", () => {
  function homeTabs(): WorkspaceLayout {
    return createLayout(
      split("s1", "row", [group("g1", [HOME_VIEW, "note:n1", "home:2"], "home:2"), group("g2", ["note:n2"])]),
      { [HOME_VIEW]: home, "note:n1": noteView("n1"), "home:2": home, "note:n2": noteView("n2") },
      "g2",
    );
  }

  it("puts the note where the Home tab was", () => {
    const next = openNoteInPlace(homeTabs(), HOME_VIEW, "n3");
    expect(groupOfView(next, "note:n3")).toMatchObject({ id: "g1", views: ["note:n3", "note:n1", "home:2"], active: "note:n3" });
    expect(next.views).not.toHaveProperty(HOME_VIEW);
    expect(next.views["note:n3"]).toEqual(noteView("n3"));
  });

  it("replaces the last tab of a group and keeps the stage where it was", () => {
    const next = openNoteInPlace(homeTabs(), "home:2", "n3");
    expect(groupOfView(next, "note:n3")).toMatchObject({ id: "g1", views: [HOME_VIEW, "note:n1", "note:n3"], active: "note:n3" });
    expect(next.stage).toBe("g2");
  });

  it("moves a note open in the same group into the Home tab's place", () => {
    const after = openNoteInPlace(homeTabs(), HOME_VIEW, "n1");
    expect(groupOfView(after, "note:n1")).toMatchObject({ id: "g1", views: ["note:n1", "home:2"], active: "note:n1" });
    const before = openNoteInPlace(homeTabs(), "home:2", "n1");
    expect(groupOfView(before, "note:n1")).toMatchObject({ id: "g1", views: [HOME_VIEW, "note:n1"], active: "note:n1" });
  });

  it("brings a note open in another group into the Home tab's place", () => {
    const layout = { ...homeTabs(), stage: "g1" };
    const next = openNoteInPlace(layout, "home:2", "n2");
    expect(next.root).toEqual({ kind: "group", id: "g1", views: [HOME_VIEW, "note:n1", "note:n2"], active: "note:n2" });
    expect(next.views["note:n2"]).toEqual(noteView("n2"));
  });

  it("keeps the Home tab's maximized group and restores a layout that hides it", () => {
    expect(openNoteInPlace(toggleMaximize(homeTabs(), "g1"), "home:2", "n2").maximized).toBe("g1");
    expect(openNoteInPlace(toggleMaximize(homeTabs(), "g2"), "home:2", "n3").maximized).toBeNull();
  });

  it("keeps a note asked to open in its own place", () => {
    const layout = homeTabs();
    expect(openNoteInPlace(layout, "note:n1", "n1")).toBe(layout);
  });

  it("opens in the stage group when the Home tab is gone", () => {
    const next = openNoteInPlace(homeTabs(), "home:9", "n3");
    expect(groupOfView(next, "note:n3")?.id).toBe("g2");
    expect(next.views).toHaveProperty(HOME_VIEW);
    expect(next.views).toHaveProperty("home:2");
  });
});

describe("openHomeInPlace", () => {
  it("puts a new Home tab where the note was and closes the note", () => {
    const layout = notesLayout();
    const homeId = newHomeViewId(layout);
    const next = openHomeInPlace(layout, "note:n2", homeId);
    expect(groupOfView(next, homeId)).toMatchObject({ id: "g2", views: [homeId, ARTIFACTS_VIEW], active: homeId });
    expect(next.views[homeId]).toEqual(home);
    expect(next.views).not.toHaveProperty("note:n2");
    expect(groupOfView(next, HOME_VIEW)).toMatchObject({ id: "g1", views: [HOME_VIEW, "note:n1"] });
  });

  it("uses the first Home id once no Home is open", () => {
    const layout = createLayout(group("g1", ["note:n1", "note:n2"], "note:n1"), { "note:n1": noteView("n1"), "note:n2": noteView("n2") });
    const next = openHomeInPlace(layout, "note:n1", newHomeViewId(layout));
    expect(next.root).toEqual({ kind: "group", id: "g1", views: [HOME_VIEW, "note:n2"], active: HOME_VIEW });
  });

  it("opens Home in the stage group when the note's tab is gone", () => {
    const next = openHomeInPlace(notesLayout(), "note:n9", "home:2");
    expect(groupOfView(next, "home:2")?.id).toBe(stageGroup(notesLayout(), null).id);
    expect(next.views).toHaveProperty("note:n1");
    expect(next.views).toHaveProperty("note:n2");
  });
});
