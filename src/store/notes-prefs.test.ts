// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLUMN_LIMIT, DEFAULT_TABLE_SORT, GROUP_LIMIT, NOTES_PREFS_KEY, OPENED_LIMIT, useNoteFavorites, useNotesPrefsStore } from "./notes-prefs";

const initial = useNotesPrefsStore.getState();

function stored(): Record<string, unknown> {
  return (JSON.parse(localStorage.getItem(NOTES_PREFS_KEY) ?? "{}") as { state: Record<string, unknown> }).state;
}

async function reload(state: unknown): Promise<void> {
  localStorage.setItem(NOTES_PREFS_KEY, typeof state === "string" ? state : JSON.stringify({ state, version: 1 }));
  await useNotesPrefsStore.persist.rehydrate();
}

beforeEach(() => {
  localStorage.clear();
  useNotesPrefsStore.setState(initial, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notes preferences", () => {
  it("starts with Home sorted by last opened in a grid, the prompt open and the sections under a note shown", () => {
    expect(useNotesPrefsStore.getState()).toMatchObject({
      homeSort: "opened",
      homeLayout: "grid",
      tableSort: DEFAULT_TABLE_SORT,
      promptCollapsed: false,
      propertiesOpen: true,
      mentionsOpen: true,
      backlinksOpen: true,
      referencesOpen: true,
      deadLinksOpen: true,
      attachmentsOpen: true,
      filtersOpen: false,
    });
  });

  it("remembers what was chosen under one key", () => {
    const { set } = useNotesPrefsStore.getState();
    set("homeSort", "title");
    set("tableColumns", ["status", "status", "owner"]);
    set("propertyTypes", { rank: "number" });
    expect(stored()).toMatchObject({ homeSort: "title", tableColumns: ["status", "owner"], propertyTypes: { rank: "number" } });
  });

  it("ignores stored values it can't read", async () => {
    await reload({
      homeSort: "size",
      homeLayout: "cards",
      tableColumns: "x",
      tableSort: { key: "", descending: true },
      opened: { a: "soon", b: 3 },
      favorites: [1, "n1", "n1"],
      propertyTypes: { rank: "number", bad: "nonsense" },
      models: { last: "x", notes: { n1: { providerId: "p" } } },
      mentionsOpen: "no",
      backlinksOpen: 0,
      referencesOpen: null,
      deadLinksOpen: "folded",
      attachmentsOpen: 1,
    });
    expect(useNotesPrefsStore.getState()).toMatchObject({
      homeSort: "opened",
      homeLayout: "grid",
      tableColumns: [],
      tableSort: DEFAULT_TABLE_SORT,
      opened: { b: 3 },
      favorites: ["n1"],
      propertyTypes: { rank: "number" },
      models: { last: null, notes: {} },
      mentionsOpen: true,
      backlinksOpen: true,
      referencesOpen: true,
      deadLinksOpen: true,
      attachmentsOpen: true,
    });
    await reload("{");
    expect(useNotesPrefsStore.getState().homeSort).toBe("opened");
  });

  it("keeps the newest opened notes, the first columns and the newest favorite first", () => {
    const state = useNotesPrefsStore.getState();
    for (let index = 0; index <= OPENED_LIMIT; index += 1) state.recordOpened(`n${index}`, index);
    const opened = useNotesPrefsStore.getState().opened;
    expect(Object.keys(opened)).toHaveLength(OPENED_LIMIT);
    expect(opened.n0).toBeUndefined();
    state.set("tableColumns", Array.from({ length: COLUMN_LIMIT + 3 }, (_, index) => `c${index}`));
    expect(useNotesPrefsStore.getState().tableColumns).toHaveLength(COLUMN_LIMIT);
    state.toggleFavorite("a");
    state.toggleFavorite("b");
    state.toggleFavorite("a", true);
    expect(useNotesPrefsStore.getState().favorites).toEqual(["b", "a"]);
    state.toggleFavorite("b");
    expect(useNotesPrefsStore.getState().favorites).toEqual(["a"]);
  });

  it("remembers folded References, Linked from, Mentioned in, Dead links and Attachments sections after a restart", async () => {
    const folded = { referencesOpen: false, backlinksOpen: false, mentionsOpen: false, deadLinksOpen: false, attachmentsOpen: false } as const;
    for (const key of Object.keys(folded) as (keyof typeof folded)[]) useNotesPrefsStore.getState().set(key, false);
    const saved = stored();
    expect(saved).toMatchObject(folded);
    useNotesPrefsStore.setState(initial, true);
    expect(useNotesPrefsStore.getState()).toMatchObject({
      referencesOpen: true,
      backlinksOpen: true,
      mentionsOpen: true,
      deadLinksOpen: true,
      attachmentsOpen: true,
    });
    await reload(saved);
    expect(useNotesPrefsStore.getState()).toMatchObject(folded);
  });

  it("keeps the newest closed groups", () => {
    const keys = Array.from({ length: GROUP_LIMIT + 2 }, (_, index) => `g${index}`);
    useNotesPrefsStore.getState().set("closedGroups", keys);
    const closed = useNotesPrefsStore.getState().closedGroups;
    expect(closed).toHaveLength(GROUP_LIMIT);
    expect(closed[0]).toBe("g2");
    expect(closed.at(-1)).toBe(`g${GROUP_LIMIT + 1}`);
  });

  it("hands out the same favorites set until the favorites change", () => {
    const { result } = renderHook(() => useNoteFavorites());
    const first = result.current;
    act(() => useNotesPrefsStore.getState().set("homeSort", "title"));
    expect(result.current).toBe(first);
    act(() => useNotesPrefsStore.getState().toggleFavorite("n1"));
    expect([...result.current]).toEqual(["n1"]);
  });

  it("keeps working for this session when storage can't be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => useNotesPrefsStore.getState().set("promptCollapsed", true)).not.toThrow();
    expect(useNotesPrefsStore.getState().promptCollapsed).toBe(true);
  });
});
