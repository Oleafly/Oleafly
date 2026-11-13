// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import type { NotesImportOutcome, NotesImportProgress } from "@/lib/tauri";
import { deferred } from "./tests/notes-data-fixture";
import "./tests/setup";

const copy = enNotes.vault.import;
const mocks = vi.hoisted(() => ({
  importFolder: vi.fn(),
  cancelImport: vi.fn(),
  exportFolder: vi.fn(),
  revealInDir: vi.fn(),
  success: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("./note-vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./note-vault")>();
  return { ...actual, importFolder: mocks.importFolder, cancelImport: mocks.cancelImport, exportFolder: mocks.exportFolder };
});
vi.mock("@/lib/tauri", () => ({ revealInDir: mocks.revealInDir }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { NoteExportDialog, NoteImportDialog, VaultMoreMenu } from "./NoteImportDialog";

type Progress = (progress: NotesImportProgress) => void;

function coded(code: string, params: Record<string, string>): string {
  return `${APP_ERROR_PREFIX}${JSON.stringify({ code, params })}`;
}

beforeAll(async () => {
  await loadNamespace("common");
  await loadNamespace("errors");
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.cancelImport.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderImport() {
  const onClose = vi.fn();
  const onImported = vi.fn();
  const utils = render(<NoteImportDialog open onClose={onClose} onImported={onImported} />);
  return { ...utils, onClose, onImported };
}

describe("NoteImportDialog", () => {
  it("imports picked Markdown files and reports a failed file import", async () => {
    const user = userEvent.setup();
    mocks.importFolder
      .mockResolvedValueOnce({ kind: "done", notes: 2, attachments: 1, unresolved: 0, skipped: 0, cancelled: false, notCopied: [], skippedNotes: [] })
      .mockRejectedValueOnce(new Error("denied"));
    const { onImported } = renderImport();
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.chooseFiles }));
    expect(mocks.importFolder).toHaveBeenCalledWith(
      expect.any(String),
      { folderTags: false, again: false, confirmLarge: true, files: true },
      expect.any(Function),
    );
    expect(await screen.findByText(copy.notes_other.replace("{{count}}", "2"))).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: copy.done }));
    await user.click(screen.getByRole("button", { name: copy.chooseFiles }));
    expect(await screen.findByText(copy.failed)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("denied");
    expect(mocks.logError).toHaveBeenCalledWith("import Markdown files", expect.any(Error));
  });

  it("names the file picker while files are being chosen", async () => {
    const user = userEvent.setup();
    mocks.importFolder.mockReturnValue(new Promise(() => {}));
    renderImport();
    await user.click(screen.getByRole("button", { name: copy.chooseFiles }));
    expect(screen.getByText(copy.filesPickerTitle)).toBeInTheDocument();
    expect(screen.queryByText(copy.pickerTitle)).not.toBeInTheDocument();
  });

  it("shows the reason the backend gave for a failed import", async () => {
    const user = userEvent.setup();
    mocks.importFolder.mockRejectedValueOnce(new Error("There isn't enough free disk space for this import."));
    renderImport();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy.failed);
    expect(alert).toHaveTextContent("There isn't enough free disk space for this import.");
  });

  it("shows the English sentence for a coded import error", async () => {
    const user = userEvent.setup();
    mocks.importFolder.mockRejectedValueOnce(coded("notes.import_no_space", { size: "3" }));
    renderImport();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy.failed);
    expect(alert).toHaveTextContent(enErrors.notes.import_no_space.replace("{{size}}", "3"));
    expect(alert).not.toHaveTextContent("@oleafly/error");
  });

  it("imports a folder with progress and shows the summary", async () => {
    const user = userEvent.setup();
    const run = deferred<NotesImportOutcome>();
    let report: Progress = () => {};
    mocks.importFolder.mockImplementation((_runId: string, _choice: unknown, onProgress: Progress) => {
      report = onProgress;
      return run.promise;
    });
    const { onImported, onClose } = renderImport();
    await user.click(screen.getByRole("checkbox", { name: new RegExp(copy.folderTags) }));
    await user.click(screen.getByRole("button", { name: copy.choose }));
    expect(mocks.importFolder).toHaveBeenCalledWith(expect.any(String), { folderTags: true, again: false, confirmLarge: true }, expect.any(Function));
    expect(screen.getByText(copy.pickerTitle)).toBeInTheDocument();
    act(() => report({ phase: "read", done: 1, total: 2, file: "Alpha.md" }));
    expect(screen.getByText("Reading Alpha.md")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    act(() => report({ phase: "write", done: 2, total: 2, file: "Beta.md" }));
    expect(screen.getByText("Importing Beta.md")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await act(async () =>
      run.resolve({
        kind: "done",
        notes: 2,
        attachments: 1,
        unresolved: 3,
        skipped: 1,
        cancelled: false,
        notCopied: ["figures/plot.png", "../data/table.csv"],
        skippedNotes: ["huge.md"],
      }),
    );
    expect(onImported).toHaveBeenCalled();
    expect(screen.getByText(copy.doneTitle)).toBeInTheDocument();
    expect(screen.getByText("2 notes imported")).toBeInTheDocument();
    expect(screen.getByText("1 attachment copied")).toBeInTheDocument();
    expect(screen.getByText("3 links didn't match a note and stay as text")).toBeInTheDocument();
    const skipped = screen.getByText("1 file skipped because it's larger than 5 MB or couldn't be read");
    expect(within(skipped).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["huge.md"]);
    const notCopied = screen.getByText("2 linked files weren't copied");
    expect(within(notCopied).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "figures/plot.png",
      "../data/table.csv",
    ]);
    act(() => report({ phase: "write", done: 2, total: 2, file: "late.md" }));
    await user.click(screen.getByRole("button", { name: copy.done }));
    expect(onClose).toHaveBeenCalled();
  });

  it("asks before importing a folder again and reuses the run", async () => {
    const user = userEvent.setup();
    mocks.importFolder
      .mockResolvedValueOnce({ kind: "seen", importedAt: Date.UTC(2026, 10, 1), notes: 4 })
      .mockResolvedValueOnce({ kind: "done", notes: 0, attachments: 0, unresolved: 0, skipped: 0, cancelled: false, notCopied: [], skippedNotes: [] });
    const { onImported } = renderImport();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    expect(await screen.findByText(copy.seenTitle)).toBeInTheDocument();
    expect(screen.getByText(/added 4 notes/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.again }));
    const [firstRun] = mocks.importFolder.mock.calls[0] as [string];
    expect(mocks.importFolder).toHaveBeenLastCalledWith(firstRun, { folderTags: false, again: true, confirmLarge: true }, expect.any(Function));
    expect(await screen.findByText("0 notes imported")).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("asks before importing thousands of notes and writes nothing until confirmed", async () => {
    const user = userEvent.setup();
    mocks.importFolder
      .mockResolvedValueOnce({ kind: "large", notes: 4_000 })
      .mockResolvedValueOnce({ kind: "done", notes: 4_000, attachments: 0, unresolved: 0, skipped: 0, cancelled: false, notCopied: [], skippedNotes: [] });
    const { onImported } = renderImport();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    expect(await screen.findByText(copy.largeTitle.replace("{{total}}", "4,000"))).toBeInTheDocument();
    const [firstRun, firstChoice] = mocks.importFolder.mock.calls[0] as [string, unknown];
    expect(firstChoice).toEqual({ folderTags: false, again: false, confirmLarge: true });
    expect(onImported).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: copy.largeConfirm }));
    expect(mocks.importFolder).toHaveBeenLastCalledWith(firstRun, { folderTags: false, again: true, confirmLarge: false }, expect.any(Function));
    expect(await screen.findByText("4000 notes imported")).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledOnce();
  });

  it.each([
    [{ kind: "seen", importedAt: 1, notes: 1 } as const, copy.seenTitle],
    [{ kind: "large", notes: 2_000 } as const, copy.largeTitle.replace("{{total}}", "2,000")],
  ])("forgets the held folder when the %o import is cancelled", async (outcome, title) => {
    const user = userEvent.setup();
    mocks.importFolder.mockResolvedValueOnce(outcome);
    mocks.cancelImport.mockRejectedValueOnce(new Error("gone"));
    const { onClose } = renderImport();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    await screen.findByText(title);
    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(mocks.cancelImport).toHaveBeenCalled();
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("forget the Markdown import", expect.any(Error)));
    expect(onClose).toHaveBeenCalled();
  });

  it("stops a running import from the button and from closing", async () => {
    const user = userEvent.setup();
    const run = deferred<NotesImportOutcome>();
    mocks.importFolder.mockReturnValue(run.promise);
    mocks.cancelImport.mockRejectedValueOnce(new Error("late"));
    const { onClose } = renderImport();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    await user.click(screen.getByRole("button", { name: copy.stop }));
    expect(screen.getByRole("button", { name: copy.stop })).toBeDisabled();
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("stop the Markdown import", expect.any(Error)));
    await user.keyboard("{Escape}");
    expect(mocks.cancelImport).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => run.resolve({ kind: "done", notes: 0, attachments: 0, unresolved: 0, skipped: 0, cancelled: true, notCopied: [], skippedNotes: [] }));
    expect(screen.getByText(copy.cancelled)).toBeInTheDocument();
  });

  it("goes back to the options when the picker is dismissed and reports failures", async () => {
    const user = userEvent.setup();
    mocks.importFolder.mockResolvedValueOnce({ kind: "dismissed" }).mockRejectedValueOnce(new Error("denied"));
    const { onClose } = renderImport();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    expect(await screen.findByRole("button", { name: copy.choose })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.choose }));
    expect(await screen.findByText(copy.failed)).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalledWith("import a Markdown folder", expect.any(Error));
    await user.click(screen.getByRole("button", { name: copy.done }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes from the options with cancel", async () => {
    const user = userEvent.setup();
    const { onClose } = renderImport();
    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.cancelImport).not.toHaveBeenCalled();
  });
});

