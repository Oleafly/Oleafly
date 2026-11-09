// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useToastStore } from "@/store/toast";
import { noteColorFor } from "./note-file";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { TemplatePicker } from "./TemplatePicker";
import type { NoteItem } from "./types";

const copy = enNotes.vault.templates;

function note(id: string, title: string, properties?: Record<string, unknown>): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", properties };
}

function data(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes: [note("t2", "Zeta template", { template: true }), note("t1", "Alpha template", { template: true }), note("plain", "Plain")],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(async () => ({ text: "---\ntitle: Alpha\ntemplate: true\nstatus: open\n---\nHello {{title}}", version: "v" })),
    saveNote: vi.fn(),
    createNoteFrom: vi.fn(async () => "created"),
    ...overrides,
  };
}

function renderPicker(value = data()) {
  const handlers = { onOpenChange: vi.fn(), onCreated: vi.fn() };
  const view = render(
    <NotesDataProvider value={value}>
      <TemplatePicker open {...handlers} />
    </NotesDataProvider>,
  );
  return { ...view, ...handlers, value };
}

function names(): string[] {
  return screen.getAllByRole("option").map((option) => option.querySelector(".block.truncate")?.textContent ?? "");
}

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe("TemplatePicker", () => {
  it("lists a blank note, the research templates and the user's own templates", () => {
    renderPicker();
    expect(screen.getByRole("dialog", { name: copy.label })).toBeInTheDocument();
    const shown = names();
    expect(shown[0]).toBe(copy.blank);
    expect(shown).toContain(copy.names.experimentLog);
    expect(shown).toContain(copy.names.daily);
    expect(shown.slice(-2)).toEqual(["Alpha template", "Zeta template"]);
    expect(shown).not.toContain("Plain");
    expect(screen.getByText(copy.builtIn)).toBeInTheDocument();
    expect(screen.getByText(copy.yours)).toBeInTheDocument();
  });

  it("filters by name and description, and says when nothing matches", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "who does what");
    expect(names()).toEqual([copy.names.meeting]);
    await user.clear(screen.getByPlaceholderText(copy.placeholder));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "zeta");
    expect(names()).toEqual(["Zeta template"]);
    await user.clear(screen.getByPlaceholderText(copy.placeholder));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "qqqqq");
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it("creates a note from a research template and opens it", async () => {
    const user = userEvent.setup();
    const view = renderPicker();
    await user.click(screen.getByText(copy.names.proof));
    await waitFor(() => expect(view.onCreated).toHaveBeenCalledWith("created"));
    expect(view.value.createNoteFrom).toHaveBeenCalledWith(
      expect.objectContaining({ title: copy.names.proof, properties: "tags: [math]\nstatus: draft" }),
    );
    expect(view.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("creates a blank note with Enter", async () => {
    const user = userEvent.setup();
    const view = renderPicker();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(view.value.createNoteFrom).toHaveBeenCalledWith({ title: enNotes.document.untitled }));
  });

  it("copies a user template's body and properties", async () => {
    const user = userEvent.setup();
    const view = renderPicker();
    await user.click(screen.getByText("Alpha template"));
    await waitFor(() => expect(view.onCreated).toHaveBeenCalled());
    expect(view.value.loadNote).toHaveBeenCalledWith("t1");
    expect(view.value.createNoteFrom).toHaveBeenCalledWith({
      title: "Alpha template",
      body: "Hello Alpha template",
      properties: "status: open",
      color: noteColorFor("Alpha"),
    });
  });

  it("gives a note made from your template the template's icon and colour", async () => {
    const user = userEvent.setup();
    const loadNote = vi.fn(async () => ({ text: "---\ntitle: Alpha\nicon: 🧪\ncolor: peach\ntemplate: true\n---\nBody", version: "v" }));
    const view = renderPicker(data({ loadNote }));
    await user.click(screen.getByText("Alpha template"));
    await waitFor(() => expect(view.onCreated).toHaveBeenCalled());
    expect(view.value.createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ icon: "🧪", color: "peach" }));
  });

  it("reports a failure and lets the user try again", async () => {
    const user = userEvent.setup();
    const createNoteFrom = vi.fn(async () => Promise.reject(new Error("disk full")));
    const view = renderPicker(data({ createNoteFrom }));
    await user.click(screen.getByText(copy.names.meeting));
    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(copy.failed));
    expect(view.onCreated).not.toHaveBeenCalled();
    await user.click(screen.getByText(copy.names.meeting));
    await waitFor(() => expect(createNoteFrom).toHaveBeenCalledTimes(2));
  });

  it("ignores a second choice while creating, and does nothing without a create path", async () => {
    const user = userEvent.setup();
    let finish: (id: string) => void = () => {};
    const createNoteFrom = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const { unmount } = renderPicker(data({ createNoteFrom }));
    await user.click(screen.getByText(copy.names.meeting));
    await waitFor(() => expect(createNoteFrom).toHaveBeenCalledTimes(1));
    await user.click(screen.getByText(copy.names.proof));
    expect(createNoteFrom).toHaveBeenCalledTimes(1);
    finish("done");
    unmount();
    const loadNote = vi.fn();
    renderPicker(data({ createNoteFrom: undefined, loadNote }));
    await user.click(screen.getByText("Alpha template"));
    expect(loadNote).not.toHaveBeenCalled();
  });

  it("clears the search when it closes", async () => {
    const user = userEvent.setup();
    const value = data();
    const { rerender } = renderPicker(value);
    await user.type(screen.getByPlaceholderText(copy.placeholder), "proof");
    rerender(
      <NotesDataProvider value={value}>
        <TemplatePicker open={false} onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </NotesDataProvider>,
    );
    rerender(
      <NotesDataProvider value={value}>
        <TemplatePicker open onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </NotesDataProvider>,
    );
    expect(screen.getByPlaceholderText(copy.placeholder)).toHaveValue("");
  });
});
