// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { useComposerDrafts } from "@/store/composer-drafts";
import { useProjectColorsStore } from "@/store/project-colors";
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
  { projectId: "p-vision", project: "Vision", tasks: 3, figures: 1, reports: 2, updatedAt: NOW - HOUR, noteId: "n1" },
  { projectId: "p-language", project: "Language", tasks: 1, figures: 0, reports: 1, updatedAt: NOW - 2 * HOUR, noteId: "n2" },
];

function artifact(overrides: Partial<ArtifactItem> & Pick<ArtifactItem, "id" | "title" | "kind" | "path">): ArtifactItem {
  return {
    taskId: "t1",
    projectId: "p-vision",
    project: "Vision",
    updatedAt: NOW - HOUR,
    agent: "Codex",
    chat: "Ablation chat",
    summary: "",
    ...overrides,
  };
}

const artifacts: ArtifactItem[] = [
  artifact({ id: "a1", title: "Loss curve", kind: "figure", path: "figures/loss.png" }),
  artifact({ id: "a2", title: "Metrics table", kind: "data", path: "metrics.csv", agent: undefined }),
  artifact({ id: "a3", title: "Checkpoint", kind: "file", path: "model.ckpt" }),
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
  useProjectColorsStore.setState({ colors: {} });
});

describe("NotesHome", () => {
  it("fills its view with the note background and scrolls on its own", () => {
    renderHome(fakeData());
    const root = screen.getByRole("heading", { name: copy.title }).closest(".overflow-y-auto");
    expect(root).toHaveClass("flex-1", "min-h-0", "bg-background");
    expect(root?.className).not.toContain("home-background");
  });

  it("shows only the title when there is nothing to list", () => {
    renderHome(fakeData());
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(screen.queryByText(copy.experiments)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.recentNotes)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.recentArtifacts)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: copy.composerLabel })).not.toBeInTheDocument();
  });

  it("lists experiments with their task, figure and report counts", async () => {
    const user = userEvent.setup();
    const handlers = renderHome(fakeData({ experiments }));
    expect(screen.getByText(copy.experiments)).toBeInTheDocument();
    expect(card("Vision")).toHaveTextContent(`3 tasks · 1 figure · 2 reports · ${ago(experiments[0].updatedAt)}`);
    expect(card("Language")).toHaveTextContent(`1 task · 0 figures · 1 report · ${ago(experiments[1].updatedAt)}`);
    await user.click(card("Vision"));
    expect(handlers.onOpenNote).toHaveBeenCalledWith("n1");
    await user.click(card("Language"));
    expect(handlers.onOpenNote).toHaveBeenLastCalledWith("n2");
  });

  it("keeps one card per project even when two projects share a name", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHome(
      fakeData({
        experiments: [experiments[0], { ...experiments[1], project: "Vision", noteId: "n3" }],
      }),
    );
    expect(screen.getAllByText("Vision")).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
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
    expect(card("Loss curve").querySelector("svg")).toHaveClass("lucide-image");
    expect(card("Metrics table")).toHaveTextContent(enNotes.artifacts.kind.data);
    expect(card("Metrics table").querySelector("svg")).toHaveClass("lucide-database");
    expect(card("Checkpoint")).toHaveTextContent(enNotes.artifacts.kind.file);
    expect(card("Checkpoint").querySelector("svg")).toHaveClass("lucide-file");
    await user.click(card("Metrics table"));
    expect(handlers.onOpenArtifact).toHaveBeenCalledWith(artifacts[1]);
  });

  it("tints each experiment card with its project's colour", () => {
    useProjectColorsStore.setState({ colors: { "p-vision": "#cfbaf0", "p-language": "#98f5e1" } });
    renderHome(fakeData({ experiments }));
    expect(card("Vision")).toHaveClass("note-project-card");
    expect(card("Vision")).toHaveAttribute("data-project-color", "#cfbaf0");
    expect(card("Vision").style.getPropertyValue("--note-project")).toBe("#cfbaf0");
    expect(card("Language").style.getPropertyValue("--note-project")).toBe("#98f5e1");
    expect(card("Vision").querySelector(".note-project-chip svg")).toHaveClass("lucide-flask-conical");
  });

  it("leaves an experiment card neutral when it has no project id to colour it by", () => {
    renderHome(fakeData({ experiments: [{ ...experiments[0], projectId: "" }] }));
    expect(card("Vision")).not.toHaveClass("note-project-card");
    expect(card("Vision")).toHaveAttribute("data-project-color", "none");
    expect(card("Vision").querySelector("svg")?.parentElement).toHaveClass("bg-muted", "text-muted-foreground");
  });

  it("marks a note card with its project's colour and leaves a loose note neutral", () => {
    useProjectColorsStore.setState({ colors: { "p-vision": "#cfbaf0" } });
    renderHome(fakeData({ notes: [{ ...notes[0], relatedProjectId: "p-vision" }, notes[1]] }));
    expect(card("Masking ablation")).toHaveClass("note-project-accent");
    expect(card("Masking ablation")).toHaveAttribute("data-project-color", "#cfbaf0");
    expect(card("Reading list")).not.toHaveClass("note-project-accent");
    expect(card("Reading list")).toHaveAttribute("data-project-color", "none");
    expect(card("Reading list").style.getPropertyValue("--note-project")).toBe("");
  });

  it("puts each note's icon in a circle tinted with the note's own colour and tags agent notes", () => {
    renderHome(fakeData({ notes: [notes[0], { ...notes[1], color: "teal" }] }));
    const circle = screen.getByText("🧪").parentElement;
    expect(circle).toHaveAttribute("data-note-color", "violet");
    expect(circle).toHaveClass("rounded-full", "bg-violet-500/10");
    expect(within(card("Masking ablation")).getByText("Codex").closest("[data-agent-tag]")).toBeInTheDocument();
    expect(card("Reading list").querySelector("[data-agent-tag]")).toBeNull();
    expect(card("Reading list").querySelector("[data-note-color]")).toHaveAttribute("data-note-color", "teal");
    expect(card("Reading list").querySelector("[data-note-color] svg")).toHaveClass("lucide-notebook-pen", "text-teal-600");
  });

  it("shows each artifact's kind as a tinted chip with its project", () => {
    useProjectColorsStore.setState({ colors: { "p-vision": "#cfbaf0" } });
    renderHome(fakeData({ artifacts }));
    const chip = within(card("Metrics table")).getByText(enNotes.artifacts.kind.data);
    expect(chip).toHaveAttribute("data-kind", "data");
    expect(chip).toHaveClass("bg-emerald-500/10");
    expect(within(card("Loss curve")).getByText(enNotes.artifacts.kind.figure)).toHaveClass("bg-pink-500/10");
    expect(card("Loss curve")).toHaveTextContent("Vision");
    expect(card("Loss curve").querySelector("[data-project-color]")).toHaveAttribute("data-project-color", "#cfbaf0");
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
