// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDateTime } from "@/lib/intl";
import type { CollabFileAtVersion, CollabHistoryEntry } from "@/lib/tauri";
import { BOB_ID, collabError, deferred, fill } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabHistoryFile: vi.fn(),
  collabHistoryRestore: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

import { HistoryVersionDialog } from "./HistoryVersionDialog";

const copy = enCollab.history;
const NOW = new Date(2026, 9, 24, 15, 0).getTime();

function entry(id: string, at: number, overrides: Partial<CollabHistoryEntry> = {}): CollabHistoryEntry {
  return { id, at, until: at, authors: [BOB_ID], files: ["intro.tex"], name: null, versionId: null, ...overrides };
}

function show(version: CollabHistoryEntry, initialPath: string | null = null, canRestore = true) {
  const onRestored = vi.fn();
  const onClose = vi.fn();
  render(
    <HistoryVersionDialog
      projectId="paper"
      entry={version}
      initialPath={initialPath}
      canRestore={canRestore}
      onRestored={onRestored}
      onClose={onClose}
    />,
  );
  return { dialog: screen.getByTestId("collab-history-version"), onRestored, onClose };
}

function fileButton(dialog: HTMLElement, path: string): HTMLElement {
  return within(dialog).getByRole("button", { name: path });
}

const cancel = new RegExp(`^${enCommon.actions.cancel}`);

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabHistoryFile.mockImplementation(async (_projectId: string, versionId: string, path: string) => ({
    path,
    text: `${path} at ${versionId}`,
    existed: true,
  }));
  mocks.collabHistoryRestore.mockResolvedValue(undefined);
});

describe("a version of the project", () => {
  it("opens the first changed file when no file is open, and switches between files", async () => {
    const { dialog } = show(entry("v3", NOW, { files: ["a.tex", "b.tex"] }));
    expect(await within(dialog).findByText("a.tex at v3")).toBeInTheDocument();
    expect(fileButton(dialog, "a.tex")).toHaveAttribute("aria-pressed", "true");
    expect(fileButton(dialog, "b.tex")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(fileButton(dialog, "b.tex"));
    expect(await within(dialog).findByText("b.tex at v3")).toBeInTheDocument();
    expect(fileButton(dialog, "b.tex")).toHaveAttribute("aria-pressed", "true");
    expect(mocks.collabHistoryFile).toHaveBeenLastCalledWith("paper", "v3", "b.tex");
  });

  it("puts the open file first even when this version didn't change it", async () => {
    const { dialog } = show(entry("v3", NOW, { files: ["a.tex"] }), "main.tex");
    const files = within(within(dialog).getByRole("list", { name: copy.files })).getAllByRole("button");
    expect(files.map((button) => button.textContent)).toEqual(["main.tex", "a.tex"]);
    expect(await within(dialog).findByText("main.tex at v3")).toBeInTheDocument();
  });

  it("says when no text file changed and no file is open", () => {
    const { dialog } = show(entry("v4", NOW, { files: [] }));
    expect(within(dialog).getByText(copy.noFiles)).toBeInTheDocument();
    expect(within(dialog).queryByText(copy.loadingFile)).toBeNull();
    expect(mocks.collabHistoryFile).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("button", { name: copy.restoreFile })).toBeNull();
    expect(within(dialog).getByRole("button", { name: copy.restoreProject })).toBeInTheDocument();
  });

  it("says when the file didn't exist in that version and offers no file restore", async () => {
    mocks.collabHistoryFile.mockResolvedValueOnce({ path: "new.tex", text: null, existed: false });
    const { dialog } = show(entry("v3", NOW), "new.tex");
    expect(await within(dialog).findByText(copy.fileMissing)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: copy.restoreFile })).toBeNull();
    expect(within(dialog).getByRole("button", { name: copy.restoreProject })).toBeInTheDocument();
  });

  it("says why a file couldn't load", async () => {
    mocks.collabHistoryFile.mockRejectedValueOnce(collabError("history_unavailable"));
    const { dialog } = show(entry("v3", NOW));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(enCollab.errors.history_unavailable);
    expect(within(dialog).queryByRole("button", { name: copy.restoreFile })).toBeNull();
  });

  it("keeps showing the file you picked when an earlier one finishes loading later", async () => {
    const slow = deferred<CollabFileAtVersion>();
    mocks.collabHistoryFile.mockReturnValueOnce(slow.promise);
    const { dialog } = show(entry("v3", NOW, { files: ["a.tex", "b.tex"] }));
    fireEvent.click(fileButton(dialog, "b.tex"));
    expect(await within(dialog).findByText("b.tex at v3")).toBeInTheDocument();
    await act(async () => {
      slow.resolve({ path: "a.tex", text: "stale a.tex", existed: true });
      await slow.promise;
    });
    expect(within(dialog).queryByText("stale a.tex")).toBeNull();
    expect(within(dialog).getByText("b.tex at v3")).toBeInTheDocument();
  });

  it("ignores a failure for a file you already moved away from", async () => {
    const slow = deferred<CollabFileAtVersion>();
    mocks.collabHistoryFile.mockReturnValueOnce(slow.promise);
    const { dialog } = show(entry("v3", NOW, { files: ["a.tex", "b.tex"] }));
    fireEvent.click(fileButton(dialog, "b.tex"));
    expect(await within(dialog).findByText("b.tex at v3")).toBeInTheDocument();
    await act(async () => {
      slow.reject(collabError("history_unavailable"));
      await slow.promise.catch(() => undefined);
    });
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByText("b.tex at v3")).toBeInTheDocument();
  });

  it("titles an unnamed version from before history began Earlier changes", async () => {
    const { dialog } = show(entry("v0", 0), "intro.tex");
    expect(within(dialog).getByRole("heading", { name: copy.earlier })).toBeInTheDocument();
    expect(within(dialog).getByText(copy.versionDescription)).toBeInTheDocument();
    expect(await within(dialog).findByText(fill(copy.fileLabel, { path: "intro.tex", time: copy.earlier }))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.restoreProject }));
    const confirm = await screen.findByRole("alertdialog", { name: copy.restoreProjectConfirm.title });
    expect(confirm).toHaveTextContent(fill(copy.restoreProjectConfirm.description, { time: copy.earlier }));
  });

  it("shows a named version's time under its name", () => {
    const { dialog } = show(entry("v2", NOW, { name: "Sent to reviewers", versionId: "name-1" }), "intro.tex");
    expect(within(dialog).getByRole("heading", { name: "Sent to reviewers" })).toBeInTheDocument();
    expect(within(dialog).getByText(formatDateTime(NOW))).toBeInTheDocument();
    expect(within(dialog).queryByText(copy.versionDescription)).toBeNull();
  });
});

