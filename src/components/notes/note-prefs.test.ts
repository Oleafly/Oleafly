// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_WIDTH_KEY, saveNoteWidth, useNoteWidth } from "./note-prefs";
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
  it("saves the width to the Notes appearance setting", () => {
    expect(noteWidth()).toBe("standard");
    saveNoteWidth("wide");
    expect(localStorage.getItem(NOTE_WIDTH_KEY)).toBe("wide");
    expect(noteWidth()).toBe("wide");
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

  it("keeps the width for this session when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveNoteWidth("full");
    expect(noteWidth()).toBe("full");
  });
});
