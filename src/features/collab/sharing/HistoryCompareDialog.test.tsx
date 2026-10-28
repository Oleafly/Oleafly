// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabFileAtVersion, CollabHistoryEntry } from "@/lib/tauri";
import { BOB_ID, collabError, deferred, fill } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabHistoryChangedFiles: vi.fn(),
  collabHistoryFile: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

vi.mock("@/components/ai/turns/DiffPreview", () => ({
  DiffPreview: ({ path, oldText, newText }: { path: string; oldText: string; newText: string }) => (
    <div data-testid={`diff-${path}`}>{`${oldText} -> ${newText}`}</div>
  ),
}));

import { HistoryCompareDialog } from "./HistoryCompareDialog";

const copy = enCollab.history;
const NOW = new Date(2026, 9, 24, 15, 0).getTime();

function entry(id: string, at: number, overrides: Partial<CollabHistoryEntry> = {}): CollabHistoryEntry {
  return { id, at, until: at, authors: [BOB_ID], files: ["intro.tex"], name: null, versionId: null, ...overrides };
}

const early = entry("v1", 0);
const named = entry("v2", NOW, { name: "Sent to reviewers", versionId: "name-1" });

function show() {
  const onClose = vi.fn();
  const view = render(<HistoryCompareDialog projectId="paper" older={early} newer={named} onClose={onClose} />);
  return { ...view, dialog: screen.getByTestId("collab-history-compare"), onClose };
}

function fileButton(path: string): HTMLElement {
  return screen.getByRole("button", { name: path });
}

function file(path: string, versionId: string): CollabFileAtVersion {
  return { path, text: `${path} at ${versionId}`, existed: true };
}

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabHistoryFile.mockImplementation(async (_projectId: string, versionId: string, path: string) =>
    file(path, versionId),
  );
});

