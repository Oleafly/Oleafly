import { vi } from "vitest";
import type { NotesData } from "../notes-data";

export { deferred } from "@/features/collab/tests/fixtures";

export function fakeNotesData(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
}
