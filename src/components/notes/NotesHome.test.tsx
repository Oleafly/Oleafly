// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { useComposerDrafts } from "@/store/composer-drafts";
import { NotesHome } from "./NotesHome";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ArtifactItem, ExperimentItem, NoteItem } from "./types";

const copy = enNotes.home;
const NOW = Date.now();
const HOUR = 3_600_000;

const notes: NoteItem[] = [
  {
    id: "n1",
    title: "Masking ablation",
    project: "Vision",
    updatedAt: NOW - HOUR,
    author: "agent",
    agent: "Codex",
    icon: "🧪",
    summary: "Masking ratio sweep across three seeds",
  },
  {
    id: "n2",
    title: "Reading list",
    project: "Language",
    updatedAt: NOW - 2 * HOUR,
    author: "you",
    summary: "Papers to read this week",
  },
];

const experiments: ExperimentItem[] = [
  { project: "Vision", runs: 3, figures: 1, reports: 2, updatedAt: NOW - HOUR, noteId: "n1" },
];

const artifacts: ArtifactItem[] = [
  {
    id: "a1",
    title: "Loss curve",
    kind: "figure",
    project: "Vision",
    noteIds: ["n1"],
    updatedAt: NOW - HOUR,
    author: "agent",
    agent: "Codex",
    chat: "Ablation chat",
    summary: "",
  },
  {
    id: "a2",
    title: "Run 42",
    kind: "run",
    project: "Vision",
    noteIds: ["n1"],
    updatedAt: NOW - HOUR,
    author: "agent",
    chat: "Ablation chat",
    summary: "",
  },
];

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    agents: [],
    citations: [],
    papers: [],
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
}

function renderHome(data: NotesData, onStartNote?: (prompt: string) => void) {
  const handlers = {
    onOpenNote: vi.fn(),
    onOpenArtifact: vi.fn(),
    iconFor: vi.fn((note: NoteItem) => note.icon),
  };
  render(
    <NotesDataProvider value={data}>
      <NotesHome
        iconFor={handlers.iconFor}
        onOpenNote={handlers.onOpenNote}
        onOpenArtifact={handlers.onOpenArtifact}
        onStartNote={onStartNote}
      />
    </NotesDataProvider>,
  );
  return handlers;
}

function card(text: string): HTMLElement {
  const match = screen.getByText(text).closest("button");
  if (!match) throw new Error(`no card for ${text}`);
  return match;
}

function ago(timestamp: number): string {
  return formatRelativeTimeFrom(timestamp, Date.now(), { dateAfterDays: 7 });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  localStorage.clear();
  useComposerDrafts.setState({ drafts: {} });
});

describe("NotesHome", () => {
  it("shows only the title when there is nothing to list", () => {
    renderHome(fakeData());
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(screen.queryByText(copy.experiments)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.recentNotes)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.recentArtifacts)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: copy.composerLabel })).not.toBeInTheDocument();
  });

  it("lists experiments with their run, figure and report counts", async () => {
    const user = userEvent.setup();
    const handlers = renderHome(fakeData({ experiments }));
    expect(screen.getByText(copy.experiments)).toBeInTheDocument();
    const experiment = screen.getByText("3 runs · 1 figure · 2 reports", { exact: false }).closest("button");
    expect(experiment).toHaveTextContent(`3 runs · 1 figure · 2 reports · ${ago(experiments[0].updatedAt)}`);
    await user.click(experiment as HTMLElement);
    expect(handlers.onOpenNote).toHaveBeenCalledWith("n1");
  });

  it("lists recent notes with their summary and author", async () => {
    const user = userEvent.setup();
    const handlers = renderHome(fakeData({ notes }));
    expect(screen.getByText(copy.recentNotes)).toBeInTheDocument();
    expect(card("Masking ablation")).toHaveTextContent("Masking ratio sweep across three seeds");
    expect(card("Masking ablation")).toHaveTextContent(`Codex · ${ago(notes[0].updatedAt)}`);
    expect(card("Reading list")).toHaveTextContent(`${enNotes.library.author.you} · ${ago(notes[1].updatedAt)}`);
    expect(card("Masking ablation")).toHaveTextContent("🧪");
    expect(handlers.iconFor).toHaveBeenCalledWith(notes[0]);
    await user.click(card("Reading list"));
    expect(handlers.onOpenNote).toHaveBeenCalledWith("n2");
  });

  it("credits an unnamed agent as an agent, not as you", () => {
    renderHome(fakeData({ notes: [{ ...notes[0], title: "Unnamed agent note", agent: undefined }] }));
    expect(card("Unnamed agent note")).toHaveTextContent(`${enNotes.library.agentFallback} · `);
  });

  it("lists recent artifacts by kind and opens them", async () => {
    const user = userEvent.setup();
    const handlers = renderHome(fakeData({ artifacts }));
    expect(screen.getByText(copy.recentArtifacts)).toBeInTheDocument();
    expect(card("Loss curve")).toHaveTextContent(enNotes.artifacts.kind.figure);
    expect(card("Run 42")).toHaveTextContent(enNotes.artifacts.kind.run);
    await user.click(card("Run 42"));
    expect(handlers.onOpenArtifact).toHaveBeenCalledWith(artifacts[1]);
  });

  it("starts a note from the composer with the trimmed prompt and clears it", async () => {
    const user = userEvent.setup();
    const onStartNote = vi.fn();
    renderHome(fakeData(), onStartNote);
    const composer = screen.getByRole("combobox", { name: copy.composerLabel });
    expect(composer).toHaveAttribute("placeholder", copy.composerPlaceholder);
    await user.type(composer, "  write up run 42  ");
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(onStartNote).toHaveBeenCalledWith("write up run 42");
    expect(composer).toHaveValue("");
  });
});