describe("restoring a version", () => {
  it("keeps the dialog open and says why when restoring fails", async () => {
    mocks.collabHistoryRestore.mockRejectedValueOnce(collabError("forbidden"));
    const { dialog, onRestored, onClose } = show(entry("v3", NOW), "intro.tex");
    await within(dialog).findByText("intro.tex at v3");
    fireEvent.click(within(dialog).getByRole("button", { name: copy.restoreFile }));
    const confirm = await screen.findByRole("alertdialog", { name: fill(copy.restoreFileConfirm.title, { path: "intro.tex" }) });
    fireEvent.click(within(confirm).getByRole("button", { name: new RegExp(`^${copy.restoreFileConfirm.confirm}`) }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(mocks.collabHistoryRestore).toHaveBeenCalledWith("paper", "v3", ["intro.tex"]);
    expect(onRestored).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: copy.restoreFile })).toBeEnabled());
  });

  it("restores nothing when either confirmation is cancelled", async () => {
    const { dialog, onRestored } = show(entry("v3", NOW), "intro.tex");
    await within(dialog).findByText("intro.tex at v3");
    fireEvent.click(within(dialog).getByRole("button", { name: copy.restoreFile }));
    const fileConfirm = await screen.findByRole("alertdialog", { name: fill(copy.restoreFileConfirm.title, { path: "intro.tex" }) });
    fireEvent.click(within(fileConfirm).getByRole("button", { name: cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(within(dialog).getByRole("button", { name: copy.restoreProject }));
    const projectConfirm = await screen.findByRole("alertdialog", { name: copy.restoreProjectConfirm.title });
    fireEvent.click(within(projectConfirm).getByRole("button", { name: cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.collabHistoryRestore).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("closes from the close button", () => {
    const { dialog, onClose } = show(entry("v3", NOW), "intro.tex", false);
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