describe("NoteExportDialog", () => {
  it("exports the open note or every note and offers to show the folder", async () => {
    const user = userEvent.setup();
    mocks.exportFolder.mockResolvedValue({ folder: "/out/Alpha", notes: 1, attachments: 0, skipped: 0, paperLinks: [] });
    mocks.revealInDir.mockRejectedValueOnce(new Error("no"));
    const onClose = vi.fn();
    render(<NoteExportDialog open note={{ id: "n1", title: "Alpha" }} total={3} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: copy.export.export }));
    expect(mocks.exportFolder).toHaveBeenCalledWith({ id: "n1", title: "Alpha" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [message, action] = mocks.success.mock.calls[0] as [string, { label: string; onClick: () => void }];
    expect(message).toBe("Exported 1 note");
    expect(action.label).toBe(copy.export.showFolder);
    action.onClick();
    expect(mocks.revealInDir).toHaveBeenCalledWith("/out/Alpha");
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("show the exported notes", expect.any(Error)));
    await user.click(screen.getByRole("radio", { name: "All notes (3)" }));
    await user.click(screen.getByRole("button", { name: copy.export.export }));
    expect(mocks.exportFolder).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole("radio", { name: "This note: Alpha" }));
    mocks.revealInDir.mockResolvedValueOnce(undefined);
  });

  it("keeps the dialog open when the picker is dismissed and reports failures", async () => {
    const user = userEvent.setup();
    mocks.exportFolder.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("disk"));
    const onClose = vi.fn();
    render(<NoteExportDialog open note={null} total={2} onClose={onClose} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.export.export }));
    expect(mocks.exportFolder).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.export.export }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy.export.failed);
    expect(alert).toHaveTextContent("disk");
    expect(mocks.logError).toHaveBeenCalledWith("export notes", expect.any(Error));
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the English sentence for a coded export error and clears it on the next try", async () => {
    const user = userEvent.setup();
    mocks.exportFolder.mockRejectedValueOnce(coded("notes.export_write_failed", { name: "Alpha.md" })).mockResolvedValueOnce(null);
    render(<NoteExportDialog open note={null} total={2} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: copy.export.export }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy.export.failed);
    expect(alert).toHaveTextContent(enErrors.notes.export_write_failed.replace("{{name}}", "Alpha.md"));
    expect(alert).not.toHaveTextContent("@oleafly/error");
    await user.click(screen.getByRole("button", { name: copy.export.export }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("says how many attachments and paper links could not be exported", async () => {
    const user = userEvent.setup();
    mocks.exportFolder.mockResolvedValueOnce({ folder: "/out/Notes", notes: 3, attachments: 4, skipped: 2, paperLinks: ["Masking paper"] });
    const onClose = vi.fn();
    render(<NoteExportDialog open note={null} total={3} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: copy.export.export }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [message] = mocks.success.mock.calls[0] as [string];
    expect(message).toBe("Exported 3 notes. 2 attachments couldn't be exported and 1 link to a paper became plain text.");
  });

  it("cannot export an empty library", () => {
    render(<NoteExportDialog open note={null} total={0} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: copy.export.export })).toBeDisabled();
  });
});

describe("VaultMoreMenu", () => {
  it("runs the menu entries after the menu closes", async () => {
    const user = userEvent.setup();
    const onImportFolder = vi.fn();
    const onExportFolder = vi.fn();
    render(<VaultMoreMenu onImportFolder={onImportFolder} onExportFolder={onExportFolder} />);
    await user.click(screen.getByRole("button", { name: copy.more }));
    await user.click(await screen.findByRole("menuitem", { name: copy.menu }));
    await waitFor(() => expect(onImportFolder).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: copy.more }));
    await user.click(await screen.findByRole("menuitem", { name: copy.export.menu }));
    await waitFor(() => expect(onExportFolder).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: copy.more }));
    await user.keyboard("{Escape}");
    expect(onImportFolder).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without actions", () => {
    const { container } = render(<VaultMoreMenu />);
    expect(container).toBeEmptyDOMElement();
  });
});
