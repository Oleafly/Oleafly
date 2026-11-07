// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { NewProjectDialog, type ProjectSeed } from "./NewProjectDialog";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ArtifactItem, NoteItem } from "./types";

const UNKNOWN_FORMAT = "Pick an unknown format";

vi.mock("@/components/ui/radio-group", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/radio-group")>();
  const { createElement, Fragment } = await import("react");
  type GroupProps = Parameters<typeof actual.RadioGroup>[0];
  return {
    ...actual,
    RadioGroup: (props: GroupProps) =>
      createElement(
        Fragment,
        null,
        createElement(actual.RadioGroup, props),
        createElement("button", { type: "button", onClick: () => props.onValueChange?.("pdf") }, UNKNOWN_FORMAT),
      ),
  };
});

const copy = enNotes.newProject;

const note: NoteItem = {
  id: "n1",
  title: "Masking ablation",
  project: "Vision",
  relatedProjectId: "p1",
  updatedAt: 1_700_000_000_000,
  author: "you",
  icon: "lucide:atom",
  summary: "",
};

const unrelated: NoteItem = {
  id: "n2",
  title: "Loose ideas",
  project: "Notes",
  updatedAt: 1_700_000_000_000,
  author: "you",
  summary: "",
};

function artifact(id: string, title: string, kind: ArtifactItem["kind"], projectId = "p1"): ArtifactItem {
  return {
    id,
    taskId: `task-${id}`,
    path: `outputs/${id}`,
    title,
    kind,
    projectId,
    project: "Vision",
    updatedAt: 1_700_000_000_000,
    agent: "Codex",
    chat: "Ablation task",
    summary: "",
  };
}

const artifacts = [
  artifact("a1", "Loss curve", "figure"),
  artifact("a2", "Run 42", "data"),
  artifact("a3", "Other project's report", "report", "p2"),
];

function fakeData(): NotesData {
  return {
    notes: [note, unrelated],
    artifacts,
    experiments: [],
    agents: [],
    citations: [],
    papers: [],
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
}

function renderDialog(seed: ProjectSeed, withCreate = true) {
  const onClose = vi.fn();
  const onCreate = withCreate ? vi.fn() : undefined;
  render(
    <NotesDataProvider value={fakeData()}>
      <NewProjectDialog seed={seed} onClose={onClose} onCreate={onCreate} />
    </NotesDataProvider>,
  );
  return { onClose, onCreate };
}

function nameField(): HTMLElement {
  return screen.getByRole("textbox", { name: copy.name });
}

function createButton(): HTMLElement {
  return screen.getByRole("button", { name: copy.create });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("NewProjectDialog", () => {
  it("names the project after the note and brings the note with all its artifacts", () => {
    renderDialog({ noteId: "n1", artifactId: null });
    expect(screen.getByRole("dialog", { name: copy.title })).toHaveAccessibleDescription(copy.description);
    expect(nameField()).toHaveValue("Masking ablation");
    expect(screen.getByRole("checkbox", { name: "Masking ablation" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Loss curve" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Run 42" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Other project's report" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "LaTeX" })).toBeChecked();
  });

  it("brings only the artifact the project was started from", () => {
    renderDialog({ noteId: "n1", artifactId: "a2" });
    expect(screen.getByRole("checkbox", { name: "Masking ablation" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Loss curve" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Run 42" })).toBeChecked();
  });

  it("brings only the note when it has no related project", () => {
    renderDialog({ noteId: "n2", artifactId: null });
    expect(nameField()).toHaveValue("Loose ideas");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Loose ideas" })).toBeChecked();
  });

  it("falls back to a default name when the note is missing", () => {
    renderDialog({ noteId: "gone", artifactId: null });
    expect(nameField()).toHaveValue(copy.defaultName);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("creates the project with the trimmed name, chosen format and chosen files", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog({ noteId: "n1", artifactId: null });
    await user.clear(nameField());
    await user.type(nameField(), "  Masking paper  ");
    await user.click(screen.getByRole("radio", { name: "Typst" }));
    expect(screen.getByRole("radio", { name: "Typst" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Loss curve" }));
    await user.click(createButton());
    expect(onCreate).toHaveBeenCalledWith({ name: "Masking paper", format: "typst", files: ["n1", "a2"] });
  });

  it("adds a file back when its box is checked again", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog({ noteId: "n1", artifactId: "a2" });
    await user.click(screen.getByRole("checkbox", { name: "Masking ablation" }));
    await user.click(screen.getByRole("radio", { name: "Markdown" }));
    await user.click(createButton());
    expect(onCreate).toHaveBeenCalledWith({ name: "Masking ablation", format: "markdown", files: ["a2", "n1"] });
  });

  it("falls back to LaTeX when the format value is unknown", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog({ noteId: "n1", artifactId: "a1" });
    await user.click(screen.getByRole("radio", { name: "Typst" }));
    await user.click(screen.getByRole("button", { name: UNKNOWN_FORMAT }));
    expect(screen.getByRole("radio", { name: "LaTeX" })).toBeChecked();
    await user.click(createButton());
    expect(onCreate).toHaveBeenCalledWith({ name: "Masking ablation", format: "latex", files: ["a1"] });
  });

  it("disables Create when no files are chosen", async () => {
    const user = userEvent.setup();
    renderDialog({ noteId: "n1", artifactId: "a1" });
    expect(createButton()).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "Loss curve" }));
    expect(createButton()).toBeDisabled();
  });

  it("disables Create when the name is blank", async () => {
    const user = userEvent.setup();
    renderDialog({ noteId: "n1", artifactId: null });
    await user.clear(nameField());
    await user.type(nameField(), "   ");
    expect(createButton()).toBeDisabled();
  });

  it("disables Create when there is no way to create projects", () => {
    renderDialog({ noteId: "n1", artifactId: null }, false);
    expect(createButton()).toBeDisabled();
  });

  it("closes from Cancel without creating anything", async () => {
    const user = userEvent.setup();
    const { onClose, onCreate } = renderDialog({ noteId: "n1", artifactId: null });
    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("closes when Escape dismisses the dialog", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ noteId: "n1", artifactId: null });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
