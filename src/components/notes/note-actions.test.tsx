// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCloud from "@/i18n/locales/en/cloud.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";
import { unzipSync, strFromU8 } from "fflate";
import { base64ToBytes } from "@/lib/base64";

const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
const clipboard = vi.hoisted(() => ({ writeClipboardText: vi.fn(async (_text: string) => {}) }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: log.logError,
}));
vi.mock("@/lib/clipboard", () => clipboard);
const exporting = vi.hoisted(() => ({
  pickSavePath: vi.fn(),
  pandocConvert: vi.fn(),
  readProjectBytes: vi.fn(),
  writeBytesFile: vi.fn(),
  notesExportFolder: vi.fn(),
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: exporting.pickSavePath }));
vi.mock("@/features/tools-ai/pandoc-text", () => ({ pandocConvert: exporting.pandocConvert }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectBytes: exporting.readProjectBytes,
  writeBytesFile: exporting.writeBytesFile,
  notesExportFolder: exporting.notesExportFolder,
}));

import type { ProjectInfo } from "@oleafly/backend-port";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useToastStore } from "@/store/toast";
import { NoteListRow } from "./NoteCard";
import { useNoteActions } from "./note-actions";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";
import { useNotesPrefsStore } from "@/store/notes-prefs";

const menuCopy = enNotes.library.menu;
const SOURCE = "---\nkind: note\nid: masking-1\ntitle: Masking ablation\n---\n\nBody\n";

const NOTE: NoteItem = {
  id: "n1",
  title: "Masking ablation",
  project: "Vision",
  updatedAt: Date.now(),
  author: "you",
  summary: "",
};

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({
    notes: [NOTE],
    projects: [
      { id: "p-vision", name: "Vision" },
      { id: "p-language", name: "Language" },
    ],
    loadNote: vi.fn(async () => ({ text: SOURCE, version: "v1" })),
    saveNote: vi.fn(async (_id: string, text: string) => ({ text, version: "v2" })),
    renameNote: vi.fn(async () => {}),
    setRelatedProject: vi.fn(async () => {}),
    deleteNote: vi.fn(async () => {}),
    ...overrides,
  });
}

function Row({ note, onOpenNoteInNewTab }: Readonly<{ note: NoteItem; onOpenNoteInNewTab?: (id: string) => void }>) {
  const { actionsFor, dialog } = useNoteActions(onOpenNoteInNewTab);
  return (
    <>
      <NoteListRow
        note={note}
        icon={undefined}
        actions={actionsFor(note)}
        projectColor={null}
        onOpen={() => {}}
        sorted={null}
        when={{ edited: "", created: "", opened: null }}
      />
      {dialog}
    </>
  );
}

function renderRow({
  data = fakeData(),
  note = NOTE,
  onOpenNoteInNewTab,
}: { data?: NotesData; note?: NoteItem; onOpenNoteInNewTab?: (id: string) => void } = {}) {
  render(
    <NotesDataProvider value={data}>
      <Row note={note} onOpenNoteInNewTab={onOpenNoteInNewTab} />
    </NotesDataProvider>,
  );
  return data;
}

function openMore(): HTMLElement {
  fireEvent.pointerDown(screen.getByRole("button", { name: menuCopy.more }), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
}

async function pick(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(within(openMore()).getByRole("menuitem", { name }));
}

async function startRename(user: ReturnType<typeof userEvent.setup>): Promise<HTMLInputElement> {
  await pick(user, menuCopy.rename);
  return (await screen.findByRole("textbox", { name: menuCopy.renameLabel })) as HTMLInputElement;
}

async function projectMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  within(openMore()).getByRole("menuitem", { name: menuCopy.linkProject }).focus();
  await user.keyboard("{ArrowRight}");
  return (await screen.findAllByRole("menu")).at(-1) as HTMLElement;
}

function toasts(kind: "success" | "error"): string[] {
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.kind === kind)
    .map((toast) => toast.message);
}

const initialPrefs = useNotesPrefsStore.getState();

beforeEach(() => {
  useNotesPrefsStore.setState(initialPrefs, true);
  localStorage.clear();
  log.logError.mockClear();
  clipboard.writeClipboardText.mockReset();
  useToastStore.setState({ toasts: [] });
  useFilesStore.setState({ projects: [] });
});

afterEach(() => {
  useCloudStore.setState({ state: null });
});

