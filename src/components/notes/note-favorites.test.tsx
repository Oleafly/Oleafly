// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTE_FAVORITES_KEY,
  readNoteFavorites,
  setNoteFavorite,
  subscribeNoteFavorites,
  toggleNoteFavorite,
  useNoteFavorites,
} from "./note-favorites";
import { parseJson, storedValue, useStoredValue } from "./note-storage";

function Favorites() {
  const favorites = useNoteFavorites();
  return <output>{[...favorites].join(",")}</output>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("note favorites", () => {
  it("starts empty and keeps the newest favorite first", () => {
    expect(readNoteFavorites()).toEqual([]);
    setNoteFavorite("a", true);
    setNoteFavorite("b", true);
    setNoteFavorite("b", true);
    expect(readNoteFavorites()).toEqual(["b", "a"]);
    expect(JSON.parse(localStorage.getItem(NOTE_FAVORITES_KEY) ?? "")).toEqual(["b", "a"]);
    toggleNoteFavorite("a");
    expect(readNoteFavorites()).toEqual(["b"]);
    setNoteFavorite("a", false);
    toggleNoteFavorite("c");
    expect(readNoteFavorites()).toEqual(["c", "b"]);
  });

  it("ignores stored values that are not a list of ids", () => {
    localStorage.setItem(NOTE_FAVORITES_KEY, "not json");
    expect(readNoteFavorites()).toEqual([]);
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify({ a: true }));
    expect(readNoteFavorites()).toEqual([]);
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["a", 3, "a", null, "b"]));
    expect(readNoteFavorites()).toEqual(["a", "b"]);
  });

  it("hands out the same list until it changes", () => {
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["a"]));
    expect(readNoteFavorites()).toBe(readNoteFavorites());
  });

  it("tells every subscriber, including other windows, and stops when unsubscribed", () => {
    const listener = vi.fn();
    const stop = subscribeNoteFavorites(listener);
    setNoteFavorite("a", true);
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: NOTE_FAVORITES_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    window.dispatchEvent(new StorageEvent("storage", { key: "something.else" }));
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    setNoteFavorite("b", true);
    window.dispatchEvent(new StorageEvent("storage", { key: NOTE_FAVORITES_KEY }));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps working in memory when storage can't be used", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readNoteFavorites()).toEqual([]);
    setNoteFavorite("a", true);
    expect(readNoteFavorites()).toEqual(["a"]);
    vi.restoreAllMocks();
    setNoteFavorite("a", false);
    expect(readNoteFavorites()).toEqual([]);
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
