// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesDataProvider, type NotesData, useNotesData } from "./notes-data";

function fakeData(): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    agents: [{ id: "acp:codex", name: "Codex", models: [{ id: "default", name: "Default model" }] }],
    citations: [],
    papers: [],
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNotesData", () => {
  it("throws when no provider supplies notes data", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useNotesData())).toThrow("useNotesData needs a NotesDataProvider");
  });

  it("returns the data the provider supplies", () => {
    const data = fakeData();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NotesDataProvider value={data}>{children}</NotesDataProvider>
    );
    const { result } = renderHook(() => useNotesData(), { wrapper });
    expect(result.current).toBe(data);
  });
});
