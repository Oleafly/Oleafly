// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useToastStore } from "@/store/toast";
import { noteColorFor } from "./note-file";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { TemplatePicker } from "./TemplatePicker";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const zotero = vi.hoisted(() => ({
  hit: {
    library: "user",
    itemKey: "ABCD",
    citationKey: "doe2020",
    keySource: "bbt",
    title: "Sparse <i>masks</i>",
    authors: ["Doe, Jane"],
    authorCount: 1,
    year: "2020",
    doi: "10.2/sparse",
    itemType: "journalArticle",
    dateModified: "",
    score: 1,
  },
}));
vi.mock("@/components/zotero/fresh-hits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/zotero/fresh-hits")>()),
  useFreshZoteroHits: (query: string) => ({ hits: query.includes("sparse") ? [zotero.hit] : [], pending: false }),
}));

const copy = enNotes.vault.templates;
const HE = { key: "he2022", label: "He 2022, Masked Autoencoders", fields: { author: "He, Kaiming", year: "2022", title: "Masked Autoencoders" } };

function note(id: string, title: string, properties?: Record<string, unknown>): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", properties };
}

function data(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({
    notes: [note("t2", "Zeta template", { template: true }), note("t1", "Alpha template", { template: true }), note("plain", "Plain")],
    loadNote: vi.fn(async () => ({ text: "---\ntitle: Alpha\ntemplate: true\nstatus: open\n---\nHello {{title}}", version: "v" })),
    createNoteFrom: vi.fn(async () => "created"),
    ...overrides,
  });
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

  it("makes a paper reading note from a reference in the bibliography or Zotero, with its citation key", async () => {
    const user = userEvent.setup();
    const view = renderPicker(data({ citations: [HE] }));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "masked");
    expect(screen.getByText(enNotes.citations.fromReference)).toBeInTheDocument();
    await user.click(screen.getByText(HE.label));
    await waitFor(() => expect(view.onCreated).toHaveBeenCalledWith("created"));
    expect(view.value.createNoteFrom).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Masked Autoencoders", icon: "lucide:book-open", properties: expect.stringContaining("citekey: he2022") }),
    );
    await user.clear(screen.getByPlaceholderText(copy.placeholder));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "sparse");
    await user.click(screen.getByText("doe2020"));
    await waitFor(() => expect(view.value.createNoteFrom).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Sparse masks" })));
    const properties = vi.mocked(view.value.createNoteFrom)?.mock.lastCall?.[0].properties ?? "";
    for (const line of ['authors: ["Doe, Jane"]', "year: 2020", "doi: 10.2/sparse", "citekey: doe2020"]) expect(properties).toContain(line);
  });

  it("opens the note already written on a reference instead of making another", async () => {
    const user = userEvent.setup();
    const view = renderPicker(data({ citations: [HE], notes: [note("read", "Reading MAE", { citekey: "he2022" })] }));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "he2022");
    await user.click(screen.getByText(HE.label));
    await waitFor(() => expect(view.onCreated).toHaveBeenCalledWith("read"));
    expect(view.value.createNoteFrom).not.toHaveBeenCalled();
  });
});
