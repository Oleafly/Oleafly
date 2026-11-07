// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useComposerDrafts } from "@/store/composer-drafts";
import type { SaveStatus } from "./NoteDocument";
import type { ArtifactItem, NoteItem } from "./types";

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
vi.mock("./NoteDocument", () => ({
  NoteDocument: ({
    note,
    insertRequest,
    onSendToPaper,
    onStatusChange,
  }: {
    note: NoteItem;
    insertRequest: { artifact: ArtifactItem; id: number } | null;
    onSendToPaper: (text: string) => void;
    onStatusChange?: (status: SaveStatus) => void;
  }) => (
    <div data-testid="note-document">
      <h1>{note.title}</h1>
      <p data-testid="insert-request">{insertRequest ? `${insertRequest.artifact.id}#${insertRequest.id}` : "none"}</p>
      <button type="button" data-testid="stub-send" onClick={() => onSendToPaper("x")} />
      <button type="button" data-testid="stub-saving" onClick={() => onStatusChange?.("saving")} />
      <button type="button" data-testid="stub-failed" onClick={() => onStatusChange?.("failed")} />
    </div>
  ),
}));

import { NotesWorkspace } from "./NotesWorkspace";
import { NotesDataProvider, type NotesData } from "./notes-data";

const copy = enNotes.workspace;
const NOW = Date.now();

const notes: NoteItem[] = [
  {
    id: "n1",
    title: "Masking ablation",
    project: "Vision",
    updatedAt: NOW - 60_000,
    author: "agent",
    agent: "Codex",
    summary: "Masking ratio sweep across three seeds",
  },
  {
    id: "n2",
    title: "Reading list",
    project: "Language",
    updatedAt: NOW - 120_000,
    author: "you",
    summary: "Papers to read this week",
  },
];

function artifact(overrides: Partial<ArtifactItem> & Pick<ArtifactItem, "id" | "title" | "kind">): ArtifactItem {
  return {
    project: "Vision",
    noteIds: ["n1"],
    updatedAt: NOW - 180_000,
    author: "agent",
    agent: "Codex",
    chat: "Ablation chat",
    summary: "",
    ...overrides,
  };
}

const artifacts: ArtifactItem[] = [
  artifact({ id: "a1", title: "Loss curve", kind: "figure", snippet: "![Loss curve](loss.png)" }),
  artifact({ id: "a2", title: "Run 42", kind: "run" }),
  artifact({ id: "a3", title: "Stray report", kind: "report", noteIds: [] }),
];

const papers = [
  { id: "p1", label: "Masking paper" },
  { id: "p2", label: "Survey draft" },
];

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes,
    artifacts,
    experiments: [],
    agents: [],
    citations: [],
    papers,
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
}

type WorkspaceProps = Parameters<typeof NotesWorkspace>[0];

function renderWorkspace(props: WorkspaceProps = {}, data: NotesData = fakeData()) {
  return render(
    <NotesDataProvider value={data}>
      <NotesWorkspace {...props} />
    </NotesDataProvider>,
  );
}

function artifactsLabel(total: number): string {
  return copy.artifacts.replace("{{total}}", String(total));
}

function libraryRow(title: string): HTMLElement {
  const aside = screen.getByRole("textbox", { name: enNotes.library.search }).closest("aside") as HTMLElement;
  const match = within(aside).getByText(title).closest("button");
  if (!match) throw new Error(`no library row for ${title}`);
  return match;
}

function artifactPanel(): HTMLElement {
  return screen.getByRole("complementary", { name: enNotes.artifacts.title });
}

function onHome(): boolean {
  return screen.queryByRole("heading", { name: enNotes.home.title }) !== null;
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  env.mac = false;
  env.fullscreen = false;
  localStorage.clear();
  useComposerDrafts.setState({ drafts: {} });
});

