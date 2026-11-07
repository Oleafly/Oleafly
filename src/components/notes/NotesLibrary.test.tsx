// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";

const env = vi.hoisted(() => ({ mac: false, fullscreen: false }));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    get isMac() {
      return env.mac;
    },
  };
});
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => env.fullscreen }));

import { NotesLibrary } from "./NotesLibrary";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ArtifactItem, NoteItem } from "./types";

const copy = enNotes.library;
const MINUTE = 60_000;
const NOW = Date.now();

const notes: NoteItem[] = [
  {
    id: "n1",
    title: "Masking ablation",
    project: "Vision",
    updatedAt: NOW - 5 * MINUTE,
    author: "agent",
    agent: "Codex",
    icon: "lucide:atom",
    summary: "Masking ratio sweep",
  },
  {
    id: "n2",
    title: "Reading list",
    project: "Language",
    updatedAt: NOW - 10 * MINUTE,
    author: "you",
    summary: "Papers to read",
  },
  {
    id: "n3",
    title: "Agent scratch",
    project: "Vision",
    updatedAt: NOW - 20 * MINUTE,
    author: "agent",
    summary: "Notes from an unnamed agent",
  },
];

function artifact(overrides: Partial<ArtifactItem> & Pick<ArtifactItem, "id" | "title" | "kind">): ArtifactItem {
  return {
    project: "Vision",
    noteIds: ["n1"],
    updatedAt: NOW - 30 * MINUTE,
    author: "agent",
    agent: "Codex",
    chat: "Ablation chat",
    summary: "",
    ...overrides,
  };
}

const artifacts: ArtifactItem[] = [
  artifact({ id: "a1", title: "Loss curve", kind: "figure" }),
  artifact({ id: "a2", title: "Attention map", kind: "html" }),
  artifact({ id: "a3", title: "Ablation report", kind: "report", project: "Language", author: "you", agent: undefined }),
  artifact({ id: "a4", title: "Run 42", kind: "run" }),
];

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes,
    artifacts,
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

interface Props {
  activeNoteId?: string | null;
  activeArtifactId?: string | null;
  onNewNote?: () => void;
  data?: NotesData;
}

function renderLibrary({ activeNoteId = null, activeArtifactId = null, onNewNote, data = fakeData() }: Props = {}) {
  const handlers = {
    onHome: vi.fn(),
    onOpenNote: vi.fn(),
    onOpenArtifact: vi.fn(),
    iconFor: vi.fn((note: NoteItem) => note.icon),
  };
  const view = render(
    <NotesDataProvider value={data}>
      <NotesLibrary
        iconFor={handlers.iconFor}
        activeNoteId={activeNoteId}
        activeArtifactId={activeArtifactId}
        onHome={handlers.onHome}
        onNewNote={onNewNote}
        onOpenNote={handlers.onOpenNote}
        onOpenArtifact={handlers.onOpenArtifact}
      />
    </NotesDataProvider>,
  );
  return { ...view, ...handlers };
}

function rowTitles(): string[] {
  return screen
    .getAllByRole("button")
    .filter((button) => button.closest("section"))
    .map((button) => button.querySelector(".block.truncate.text-sm")?.textContent ?? "");
}

function row(title: string): HTMLElement {
  const match = screen.getByText(title).closest("button");
  if (!match) throw new Error(`no row for ${title}`);
  return match;
}

function ago(timestamp: number): string {
  return formatRelativeTimeFrom(timestamp, Date.now(), { dateAfterDays: 7 });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  env.mac = false;
  env.fullscreen = false;
});

