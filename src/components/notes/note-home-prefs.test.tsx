// @vitest-environment jsdom

import { render, renderHook, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  COLUMN_LIMIT,
  DEFAULT_TABLE_SORT,
  NOTE_HOME_COLUMNS_KEY,
  NOTE_HOME_LAYOUT_KEY,
  NOTE_HOME_SORT_KEY,
  NOTE_HOME_TABLE_SORT_KEY,
  saveTableColumns,
  saveTableSort,
  useTableColumns,
  useTableSort,
  NOTE_OPENED_KEY,
  OPENED_LIMIT,
  recordNoteOpened,
  saveHomeLayout,
  saveHomeSort,
  useHomeLayout,
  useHomeSort,
  useNoteOpenedTimes,
  useRecordNoteOpened,
} from "./note-home-prefs";

function opened(): Record<string, number> {
  return JSON.parse(localStorage.getItem(NOTE_OPENED_KEY) ?? "{}") as Record<string, number>;
}

beforeEach(() => {
  localStorage.clear();
});

describe("Home preferences", () => {
  it("sorts by last opened in a grid until told otherwise, and remembers both", () => {
    const sort = renderHook(() => useHomeSort());
    const layout = renderHook(() => useHomeLayout());
    expect(sort.result.current).toBe("opened");
    expect(layout.result.current).toBe("grid");
    act(() => {
      saveHomeSort("title");
      saveHomeLayout("list");
    });
    expect(sort.result.current).toBe("title");
    expect(layout.result.current).toBe("list");
    expect(localStorage.getItem(NOTE_HOME_SORT_KEY)).toBe("title");
    expect(localStorage.getItem(NOTE_HOME_LAYOUT_KEY)).toBe("list");
  });

  it("ignores stored values it doesn't know", () => {
    localStorage.setItem(NOTE_HOME_SORT_KEY, "size");
    localStorage.setItem(NOTE_HOME_LAYOUT_KEY, "columns");
    expect(renderHook(() => useHomeSort()).result.current).toBe("opened");
    expect(renderHook(() => useHomeLayout()).result.current).toBe("grid");
  });

  it("records when a note opens, newest first, and keeps the list bounded", () => {
    recordNoteOpened("a", 10);
    recordNoteOpened("b", 20);
    recordNoteOpened("a", 30);
    expect(opened()).toEqual({ a: 30, b: 20 });
    for (let index = 0; index < OPENED_LIMIT + 5; index++) recordNoteOpened(`n${index}`, 100 + index);
    const kept = opened();
    expect(Object.keys(kept)).toHaveLength(OPENED_LIMIT);
    expect(kept.a).toBeUndefined();
    expect(kept[`n${OPENED_LIMIT + 4}`]).toBe(100 + OPENED_LIMIT + 4);
  });

  it("drops open times that are not numbers", () => {
    localStorage.setItem(NOTE_OPENED_KEY, JSON.stringify({ a: 5, b: "x", c: null }));
    expect(renderHook(() => useNoteOpenedTimes()).result.current).toEqual({ a: 5 });
    localStorage.setItem(NOTE_OPENED_KEY, JSON.stringify([1, 2]));
    expect(renderHook(() => useNoteOpenedTimes()).result.current).toEqual({});
    localStorage.setItem(NOTE_OPENED_KEY, "null");
    expect(renderHook(() => useNoteOpenedTimes()).result.current).toEqual({});
  });

  it("stamps a note each time it becomes the one in front, and nothing when none is", () => {
    function Opener({ id }: Readonly<{ id: string | null }>) {
      useRecordNoteOpened(id);
      return <output>{Object.keys(useNoteOpenedTimes()).join(",")}</output>;
    }
    const view = render(<Opener id={null} />);
    expect(localStorage.getItem(NOTE_OPENED_KEY)).toBeNull();
    view.rerender(<Opener id="n1" />);
    expect(screen.getByRole("status")).toHaveTextContent("n1");
    view.rerender(<Opener id="n2" />);
    expect(Object.keys(opened()).sort()).toEqual(["n1", "n2"]);
  });
});

describe("table preferences", () => {
  it("remembers the table layout, its columns and its sort", () => {
    localStorage.setItem(NOTE_HOME_LAYOUT_KEY, "table");
    expect(renderHook(() => useHomeLayout()).result.current).toBe("table");
    const columns = renderHook(() => useTableColumns());
    const sort = renderHook(() => useTableSort());
    expect(columns.result.current).toEqual([]);
    expect(sort.result.current).toEqual(DEFAULT_TABLE_SORT);
    act(() => {
      saveTableColumns(["venue", "venue", ...Array.from({ length: COLUMN_LIMIT + 2 }, (_, index) => `k${index}`)]);
      saveTableSort({ key: "title", descending: false });
    });
    expect(columns.result.current).toHaveLength(COLUMN_LIMIT);
    expect(columns.result.current[0]).toBe("venue");
    expect(sort.result.current).toEqual({ key: "title", descending: false });
  });

  it("ignores saved columns and sorts it can't read", () => {
    for (const raw of ["{bad", '"text"', '{"key":"","descending":true}', '{"key":"x"}', "null"]) {
      localStorage.setItem(NOTE_HOME_TABLE_SORT_KEY, raw);
      expect(renderHook(() => useTableSort()).result.current).toEqual(DEFAULT_TABLE_SORT);
    }
    localStorage.setItem(NOTE_HOME_COLUMNS_KEY, JSON.stringify(["a", 3, "", " ", "a", "b"]));
    expect(renderHook(() => useTableColumns()).result.current).toEqual(["a", "b"]);
    localStorage.setItem(NOTE_HOME_COLUMNS_KEY, JSON.stringify({ a: 1 }));
    expect(renderHook(() => useTableColumns()).result.current).toEqual([]);
  });
});
