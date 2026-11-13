// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import "./tests/setup";

import { NoteCard } from "./NoteCard";
import type { NoteActions } from "./note-actions";
import type { NoteItem } from "./types";

const menu = enNotes.library.menu;
const NOTE: NoteItem = { id: "n1", title: "Lab log", project: "Lab", updatedAt: 0, author: "you", summary: "" };

function card(on: boolean): HTMLElement {
  const actions: NoteActions = { favorite: { on, toggle: vi.fn() } };
  const { container } = render(<NoteCard note={NOTE} icon={undefined} actions={actions} projectColor={null} onOpen={vi.fn()} />);
  return container.querySelector('[data-note-card="n1"]') as HTMLElement;
}

function shownAtRest(button: HTMLElement): boolean {
  return !button.classList.contains("hidden");
}

describe("NoteCard corner buttons", () => {
  it("keeps a bookmarked note's filled bookmark on the card at rest, and More only on hover or focus", () => {
    const view = card(true);
    const bookmark = within(view).getByRole("button", { name: menu.unfavorite });
    const more = within(view).getByRole("button", { name: menu.more });
    expect(shownAtRest(bookmark)).toBe(true);
    const corner = bookmark.closest(".ml-auto") as HTMLElement;
    expect(corner).toHaveClass("flex");
    expect(shownAtRest(corner)).toBe(true);
    expect(shownAtRest(more)).toBe(false);
    expect(more).toHaveClass("group-hover/card:inline-flex", "group-focus-within/card:inline-flex");
  });

  it("shows the empty bookmark only on hover or focus", () => {
    const bookmark = within(card(false)).getByRole("button", { name: menu.favorite });
    expect(shownAtRest(bookmark)).toBe(false);
    expect(bookmark).toHaveClass("group-hover/card:inline-flex", "group-focus-within/card:inline-flex");
  });

  it("puts the card's open button before the corner buttons, so forward Tab reaches them next", () => {
    const view = card(false);
    const open = view.querySelector("[data-card-open]") as HTMLElement;
    for (const name of [menu.favorite, menu.more]) {
      const button = within(view).getByRole("button", { name });
      expect(open.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING, name).toBeTruthy();
    }
  });
});
