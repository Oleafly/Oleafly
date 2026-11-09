// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTE_WIDTH_KEY,
  NOTE_WIDTHS,
  PROMPT_COLLAPSED_KEY,
  readPromptCollapsed,
  saveNoteWidth,
  savePromptCollapsed,
  useNoteWidth,
} from "./note-prefs";
import { useSettingsStore } from "@/store/settings";

function noteWidth() {
  return useSettingsStore.getState().notesWidth;
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ notesWidth: "standard" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("note width", () => {
  it("starts at the standard width and reads back what was saved", () => {
    expect(NOTE_WIDTHS).toEqual(["standard", "wide", "full"]);
    expect(noteWidth()).toBe("standard");
    saveNoteWidth("wide");
    expect(localStorage.getItem(NOTE_WIDTH_KEY)).toBe("wide");
    expect(noteWidth()).toBe("wide");
  });

  it("ignores a saved value it does not know", () => {
    const { result, unmount } = renderHook(() => useNoteWidth());
    act(() => saveNoteWidth("wide"));
    localStorage.setItem(NOTE_WIDTH_KEY, "huge");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: NOTE_WIDTH_KEY, newValue: "huge" }));
    });
    expect(result.current).toBe("standard");
    expect(noteWidth()).toBe("standard");
    unmount();
  });

  it("is the same width the Notes appearance setting holds", () => {
    act(() => useSettingsStore.getState().setNotesAppearance("notesWidth", "full"));
    expect(noteWidth()).toBe("full");
    saveNoteWidth("wide");
    expect(useSettingsStore.getState().notesWidth).toBe("wide");
  });

  it("follows another window even when this one cannot read storage", () => {
    const { result, unmount } = renderHook(() => useNoteWidth());
    act(() => saveNoteWidth("wide"));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: NOTE_WIDTH_KEY, newValue: "full" }));
    });
    expect(result.current).toBe("full");
    unmount();
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
      window.dispatchEvent(new StorageEvent("storage", { key: "something.else", newValue: "full" }));
    });
    expect(result.current).toBe("standard");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: NOTE_WIDTH_KEY, newValue: "wide" }));
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
    expect(noteWidth()).toBe("full");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(noteWidth()).toBe("full");
    vi.restoreAllMocks();
    saveNoteWidth("standard");
    expect(localStorage.getItem(NOTE_WIDTH_KEY)).toBe("standard");
    expect(noteWidth()).toBe("standard");
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

  it("keeps the collapsed prompt for this session when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    savePromptCollapsed(true);
    expect(readPromptCollapsed()).toBe(true);
    vi.restoreAllMocks();
    savePromptCollapsed(false);
    expect(localStorage.getItem(PROMPT_COLLAPSED_KEY)).toBe("false");
    expect(readPromptCollapsed()).toBe(false);
  });
});