describe("note menu", () => {
  it("lists every action in order, with Delete set apart", () => {
    renderRow({ onOpenNoteInNewTab: vi.fn() });
    const menu = openMore();
    expect(itemNames(menu)).toEqual([
      menuCopy.openInNewTab,
      menuCopy.copyLink,
      menuCopy.export,
      menuCopy.favorite,
      menuCopy.rename,
      menuCopy.useAsTemplate,
      menuCopy.linkProject,
      menuCopy.delete,
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
  });

  it("keeps only the actions the data can do", () => {
    renderRow({ data: fakeData({ renameNote: undefined, deleteNote: undefined, setRelatedProject: undefined }) });
    const menu = openMore();
    expect(itemNames(menu)).toEqual([menuCopy.copyLink, menuCopy.export, menuCopy.favorite, menuCopy.useAsTemplate]);
    expect(within(menu).queryByRole("separator")).not.toBeInTheDocument();
  });

  it("opens the note in a new tab", async () => {
    const user = userEvent.setup();
    const onOpenNoteInNewTab = vi.fn();
    renderRow({ onOpenNoteInNewTab });
    await pick(user, menuCopy.openInNewTab);
    expect(onOpenNoteInNewTab).toHaveBeenCalledWith("n1");
  });
});

describe("export", () => {
  const RICH = [
    SOURCE.trimEnd(),
    "",
    "Masks help [@smith2021, p. 12].",
    "",
    "![Loss curve](assets/loss.png)",
    "",
  ].join("\n");
  const SMITH = { key: "smith2021", label: "Smith 2021, Masks", fields: { author: "Smith, Ann", year: "2021", title: "Masks", journal: "Vision" } };

  async function exportMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    within(openMore()).getByRole("menuitem", { name: menuCopy.export }).focus();
    await user.keyboard("{ArrowRight}");
    return (await screen.findAllByRole("menu")).at(-1) as HTMLElement;
  }

  async function exportAs(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
    await user.click(within(await exportMenu(user)).getByRole("menuitem", { name }));
  }

  beforeEach(() => {
    for (const mock of Object.values(exporting)) mock.mockReset();
    exporting.readProjectBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
    exporting.writeBytesFile.mockResolvedValue(undefined);
  });

  it("saves a Word file with the note's images inside and its citations written out", async () => {
    const user = userEvent.setup();
    exporting.pickSavePath.mockResolvedValue("/out/Masking_ablation.docx");
    exporting.pandocConvert.mockResolvedValue({ dataBase64: "UEsDBA==", text: null });
    renderRow({ data: fakeData({ loadNote: vi.fn(async () => ({ text: RICH, version: "v1" })), citations: [SMITH] }) });
    await exportAs(user, menuCopy.exportAs.docx);
    await waitFor(() => expect(exporting.writeBytesFile).toHaveBeenCalledWith("/out/Masking_ablation.docx", "UEsDBA=="));
    expect(exporting.readProjectBytes).toHaveBeenCalledWith("n1", "assets/loss.png");
    const request = exporting.pandocConvert.mock.lastCall?.[0] as { source: string; target: string; text: string };
    expect(request).toMatchObject({ source: "markdown-note", target: "docx" });
    expect(request.text).toMatch(/^---\ntitle: "Masking ablation"\n---/u);
    expect(request.text).toContain("![Loss curve](data:image/png;base64,iVBORw==)");
    expect(request.text).toContain("Masks help (Smith 2021, p. 12).");
    expect(request.text).toContain(`## ${enNotes.citations.references}\n\n- Smith, Ann (2021). Masks. Vision`);
    expect(exporting.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "Masking_ablation.docx" }));
  });

  it("bundles a LaTeX file with the figures it includes", async () => {
    const user = userEvent.setup();
    exporting.pickSavePath.mockResolvedValue("/out/Masking_ablation.zip");
    exporting.pandocConvert.mockImplementation(async (request: { text: string }) => ({ text: request.text, dataBase64: null }));
    renderRow({ data: fakeData({ loadNote: vi.fn(async () => ({ text: RICH, version: "v1" })) }) });
    await exportAs(user, menuCopy.exportAs.latex);
    await waitFor(() => expect(exporting.writeBytesFile).toHaveBeenCalled());
    const [destination, data] = exporting.writeBytesFile.mock.lastCall as [string, string];
    expect(destination).toBe("/out/Masking_ablation.zip");
    const files = unzipSync(base64ToBytes(data));
    expect(Object.keys(files).sort()).toEqual(["Masking_ablation.tex", "figures/loss.png"]);
    expect(strFromU8(files["Masking_ablation.tex"])).toContain("![Loss curve](figures/loss.png)");
  });

  it("keeps a TikZ block as LaTeX in a LaTeX export and loads its package in the preamble", async () => {
    const user = userEvent.setup();
    exporting.pickSavePath.mockResolvedValue("/out/Masking_ablation.tex");
    exporting.pandocConvert.mockImplementation(async (request: { text: string }) => ({ text: request.text, dataBase64: null }));
    const circuit = "# Circuit\n\n```circuitikz\n\\usepackage[siunitx]{circuitikz}\n\\draw (0,0) to[R] (2,0);\n```\n";
    renderRow({ data: fakeData({ loadNote: vi.fn(async () => ({ text: circuit, version: "v1" })) }) });
    await exportAs(user, menuCopy.exportAs.latex);
    await waitFor(() => expect(exporting.writeBytesFile).toHaveBeenCalled());
    const request = exporting.pandocConvert.mock.lastCall?.[0] as { text: string };
    expect(request.text).toMatch(/^---\ntitle: "Masking ablation"\nheader-includes:\n {2}- \|\n {4}```\{=latex\}\n {4}\\usepackage\[siunitx\]\{circuitikz\}\n {4}```\n---\n/u);
    expect(request.text).toContain("\\begin{circuitikz}\n\\draw (0,0) to[R] (2,0);\n\\end{circuitikz}");
  });

  it("lists the note's export choices, then Copy as Markdown", async () => {
    const user = userEvent.setup();
    renderRow();
    expect(itemNames(await exportMenu(user))).toEqual([
      menuCopy.exportAs.markdown,
      menuCopy.exportAs.docx,
      menuCopy.exportAs.html,
      menuCopy.exportAs.latex,
      menuCopy.exportAs.typst,
      menuCopy.copyMarkdown,
    ]);
  });

  it("saves the note as a Markdown folder through the vault export", async () => {
    const user = userEvent.setup();
    exporting.notesExportFolder.mockResolvedValue({ folder: "/out/Masking ablation", notes: 1, attachments: 2, skipped: 0, paperLinks: [] });
    renderRow();
    await exportAs(user, menuCopy.exportAs.markdown);
    await waitFor(() => expect(toasts("success")).toEqual([enNotes.vault.import.export.done_one.replace("{{count}}", "1")]));
    expect(exporting.notesExportFolder).toHaveBeenCalledExactlyOnceWith({
      noteId: "n1",
      folderName: "Masking ablation",
      title: enNotes.vault.import.export.pickerTitle,
    });
    expect(exporting.pandocConvert).not.toHaveBeenCalled();
  });

  it("copies the title as a heading and the body without its front matter", async () => {
    const user = userEvent.setup();
    renderRow();
    await exportAs(user, menuCopy.copyMarkdown);
    await waitFor(() => expect(clipboard.writeClipboardText).toHaveBeenCalledExactlyOnceWith("# Masking ablation\n\nBody\n"));
    await waitFor(() => expect(toasts("success")).toEqual([menuCopy.markdownCopied.replace("{{name}}", NOTE.title)]));
  });

  it("says when the note can't be copied", async () => {
    const user = userEvent.setup();
    renderRow({ data: fakeData({ loadNote: vi.fn(async () => Promise.reject(new Error("gone"))) }) });
    await exportAs(user, menuCopy.copyMarkdown);
    await waitFor(() => expect(toasts("error")).toEqual([menuCopy.copyMarkdownFailed.replace("{{name}}", NOTE.title)]));
    expect(clipboard.writeClipboardText).not.toHaveBeenCalled();
  });

  it("says when an export fails", async () => {
    const user = userEvent.setup();
    exporting.pickSavePath.mockResolvedValue("/out/Masking_ablation.html");
    exporting.pandocConvert.mockRejectedValue(new Error("pandoc failed"));
    renderRow();
    await exportAs(user, menuCopy.exportAs.html);
    await waitFor(() => expect(toasts("error")).toEqual([menuCopy.exportFailed.replace("{{name}}", NOTE.title)]));
    expect(exporting.writeBytesFile).not.toHaveBeenCalled();
  });
});

