// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { artifactsForNote, NotesDataProvider, type NotesData, useNotesData } from "./notes-data";
import type { ArtifactItem } from "./types";

function artifact(id: string, noteIds: readonly string[]): ArtifactItem {
  return {
    id,
    title: `Artifact ${id}`,
    kind: "figure",
    project: "Masking",
    noteIds,
    updatedAt: 1_700_000_000_000,
    author: "agent",
    chat: "Ablation chat",
    summary: "",
  };
}

function fakeData(): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    agents: ["Codex"],
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

describe("artifactsForNote", () => {
  it("keeps only the artifacts linked to the note, in their original order", () => {
    const first = artifact("a1", ["n1"]);
    const shared = artifact("a2", ["n2", "n1"]);
    const other = artifact("a3", ["n2"]);
    const orphan = artifact("a4", []);
    expect(artifactsForNote([first, shared, other, orphan], "n1")).toEqual([first, shared]);
    expect(artifactsForNote([first, shared, other, orphan], "n3")).toEqual([]);
  });
});