describe("comparing two versions", () => {
  it("names both versions and says when no text changed between them", async () => {
    mocks.collabHistoryChangedFiles.mockResolvedValueOnce([]);
    const { dialog } = show();
    expect(within(dialog).getByText(copy.loadingFile)).toBeInTheDocument();
    expect(within(dialog).getByText(fill(copy.compareDescription, { from: copy.earlier, to: "Sent to reviewers" }))).toBeInTheDocument();
    expect(await within(dialog).findByText(copy.noChanges)).toBeInTheDocument();
    expect(mocks.collabHistoryChangedFiles).toHaveBeenCalledWith("paper", "v1", "v2");
    expect(within(dialog).queryByText(copy.loadingFile)).toBeNull();
  });

  it("says why the changed files couldn't load", async () => {
    mocks.collabHistoryChangedFiles.mockRejectedValueOnce(collabError("history_unavailable"));
    const { dialog } = show();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(enCollab.errors.history_unavailable);
    expect(within(dialog).queryByText(copy.noChanges)).toBeNull();
  });

  it("marks new and removed files and opens only the first three diffs", async () => {
    mocks.collabHistoryChangedFiles.mockResolvedValueOnce(["new.tex", "gone.tex", "same.tex", "later.tex"]);
    mocks.collabHistoryFile.mockImplementation(async (_projectId: string, versionId: string, path: string) => {
      if (path === "new.tex" && versionId === "v1") return { path, text: null, existed: false };
      if (path === "gone.tex" && versionId === "v2") return { path, text: null, existed: false };
      return file(path, versionId);
    });
    const { dialog } = show();
    const list = await within(dialog).findByRole("list", { name: fill(copy.changedFiles, { number: "4" }) });
    const items = within(list).getAllByRole("listitem");
    expect(await within(items[0]).findByTestId("diff-new.tex")).toHaveTextContent("-> new.tex at v2");
    expect(within(items[0]).getByText(enCollab.mergeReview.newFile)).toBeInTheDocument();
    expect(await within(items[1]).findByTestId("diff-gone.tex")).toHaveTextContent("gone.tex at v1 ->");
    expect(within(items[1]).getByText(enCollab.mergeReview.removedFile)).toBeInTheDocument();
    expect(await within(items[2]).findByTestId("diff-same.tex")).toHaveTextContent("same.tex at v1 -> same.tex at v2");
    expect(within(items[2]).queryByText(enCollab.mergeReview.newFile)).toBeNull();
    expect(within(items[2]).queryByText(enCollab.mergeReview.removedFile)).toBeNull();
    expect(fileButton("later.tex")).toHaveAttribute("aria-expanded", "false");
    expect(fileButton("later.tex")).not.toHaveAttribute("aria-controls");
    expect(within(items[3]).queryByTestId("diff-later.tex")).toBeNull();
    expect(mocks.collabHistoryFile).not.toHaveBeenCalledWith("paper", expect.any(String), "later.tex");
  });

  it("keeps at most three diffs open as files are opened and closed", async () => {
    const paths = ["a.tex", "b.tex", "c.tex", "d.tex"];
    mocks.collabHistoryChangedFiles.mockResolvedValueOnce(paths);
    show();
    expect(await screen.findByTestId("diff-a.tex")).toBeInTheDocument();
    fireEvent.click(fileButton("a.tex"));
    expect(fileButton("a.tex")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("diff-a.tex")).toBeNull();
    fireEvent.click(fileButton("d.tex"));
    expect(await screen.findByTestId("diff-d.tex")).toBeInTheDocument();
    fireEvent.click(fileButton("a.tex"));
    expect(await screen.findByTestId("diff-a.tex")).toBeInTheDocument();
    expect(paths.map((path) => fileButton(path).getAttribute("aria-expanded"))).toEqual(["true", "false", "true", "true"]);
    expect(screen.queryByTestId("diff-b.tex")).toBeNull();
  });

  it("says why one file's changes couldn't load and still shows the others", async () => {
    mocks.collabHistoryChangedFiles.mockResolvedValueOnce(["a.tex", "b.tex"]);
    mocks.collabHistoryFile.mockImplementation(async (_projectId: string, versionId: string, path: string) => {
      if (path === "b.tex") throw collabError("history_unavailable");
      return file(path, versionId);
    });
    show();
    const items = within(await screen.findByRole("list", { name: fill(copy.changedFiles, { number: "2" }) })).getAllByRole(
      "listitem",
    );
    expect(await within(items[1]).findByRole("alert")).toHaveTextContent(enCollab.errors.history_unavailable);
    expect(await within(items[0]).findByTestId("diff-a.tex")).toHaveTextContent("a.tex at v1 -> a.tex at v2");
  });

  it("loads a diff afresh after it was closed while still loading", async () => {
    mocks.collabHistoryChangedFiles.mockResolvedValueOnce(["a.tex"]);
    const slow = deferred<CollabFileAtVersion>();
    mocks.collabHistoryFile.mockImplementationOnce(() => slow.promise);
    show();
    const button = await screen.findByRole("button", { name: "a.tex" });
    fireEvent.click(button);
    slow.resolve({ path: "a.tex", text: "stale", existed: true });
    await settle();
    expect(screen.queryByTestId("diff-a.tex")).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByTestId("diff-a.tex")).toHaveTextContent("a.tex at v1 -> a.tex at v2");
  });

  it("drops a failure for a diff that was closed while still loading", async () => {
    mocks.collabHistoryChangedFiles.mockResolvedValueOnce(["a.tex"]);
    const slow = deferred<CollabFileAtVersion>();
    mocks.collabHistoryFile.mockImplementationOnce(() => slow.promise);
    show();
    const button = await screen.findByRole("button", { name: "a.tex" });
    fireEvent.click(button);
    slow.reject(collabError("history_unavailable"));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByTestId("diff-a.tex")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for no diffs once the dialog closed before the changed files arrived", async () => {
    const listed = deferred<string[]>();
    const failed = deferred<string[]>();
    mocks.collabHistoryChangedFiles.mockReturnValueOnce(listed.promise).mockReturnValueOnce(failed.promise);
    show().unmount();
    show().unmount();
    listed.resolve(["a.tex"]);
    failed.reject(collabError("history_unavailable"));
    await settle();
    expect(mocks.collabHistoryChangedFiles).toHaveBeenCalledTimes(2);
    expect(mocks.collabHistoryFile).not.toHaveBeenCalled();
  });

  it("closes from the close button", async () => {
    mocks.collabHistoryChangedFiles.mockResolvedValueOnce([]);
    const { dialog, onClose } = show();
    await within(dialog).findByText(copy.noChanges);
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