describe("favorites", () => {
  it("adds and removes a favorite from the menu and from the bookmark button", async () => {
    const user = userEvent.setup();
    renderRow();
    await pick(user, menuCopy.favorite);
    expect(useNotesPrefsStore.getState().favorites).toEqual(["n1"]);
    const button = screen.getByRole("button", { name: menuCopy.unfavorite });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(useNotesPrefsStore.getState().favorites).toEqual([]);
    expect(screen.getByRole("button", { name: menuCopy.favorite })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("rename", () => {
  it("saves the trimmed title on Enter and on blur", async () => {
    const user = userEvent.setup();
    const data = renderRow();
    const input = await startRename(user);
    expect(input).toHaveValue("Masking ablation");
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "  Masking sweep  {Enter}");
    expect(data.renameNote).toHaveBeenCalledExactlyOnceWith("n1", "Masking sweep");
    expect(screen.queryByRole("textbox", { name: menuCopy.renameLabel })).not.toBeInTheDocument();

    const again = await startRename(user);
    await user.clear(again);
    await user.type(again, "Reading queue");
    act(() => again.blur());
    expect(data.renameNote).toHaveBeenLastCalledWith("n1", "Reading queue");
  });

  it.each([
    ["an unchanged title", " "],
    ["an empty title", "{Backspace>20/}   "],
  ])("keeps the title for %s", async (_name, keys) => {
    const user = userEvent.setup();
    const data = renderRow();
    await user.type(await startRename(user), `${keys}{Enter}`);
    expect(data.renameNote).not.toHaveBeenCalled();
  });

  it("cancels on Escape, even when the field then loses focus, and keeps Escape from leaving the field", async () => {
    const user = userEvent.setup();
    const data = renderRow();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    const input = await startRename(user);
    await user.type(input, " v2");
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
    });
    document.removeEventListener("keydown", outer);
    expect(data.renameNote).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    expect(screen.queryByRole("textbox", { name: menuCopy.renameLabel })).not.toBeInTheDocument();
  });

  it("ignores the Enter and Escape that end an IME composition", async () => {
    const user = userEvent.setup();
    const data = renderRow();
    const input = await startRename(user);
    await user.clear(input);
    await user.type(input, "マスク");
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(screen.getByRole("textbox", { name: menuCopy.renameLabel })).toBe(input);
    expect(data.renameNote).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(data.renameNote).toHaveBeenCalledWith("n1", "マスク");
  });

  it("tells you when a rename fails", async () => {
    const user = userEvent.setup();
    renderRow({ data: fakeData({ renameNote: vi.fn(async () => Promise.reject(new Error("disk full"))) }) });
    await user.type(await startRename(user), "!{Enter}");
    await waitFor(() => expect(toasts("error")).toEqual(['Couldn\'t rename "Masking ablation".']));
    expect(log.logError).toHaveBeenCalledWith("rename note", expect.any(Error));
  });
});

describe("link to project", () => {
  it("marks the current project, ignores picking it again, and links or unlinks the note", async () => {
    const user = userEvent.setup();
    const data = renderRow({ note: { ...NOTE, relatedProjectId: "p-vision" } });
    let submenu = await projectMenu(user);
    expect(itemNames(submenu)).toEqual([enNotes.workspace.noProject, "Vision", "Language"]);
    expect(within(submenu).getByRole("menuitem", { name: "Vision" }).querySelector("[data-slot=check-badge]")).toBeInTheDocument();
    await user.click(within(submenu).getByRole("menuitem", { name: "Vision" }));
    expect(data.setRelatedProject).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    submenu = await projectMenu(user);
    await user.click(within(submenu).getByRole("menuitem", { name: "Language" }));
    expect(data.setRelatedProject).toHaveBeenCalledWith("n1", "p-language");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    submenu = await projectMenu(user);
    await user.click(within(submenu).getByRole("menuitem", { name: enNotes.workspace.noProject }));
    expect(data.setRelatedProject).toHaveBeenLastCalledWith("n1", null);
  });

  it("says when the link fails", async () => {
    const user = userEvent.setup();
    renderRow({ data: fakeData({ setRelatedProject: vi.fn(async () => Promise.reject(new Error("gone"))) }) });
    await user.click(within(await projectMenu(user)).getByRole("menuitem", { name: "Vision" }));
    await waitFor(() => expect(log.logError).toHaveBeenCalledWith("set the note's project", expect.any(Error)));
    expect(toasts("error")).toEqual([enNotes.failures.linkNote.replace("{{name}}", "Masking ablation")]);
  });
});

describe("templates", () => {
  it("marks a note as a template and back", async () => {
    const user = userEvent.setup();
    const data = renderRow();
    await pick(user, menuCopy.useAsTemplate);
    await waitFor(() => expect(data.saveNote).toHaveBeenCalledWith("n1", expect.stringContaining("template: true"), "v1"));
    await waitFor(() => expect(toasts("success")).toEqual([menuCopy.templateOn.replace("{{name}}", "Masking ablation")]));
  });

  it("offers to stop using a template note", () => {
    renderRow({ note: { ...NOTE, properties: { template: true } } });
    expect(within(openMore()).getByRole("menuitem", { name: menuCopy.stopTemplate })).toBeInTheDocument();
  });

  it("says when the template flag could not be saved", async () => {
    const user = userEvent.setup();
    renderRow({ data: fakeData({ loadNote: vi.fn(async () => Promise.reject(new Error("gone"))) }) });
    await pick(user, menuCopy.useAsTemplate);
    await waitFor(() => expect(toasts("error")).toEqual([enNotes.failures.template.replace("{{name}}", "Masking ablation")]));
  });
});

describe("copy link", () => {
  it("copies the note's link from its front matter id", async () => {
    const user = userEvent.setup();
    renderRow();
    await pick(user, menuCopy.copyLink);
    await waitFor(() => expect(clipboard.writeClipboardText).toHaveBeenCalledWith("oleafly://note/masking-1"));
    await waitFor(() => expect(toasts("success")).toEqual([menuCopy.linkCopied.replace("{{name}}", "Masking ablation")]));
  });

  it("says so when the note has no link id", async () => {
    const user = userEvent.setup();
    renderRow({ data: fakeData({ loadNote: vi.fn(async () => ({ text: "Just text", version: "v1" })) }) });
    await pick(user, menuCopy.copyLink);
    await waitFor(() => expect(toasts("error")).toEqual([menuCopy.copyLinkFailed.replace("{{name}}", "Masking ablation")]));
    expect(clipboard.writeClipboardText).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("asks first, with a shortened title, then moves the note to the Recycle Bin", async () => {
    const user = userEvent.setup();
    const title = "A very long note title that keeps going past the limit";
    const data = renderRow({ note: { ...NOTE, title } });
    await pick(user, menuCopy.delete);
    const dialog = await screen.findByRole("alertdialog");
    const heading = within(dialog).getByRole("heading");
    expect(heading.textContent).toMatch(/^Move "A very long/u);
    expect(heading.textContent).not.toContain(title);
    expect(dialog).toHaveTextContent(menuCopy.deleteDescription);
    await user.click(within(dialog).getByRole("button", { name: menuCopy.deleteConfirm }));
    expect(data.deleteNote).toHaveBeenCalledExactlyOnceWith("n1");
    await waitFor(() => expect(toasts("success")).toEqual([menuCopy.deleted.replace("{{name}}", title)]));
  });

  it("keeps the note when cancelled and reports a delete that fails", async () => {
    const user = userEvent.setup();
    const deleteNote = vi.fn(async () => Promise.reject(new Error("busy")));
    renderRow({ data: fakeData({ deleteNote }) });
    await pick(user, menuCopy.delete);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`, "u") }),
    );
    expect(deleteNote).not.toHaveBeenCalled();
    await pick(user, menuCopy.delete);
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: menuCopy.deleteConfirm }));
    await waitFor(() => expect(toasts("error")).toEqual(['Couldn\'t delete "Masking ablation".']));
    expect(toasts("success")).toEqual([]);
    expect(log.logError).toHaveBeenCalledWith("delete note", expect.any(Error));
  });
});

describe("conflict copies", () => {
  it("marks a note with a cloud conflict copy and opens the compare dialog", async () => {
    useFilesStore.setState({ projects: [{ id: "n1", kind: "note", main_doc: "note.md" } as ProjectInfo] });
    useCloudStore.setState({
      state: { projects: [{ localId: "n1", conflictCopies: ["note (Laptop).md"] }] },
    } as unknown as Partial<ReturnType<typeof useCloudStore.getState>>);
    renderRow();
    expect(screen.getByRole("img", { name: enNotes.library.conflicts.badge })).toBeInTheDocument();
    fireEvent.click(within(openMore()).getByRole("menuitem", { name: menuCopy.compareConflict }));
    expect(
      await screen.findByRole("dialog", { name: enCloud.conflictCopy.title.replace("{{name}}", "Masking ablation") }),
    ).toBeInTheDocument();
  });
});

describe("version history", () => {
  it("offers Version history for a note and opens its versions", async () => {
    useFilesStore.setState({ projects: [{ id: "n1", kind: "note", main_doc: "note.md" } as ProjectInfo] });
    renderRow({ onOpenNoteInNewTab: vi.fn() });
    const menu = openMore();
    expect(itemNames(menu)).toEqual([
      menuCopy.openInNewTab,
      menuCopy.copyLink,
      enNotes.versions.title,
      menuCopy.export,
      menuCopy.favorite,
      menuCopy.rename,
      menuCopy.useAsTemplate,
      menuCopy.linkProject,
      menuCopy.delete,
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: enNotes.versions.title }));
    expect(await screen.findByRole("dialog", { name: enNotes.versions.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enNotes.versions.save })).toBeInTheDocument();
  });
});