describe("NotesWorkspace", () => {
  it("opens on Home with the library beside it", () => {
    const { container } = renderWorkspace();
    expect(onHome()).toBe(true);
    expect(container.querySelector("main header")).toHaveTextContent(copy.home);
    expect(screen.getByRole("textbox", { name: enNotes.library.search })).toBeInTheDocument();
    expect(screen.queryByTestId("note-document")).not.toBeInTheDocument();
  });

  it("opens the note it was asked to show first", () => {
    renderWorkspace({ initialNoteId: "n1" });
    expect(screen.getByRole("heading", { level: 1, name: "Masking ablation" })).toBeInTheDocument();
    expect(screen.getByText("Vision /", { exact: false })).toHaveTextContent("Vision / Masking ablation");
    expect(screen.getByText(copy.saved)).toBeInTheDocument();
    expect(libraryRow("Masking ablation")).toHaveAttribute("aria-current", "page");
  });

  it("opens a note picked in the library", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(libraryRow("Reading list"));
    expect(screen.getByRole("heading", { level: 1, name: "Reading list" })).toBeInTheDocument();
    expect(onHome()).toBe(false);
  });

  it("opens a note picked on Home", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const home = screen.getByRole("heading", { name: enNotes.home.title }).closest("header")?.parentElement as HTMLElement;
    await user.click(within(home).getByText("Reading list"));
    expect(screen.getByRole("heading", { level: 1, name: "Reading list" })).toBeInTheDocument();
  });

  it("shows whether the note is saving or failed to save", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByTestId("stub-saving"));
    expect(screen.getByText(copy.saving)).toBeInTheDocument();
    expect(screen.queryByText(copy.saved)).not.toBeInTheDocument();
    await user.click(screen.getByTestId("stub-failed"));
    expect(screen.getByText(copy.saveFailed)).toHaveClass("text-destructive");
  });

  it("resets the save status when another note opens", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByTestId("stub-failed"));
    await user.click(libraryRow("Reading list"));
    expect(screen.getByText(copy.saved)).toBeInTheDocument();
  });

  it("hides and shows the library", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    const hide = screen.getByRole("button", { name: copy.hideSidebar });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    await user.click(hide);
    expect(screen.queryByRole("textbox", { name: enNotes.library.search })).not.toBeInTheDocument();
    const show = screen.getByRole("button", { name: copy.showSidebar });
    expect(show).toHaveAttribute("aria-expanded", "false");
    await user.click(show);
    expect(screen.getByRole("textbox", { name: enNotes.library.search })).toBeInTheDocument();
  });

  it("leaves room for the macOS window buttons only while the library is hidden", async () => {
    env.mac = true;
    const user = userEvent.setup();
    const { container } = renderWorkspace({ initialNoteId: "n1" });
    const header = () => container.querySelector("main header") as HTMLElement;
    expect(header()).not.toHaveClass("pl-[78px]");
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    expect(header()).toHaveClass("pl-[78px]");
  });

  it("keeps the header padding in fullscreen", async () => {
    env.mac = true;
    env.fullscreen = true;
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    expect(container.querySelector("main header")).not.toHaveClass("pl-[78px]");
  });

  it("goes Home from the brand button while a note is open", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onExit });
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(onHome()).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("leaves Notes from the brand button when already Home", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ onExit });
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("stays Home from the brand button when there is nowhere to leave to", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(onHome()).toBe(true);
  });

  it("offers the compact brand button while the library is hidden", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ initialNoteId: "n2", onExit });
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(onHome()).toBe(true);
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("opens a new note once it has been created", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn(() => Promise.resolve("n2"));
    renderWorkspace({ onNewNote });
    await user.click(screen.getByRole("button", { name: enNotes.library.newNote }));
    expect(await screen.findByRole("heading", { level: 1, name: "Reading list" })).toBeInTheDocument();
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("stays put when creating a note gives no id", async () => {
    const user = userEvent.setup();
    let finish: (id: string | null) => void = () => undefined;
    const onNewNote = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    renderWorkspace({ onNewNote });
    await user.click(screen.getByRole("button", { name: enNotes.library.newNote }));
    expect(onNewNote).toHaveBeenCalledOnce();
    await act(async () => finish(null));
    expect(onHome()).toBe(true);
  });

  it("disables New note when notes cannot be created", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: enNotes.library.newNote })).toBeDisabled();
  });

  it("counts the note's artifacts on the Artifacts button", () => {
    renderWorkspace({ initialNoteId: "n1" });
    const toggle = screen.getByRole("button", { name: artifactsLabel(2) });
    expect(toggle).toHaveTextContent("2");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no count badge for a note without artifacts", () => {
    renderWorkspace({ initialNoteId: "n2" });
    expect(screen.getByRole("button", { name: artifactsLabel(0) })).toHaveTextContent("");
  });

  it("opens and closes the artifact panel", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    const toggle = screen.getByRole("button", { name: artifactsLabel(2) });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(within(artifactPanel()).getByRole("button", { name: "Loss curve" })).toHaveAttribute("aria-current", "true");
    await user.click(within(artifactPanel()).getByRole("button", { name: enNotes.artifacts.close }));
    expect(screen.queryByRole("complementary", { name: enNotes.artifacts.title })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(artifactPanel()).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByRole("complementary", { name: enNotes.artifacts.title })).not.toBeInTheDocument();
  });

  it("opens an artifact from the library inside its note", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(libraryRow("Run 42"));
    expect(screen.getByRole("heading", { level: 1, name: "Masking ablation" })).toBeInTheDocument();
    expect(within(artifactPanel()).getByRole("button", { name: "Run 42" })).toHaveAttribute("aria-current", "true");
    expect(libraryRow("Run 42")).toHaveAttribute("aria-current", "page");
    expect(libraryRow("Masking ablation")).not.toHaveAttribute("aria-current");
  });

  it("ignores an artifact that belongs to no note", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(libraryRow("Stray report"));
    expect(onHome()).toBe(true);
  });

  it("selects another artifact in the panel", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: artifactsLabel(2) }));
    await user.click(within(artifactPanel()).getByRole("button", { name: "Run 42" }));
    expect(within(artifactPanel()).getByRole("button", { name: "Run 42" })).toHaveAttribute("aria-current", "true");
    expect(libraryRow("Run 42")).toHaveAttribute("aria-current", "page");
  });

  it("asks the note to insert an artifact, once per click", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    expect(screen.getByTestId("insert-request")).toHaveTextContent("none");
    await user.click(screen.getByRole("button", { name: artifactsLabel(2) }));
    const insert = within(artifactPanel()).getByRole("button", { name: enNotes.artifacts.insert });
    await user.click(insert);
    expect(screen.getByTestId("insert-request")).toHaveTextContent("a1#1");
    await user.click(insert);
    expect(screen.getByTestId("insert-request")).toHaveTextContent("a1#2");
  });

  it("creates a project from the open note", async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onCreateProject });
    await user.click(screen.getByRole("button", { name: copy.newProject }));
    const dialog = screen.getByRole("dialog", { name: enNotes.newProject.title });
    await user.click(within(dialog).getByRole("button", { name: enNotes.newProject.create }));
    expect(onCreateProject).toHaveBeenCalledWith({
      seed: { noteId: "n1", artifactId: null },
      name: "Masking ablation",
      format: "latex",
      files: ["n1", "a1", "a2"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("creates a project from an artifact in the panel", async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onCreateProject });
    await user.click(screen.getByRole("button", { name: artifactsLabel(2) }));
    await user.click(within(artifactPanel()).getByRole("button", { name: "Run 42" }));
    await user.click(within(artifactPanel()).getByRole("button", { name: enNotes.artifacts.newProject }));
    const dialog = screen.getByRole("dialog", { name: enNotes.newProject.title });
    expect(within(dialog).getByRole("checkbox", { name: "Run 42" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Loss curve" })).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: enNotes.newProject.create }));
    expect(onCreateProject).toHaveBeenCalledWith({
      seed: { noteId: "n1", artifactId: "a2" },
      name: "Masking ablation",
      format: "latex",
      files: ["a2"],
    });
  });

  it("cannot create a project without a handler and closes from Cancel", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: copy.newProject }));
    const dialog = screen.getByRole("dialog", { name: enNotes.newProject.title });
    expect(within(dialog).getByRole("button", { name: enNotes.newProject.create })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends the note summary to the chosen paper", async () => {
    const user = userEvent.setup();
    const onSendToPaper = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper });
    await user.click(screen.getByRole("button", { name: copy.sendToPaper }));
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    expect(dialog).toHaveAccessibleDescription(enNotes.sendToPaper.description);
    expect(dialog).toHaveTextContent(notes[0].summary);
    expect(within(dialog).getByRole("radio", { name: "Masking paper" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "Survey draft" }));
    await user.click(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send }));
    expect(onSendToPaper).toHaveBeenCalledWith({ paperId: "p2", text: notes[0].summary });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends text handed over by the note", async () => {
    const user = userEvent.setup();
    const onSendToPaper = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper });
    await user.click(screen.getByTestId("stub-send"));
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    await user.click(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send }));
    expect(onSendToPaper).toHaveBeenCalledWith({ paperId: "p1", text: "x" });
  });

  it("cannot send without a handler and closes from Cancel", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: copy.sendToPaper }));
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    expect(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cannot send when there is no paper to send to", async () => {
    const user = userEvent.setup();
    const onSendToPaper = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper }, fakeData({ papers: [] }));
    await user.click(screen.getByRole("button", { name: copy.sendToPaper }));
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send })).toBeDisabled();
  });

  it("closes the paper dialog with Escape without sending", async () => {
    const user = userEvent.setup();
    const onSendToPaper = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper });
    await user.click(screen.getByRole("button", { name: copy.sendToPaper }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSendToPaper).not.toHaveBeenCalled();
  });

  it("offers the Home composer when notes can be started from a prompt", () => {
    renderWorkspace({ onStartNote: vi.fn() });
    expect(screen.getByRole("combobox", { name: enNotes.home.composerLabel })).toBeInTheDocument();
  });
});
