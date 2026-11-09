// @vitest-environment jsdom

import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_FAVORITES_KEY, setNoteFavorite, toggleNoteFavorite, useNoteFavorites } from "./note-favorites";
import { parseJson, storedValue, useStoredValue } from "./note-storage";

function Favorites() {
  const favorites = useNoteFavorites();
  return <output>{[...favorites].join(",")}</output>;
}

function favorites() {
  const { result, unmount } = renderHook(() => useNoteFavorites());
  const ids = [...result.current];
  unmount();
  return ids;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("note favorites", () => {
  it("starts empty and keeps the newest favorite first", () => {
    expect(favorites()).toEqual([]);
    setNoteFavorite("a", true);
    setNoteFavorite("b", true);
    setNoteFavorite("b", true);
    expect(favorites()).toEqual(["b", "a"]);
    expect(JSON.parse(localStorage.getItem(NOTE_FAVORITES_KEY) ?? "")).toEqual(["b", "a"]);
    toggleNoteFavorite("a");
    expect(favorites()).toEqual(["b"]);
    setNoteFavorite("a", false);
    toggleNoteFavorite("c");
    expect(favorites()).toEqual(["c", "b"]);
  });

  it("ignores stored values that are not a list of ids", () => {
    localStorage.setItem(NOTE_FAVORITES_KEY, "not json");
    expect(favorites()).toEqual([]);
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify({ a: true }));
    expect(favorites()).toEqual([]);
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["a", 3, "a", null, "b"]));
    expect(favorites()).toEqual(["a", "b"]);
  });

  it("hands out the same set until the favorites change", () => {
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["a"]));
    const { result, rerender } = renderHook(() => useNoteFavorites());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => setNoteFavorite("b", true));
    expect(result.current).not.toBe(first);
    expect([...result.current]).toEqual(["b", "a"]);
  });

  it("follows a change made in another window and ignores other keys", () => {
    render(<Favorites />);
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["x"]));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "something.else" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["y", "x"]));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: NOTE_FAVORITES_KEY }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("y,x");
    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("keeps working in memory when storage can't be used", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(favorites()).toEqual([]);
    setNoteFavorite("a", true);
    expect(favorites()).toEqual(["a"]);
    vi.restoreAllMocks();
    setNoteFavorite("a", false);
    expect(favorites()).toEqual([]);
    expect(localStorage.getItem(NOTE_FAVORITES_KEY)).toBe("[]");
  });

  it("re-renders a component that reads them", () => {
    render(<Favorites />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    act(() => setNoteFavorite("n1", true));
    expect(screen.getByRole("status")).toHaveTextContent("n1");
  });
});

describe("stored values", () => {
  it("parses JSON leniently", () => {
    expect(parseJson(null)).toBeUndefined();
    expect(parseJson("{")).toBeUndefined();
    expect(parseJson("[1]")).toEqual([1]);
  });

  it("reads through a hook and follows writes", () => {
    const store = storedValue("oleafly.test.value", (raw) => raw ?? "none", (value) => value);
    function Value() {
      return <output>{useStoredValue(store)}</output>;
    }
    render(<Value />);
    expect(screen.getByRole("status")).toHaveTextContent("none");
    act(() => store.write("set"));
    expect(screen.getByRole("status")).toHaveTextContent("set");
  });
});
