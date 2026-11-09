// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { noteLookSignature, useNotesByLook } from "./note-signature";
import type { NoteItem } from "./types";

function note(id: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title: `Note ${id}`, project: "Vision", updatedAt: 1, author: "you", summary: "", ...extra };
}

describe("useNotesByLook", () => {
  it("keeps the same notes list while only saves change what a note says", () => {
    const first = [note("a"), note("b", { icon: "🧠", color: "mint", aliases: ["B"] })];
    const { result, rerender } = renderHook(({ notes }) => useNotesByLook(notes), { initialProps: { notes: first } });
    expect(result.current).toBe(first);
    rerender({ notes: first.map((item) => ({ ...item, summary: "saved", updatedAt: 2, preview: "new text" })) });
    expect(result.current).toBe(first);
  });

  it("hands over the new list once a title, icon, colour, alias or the set of notes changes", () => {
    const first = [note("a"), note("b")];
    const { result, rerender } = renderHook(({ notes }) => useNotesByLook(notes), { initialProps: { notes: first } });
    const changes: NoteItem[][] = [
      [note("a", { title: "Renamed" }), note("b")],
      [note("a", { title: "Renamed", icon: "🧪" }), note("b")],
      [note("a", { title: "Renamed", icon: "🧪", color: "rose" }), note("b")],
      [note("a", { title: "Renamed", icon: "🧪", color: "rose", aliases: ["A"] }), note("b")],
      [note("a", { title: "Renamed", icon: "🧪", color: "rose", aliases: ["A"] })],
    ];
    for (const next of changes) {
      rerender({ notes: next });
      expect(result.current).toBe(next);
    }
  });

  it("tells apart titles that only differ where the fields meet", () => {
    expect(noteLookSignature([note("a", { title: "x", icon: "y" })])).not.toBe(noteLookSignature([note("a", { title: "xy" })]));
  });
});
