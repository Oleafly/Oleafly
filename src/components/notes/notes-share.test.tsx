// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";

vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));

import { NoteCard, NoteListRow } from "./NoteCard";
import { useNoteActions } from "./note-actions";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NotesLibrary } from "./NotesLibrary";
import type { NoteItem } from "./types";

const SHARED: NoteItem = { id: "n1", title: "Shared lab log", project: "Lab", updatedAt: Date.now(), author: "you", summary: "", shared: true };
const PRIVATE: NoteItem = { id: "n2", title: "Private draft", project: "Lab", updatedAt: Date.now(), author: "you", summary: "" };

function data(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes: [SHARED, PRIVATE],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
}

function library(value: NotesData) {
  return render(
    <NotesDataProvider value={value}>
      <NotesLibrary
        iconFor={() => undefined}
        activeNoteId={null}
        activeArtifactId={null}
        onHome={vi.fn()}
        onOpenNote={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    </NotesDataProvider>,
  );
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest("[data-note-row]");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${title}`);
  return row;
}

function Cards({ value }: Readonly<{ value: NotesData }>) {
  return (
    <NotesDataProvider value={value}>
      <CardList />
    </NotesDataProvider>
  );
}

function CardList() {
  const { actionsFor } = useNoteActions();
  return (
    <>
      <NoteCard note={SHARED} icon={undefined} actions={actionsFor(SHARED)} projectColor={null} onOpen={vi.fn()} />
      <NoteListRow
        note={PRIVATE}
        icon={undefined}
        actions={actionsFor(PRIVATE)}
        projectColor={null}
        onOpen={vi.fn()}
        when={{ edited: "now", created: "now", opened: null }}
        sorted={null}
      />
    </>
  );
}

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("sharing notes from the sidebar and Home", () => {
  it("marks shared notes in the sidebar", () => {
    library(data());
    expect(within(rowOf("Shared lab log")).getByRole("img", { name: "Shared" })).toBeInTheDocument();
    expect(within(rowOf("Private draft")).queryByRole("img", { name: "Shared" })).toBeNull();
  });

  it("shares a note from its sidebar menu", () => {
    const shareNote = vi.fn();
    library(data({ shareNote }));
    fireEvent.contextMenu(rowOf("Private draft"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Share" }));
    expect(shareNote).toHaveBeenCalledWith("n2");
  });

  it("marks shared cards and shares from the card menu", () => {
    const shareNote = vi.fn();
    const { container } = render(<Cards value={data({ shareNote })} />);
    const card = container.querySelector('[data-note-card="n1"]') as HTMLElement;
    expect(within(card).getByRole("img", { name: "Shared" })).toBeInTheDocument();
    const listRow = container.querySelector('[data-note-list-row="n2"]') as HTMLElement;
    expect(within(listRow).queryByRole("img", { name: "Shared" })).toBeNull();
    fireEvent.contextMenu(card);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Share" }));
    expect(shareNote).toHaveBeenCalledWith("n1");
  });

  it("leaves Share out when sharing is not available", () => {
    const { container } = render(<Cards value={data()} />);
    fireEvent.contextMenu(container.querySelector('[data-note-card="n1"]') as HTMLElement);
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Share" })).toBeNull();
  });
});
