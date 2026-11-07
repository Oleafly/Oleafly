// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTE_WIDTH_KEY,
  NOTE_WIDTHS,
  PROMPT_COLLAPSED_KEY,
  readNoteWidth,
  readPromptCollapsed,
  saveNoteWidth,
  savePromptCollapsed,
  useNoteWidth,
} from "./note-prefs";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("note width", () => {
  it("starts at the standard width and reads back what was saved", () => {
    expect(NOTE_WIDTHS).toEqual(["standard", "wide", "full"]);
    expect(readNoteWidth()).toBe("standard");
    saveNoteWidth("wide");
    expect(localStorage.getItem(NOTE_WIDTH_KEY)).toBe("wide");
    expect(readNoteWidth()).toBe("wide");
  });

  it("ignores a saved value it does not know", () => {
    localStorage.setItem(NOTE_WIDTH_KEY, "huge");
    expect(readNoteWidth()).toBe("standard");
  });

  it("updates every open note when one of them changes the width", () => {
    const first = renderHook(() => useNoteWidth());
    const second = renderHook(() => useNoteWidth());
    expect(first.result.current).toBe("standard");
    act(() => saveNoteWidth("full"));
    expect(first.result.current).toBe("full");
    expect(second.result.current).toBe("full");
    first.unmount();
    act(() => saveNoteWidth("wide"));
    expect(second.result.current).toBe("wide");
    second.unmount();
  });

  it("follows a change made in another window and ignores other keys", () => {
    const { result, unmount } = renderHook(() => useNoteWidth());
    localStorage.setItem(NOTE_WIDTH_KEY, "wide");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "something.else" }));
    });
    expect(result.current).toBe("standard");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: NOTE_WIDTH_KEY }));
    });
    expect(result.current).toBe("wide");
    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current).toBe("standard");
    unmount();
  });

  it("keeps the width for this session when storage cannot be written or read", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveNoteWidth("full");
    expect(readNoteWidth()).toBe("full");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readNoteWidth()).toBe("full");
    vi.restoreAllMocks();
    saveNoteWidth("standard");
    expect(localStorage.getItem(NOTE_WIDTH_KEY)).toBe("standard");
    expect(readNoteWidth()).toBe("standard");
  });

  it("reads nothing when storage cannot be read and nothing was kept", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPromptCollapsed()).toBe(false);
  });
});

describe("prompt collapse", () => {
  it("starts open and remembers being collapsed", () => {
    expect(readPromptCollapsed()).toBe(false);
    savePromptCollapsed(true);
    expect(localStorage.getItem(PROMPT_COLLAPSED_KEY)).toBe("true");
    expect(readPromptCollapsed()).toBe(true);
    savePromptCollapsed(false);
    expect(readPromptCollapsed()).toBe(false);
  });
});