describe("NotesLibrary", () => {
  it("groups notes and artifacts under their project", () => {
    renderLibrary();
    const sections = screen.getAllByRole("heading", { level: 2 });
    expect(sections.map((heading) => heading.textContent)).toEqual(["Vision", "Language"]);
    const vision = sections[0].closest("section") as HTMLElement;
    expect(within(vision).getByText("Masking ablation")).toBeInTheDocument();
    expect(within(vision).getByText("Agent scratch")).toBeInTheDocument();
    expect(within(vision).getByText("Loss curve")).toBeInTheDocument();
    const language = sections[1].closest("section") as HTMLElement;
    expect(within(language).getByText("Reading list")).toBeInTheDocument();
    expect(within(language).getByText("Ablation report")).toBeInTheDocument();
  });

  it("shows who wrote each item and when", () => {
    renderLibrary();
    expect(row("Masking ablation")).toHaveTextContent(`Codex · ${ago(notes[0].updatedAt)}`);
    expect(row("Reading list")).toHaveTextContent(`${copy.author.you} · ${ago(notes[1].updatedAt)}`);
    expect(row("Agent scratch")).toHaveTextContent(`${copy.agentFallback} · ${ago(notes[2].updatedAt)}`);
    expect(row("Ablation report")).toHaveTextContent(copy.author.you);
  });

  it("asks the workspace for each note's icon", () => {
    const view = renderLibrary();
    expect(view.iconFor).toHaveBeenCalledWith(notes[0]);
    expect(view.iconFor).toHaveBeenCalledWith(notes[1]);
    expect(view.iconFor).toHaveBeenCalledWith(notes[2]);
  });

  it("filters by title, ignoring case and surrounding spaces", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(screen.getByRole("textbox", { name: copy.search }), "  ABLATION ");
    expect(rowTitles()).toEqual(["Masking ablation", "Ablation report"]);
  });

  it("says nothing matches when the filters hide everything", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(screen.getByRole("textbox", { name: copy.search }), "zebra");
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("invites a first note when there are no notes or artifacts", () => {
    renderLibrary({ data: fakeData({ notes: [], artifacts: [] }) });
    expect(screen.getByText(copy.noNotes)).toBeInTheDocument();
  });

  it("narrows the list by kind, counting interactive figures as figures", async () => {
    const user = userEvent.setup();
    renderLibrary();
    expect(screen.getByRole("tab", { name: copy.kind.all })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: copy.kind.note }));
    expect(rowTitles()).toEqual(["Masking ablation", "Agent scratch", "Reading list"]);

    await user.click(screen.getByRole("tab", { name: copy.kind.figure }));
    expect(rowTitles()).toEqual(["Loss curve", "Attention map"]);

    await user.click(screen.getByRole("tab", { name: copy.kind.report }));
    expect(rowTitles()).toEqual(["Ablation report"]);

    await user.click(screen.getByRole("tab", { name: copy.kind.run }));
    expect(rowTitles()).toEqual(["Run 42"]);

    await user.click(screen.getByRole("tab", { name: copy.kind.all }));
    expect(rowTitles()).toHaveLength(7);
  });

  it("narrows the list by author", async () => {
    const user = userEvent.setup();
    renderLibrary();

    await user.click(screen.getByRole("tab", { name: copy.author.you }));
    expect(rowTitles()).toEqual(["Reading list", "Ablation report"]);

    await user.click(screen.getByRole("tab", { name: copy.author.agent }));
    expect(rowTitles()).toEqual(["Masking ablation", "Agent scratch", "Loss curve", "Attention map", "Run 42"]);

    await user.click(screen.getByRole("tab", { name: copy.author.all }));
    expect(rowTitles()).toHaveLength(7);
  });

  it("opens notes and artifacts when their rows are clicked", async () => {
    const user = userEvent.setup();
    const view = renderLibrary();
    await user.click(row("Reading list"));
    expect(view.onOpenNote).toHaveBeenCalledWith("n2");
    await user.click(row("Run 42"));
    expect(view.onOpenArtifact).toHaveBeenCalledWith(artifacts[3]);
  });

  it("marks the open note as the current page", () => {
    renderLibrary({ activeNoteId: "n1" });
    expect(row("Masking ablation")).toHaveAttribute("aria-current", "page");
    expect(row("Reading list")).not.toHaveAttribute("aria-current");
  });

  it("marks the open artifact instead of its note while an artifact is open", () => {
    renderLibrary({ activeNoteId: "n1", activeArtifactId: "a1" });
    expect(row("Loss curve")).toHaveAttribute("aria-current", "page");
    expect(row("Masking ablation")).not.toHaveAttribute("aria-current");
  });

  it("disables New note when no handler is given", () => {
    renderLibrary();
    expect(screen.getByRole("button", { name: copy.newNote })).toBeDisabled();
  });

  it("starts a new note from the New note button", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    renderLibrary({ onNewNote });
    await user.click(screen.getByRole("button", { name: copy.newNote }));
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("goes home from the brand button", async () => {
    const user = userEvent.setup();
    const view = renderLibrary();
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(view.onHome).toHaveBeenCalledOnce();
  });

  it("leaves room for the macOS window buttons unless the window is fullscreen", () => {
    env.mac = true;
    const { container, unmount } = renderLibrary();
    expect(container.querySelector("[data-tauri-drag-region]")).toHaveClass("pl-[78px]");
    unmount();

    env.fullscreen = true;
    const fullscreen = renderLibrary();
    expect(fullscreen.container.querySelector("[data-tauri-drag-region]")).not.toHaveClass("pl-[78px]");
  });

  it("keeps the default padding off macOS", () => {
    const { container } = renderLibrary();
    expect(container.querySelector("[data-tauri-drag-region]")).not.toHaveClass("pl-[78px]");
  });
});
