// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useCollabLiveStore } from "../live/live-store";
import type { CollabMergeReviewFile } from "@/lib/tauri";
import { BOB, BOB_ID, CAROL_ID, collabError, deferred, fill, person, projectMember } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({ collabMergeReview: vi.fn() }));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabMergeReview: mocks.collabMergeReview,
}));

vi.mock("@/components/ai/turns/DiffPreview", () => ({
  DiffPreview: ({ path, oldText, newText, label }: { path: string; oldText: string; newText: string; label: string }) => (
    <pre data-testid="diff" data-path={path} data-label={label}>
      {`${oldText}|${newText}`}
    </pre>
  ),
}));

import { MAX_OPEN_DIFFS, MergeReviewDialog } from "./MergeReviewDialog";

const copy = enCollab.mergeReview;
const onClose = vi.fn();

const entry = {
  files: [
    { path: "main.tex", changes: 3 },
    { path: "notes.md", changes: 1 },
  ],
  authors: [
    { accountId: BOB_ID, files: [{ path: "main.tex", changes: 2 }] },
    {
      accountId: CAROL_ID,
      files: [
        { path: "main.tex", changes: 1 },
        { path: "notes.md", changes: 1 },
      ],
    },
  ],
  review: { before: "before-mark", after: "after-mark" },
};

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabLiveStore.setState({ members: [projectMember(BOB, "owner"), projectMember(person(), "editor")] });
});

describe("MergeReviewDialog", () => {
  it("lists each person and file with change counts and shows each file before and after", async () => {
    mocks.collabMergeReview.mockResolvedValue([
      { path: "main.tex", before: "old main", after: "new main" },
      { path: "notes.md", before: null, after: "fresh notes" },
    ]);
    render(<MergeReviewDialog projectId="grant" entry={entry} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: copy.title });
    expect(mocks.collabMergeReview).toHaveBeenCalledWith("grant", "before-mark", "after-mark");
    const people = within(dialog).getByRole("list", { name: copy.people });
    expect(within(people).getByText(fill(copy.person, { name: "Bob Smith", number: "2" }))).toBeInTheDocument();
    expect(
      within(people).getByText(fill(copy.person, { name: enCollab.toolbar.unknownPerson, number: "2" })),
    ).toBeInTheDocument();
    expect(
      within(people).getAllByText(fill(enCollab.activity.mergedFile, { path: "main.tex", number: "1" })),
    ).toHaveLength(1);
    const diffs = await within(dialog).findAllByTestId("diff");
    expect(diffs.map((diff) => [diff.dataset.path, diff.textContent])).toEqual([
      ["main.tex", "old main|new main"],
      ["notes.md", "|fresh notes"],
    ]);
    expect(diffs[0].dataset.label).toBe(fill(copy.diffLabel, { path: "main.tex" }));
    const files = within(dialog).getByRole("list", { name: copy.files });
    expect(within(files).getByText(fill(enCollab.activity.mergedFile, { path: "main.tex", number: "3" }))).toBeInTheDocument();
    expect(within(files).getByText(copy.newFile)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });

  it("compares only a few files at once after a long time offline, and opens others on request", async () => {
    const changed = Array.from({ length: 30 }, (_, index) => ({
      path: `chapter-${String(index + 1).padStart(2, "0")}.tex`,
      before: `old ${index}`,
      after: `new ${index}`,
    }));
    mocks.collabMergeReview.mockResolvedValue(changed);
    const user = userEvent.setup();
    render(<MergeReviewDialog projectId="grant" entry={{ files: [] }} onClose={onClose} />);
    const shown = async () => (await screen.findAllByTestId("diff")).map((diff) => diff.dataset.path);
    expect(MAX_OPEN_DIFFS).toBe(3);
    expect(await shown()).toEqual(["chapter-01.tex", "chapter-02.tex", "chapter-03.tex"]);
    const row = (path: string) =>
      screen.getByRole("button", { name: fill(enCollab.activity.mergedFile, { path, number: "0" }) });
    expect(row("chapter-10.tex")).toHaveAttribute("aria-expanded", "false");
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await user.click(row("chapter-10.tex"));
    expect(row("chapter-10.tex")).toHaveAttribute("aria-expanded", "true");
    expect(await shown()).toEqual(["chapter-02.tex", "chapter-03.tex", "chapter-10.tex"]);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent(fill(copy.closedOldest, { number: "3", path: "chapter-01.tex" }));
    await user.click(row("chapter-02.tex"));
    expect(await shown()).toEqual(["chapter-03.tex", "chapter-10.tex"]);
    expect(status).toBeEmptyDOMElement();
    expect(row("chapter-01.tex")).toHaveAttribute("aria-expanded", "false");
  });

  it("says when no text changed and closes from its close button", async () => {
    mocks.collabMergeReview.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<MergeReviewDialog projectId="grant" entry={entry} onClose={onClose} />);
    expect(await screen.findByText(copy.noText)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: enCommon.actions.close })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("explains when the changes cannot be loaded", async () => {
    mocks.collabMergeReview.mockRejectedValue(collabError("internal", "gone"));
    render(<MergeReviewDialog projectId="grant" entry={entry} onClose={onClose} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.failed);
  });

  it("asks for the merge with empty versions and leaves out people when none were recorded", async () => {
    mocks.collabMergeReview.mockResolvedValue([]);
    render(<MergeReviewDialog projectId="grant" entry={{ files: entry.files, authors: [] }} onClose={onClose} />);
    expect(await screen.findByText(copy.noText)).toBeInTheDocument();
    expect(mocks.collabMergeReview).toHaveBeenCalledWith("grant", "", "");
    expect(screen.queryByRole("list", { name: copy.people })).toBeNull();
    expect(screen.queryByText(copy.people)).toBeNull();
  });

  it("marks a file the merge removed and counts no changes for a file the entry did not list", async () => {
    mocks.collabMergeReview.mockResolvedValue([{ path: "old.tex", before: "gone text", after: null }]);
    render(<MergeReviewDialog projectId="grant" entry={entry} onClose={onClose} />);
    const files = await screen.findByRole("list", { name: copy.files });
    expect(within(files).getByText(fill(enCollab.activity.mergedFile, { path: "old.tex", number: "0" }))).toBeInTheDocument();
    expect(within(files).getByText(copy.removedFile)).toBeInTheDocument();
    expect(within(files).queryByText(copy.newFile)).toBeNull();
    expect(within(files).getByTestId("diff")).toHaveTextContent("gone text|");
  });

  it("shows the merge it was last asked for when an earlier review answers late", async () => {
    const stale = deferred<CollabMergeReviewFile[]>();
    mocks.collabMergeReview.mockImplementation((_project: string, before: string) =>
      before === "before-mark" ? stale.promise : Promise.resolve([{ path: "next.tex", before: "a", after: "b" }]),
    );
    const view = render(<MergeReviewDialog projectId="grant" entry={entry} onClose={onClose} />);
    const next = { ...entry, review: { before: "next-before", after: "next-after" } };
    view.rerender(<MergeReviewDialog projectId="grant" entry={next} onClose={onClose} />);
    expect(await screen.findByTestId("diff")).toHaveAttribute("data-path", "next.tex");
    await act(async () => stale.resolve([{ path: "main.tex", before: "old", after: "new" }]));
    expect(screen.getAllByTestId("diff").map((diff) => diff.dataset.path)).toEqual(["next.tex"]);
  });

  it("does not report a failure from a review it no longer shows", async () => {
    const stale = deferred<CollabMergeReviewFile[]>();
    mocks.collabMergeReview.mockImplementation((_project: string, before: string) =>
      before === "before-mark" ? stale.promise : Promise.resolve([{ path: "next.tex", before: "a", after: "b" }]),
    );
    const view = render(<MergeReviewDialog projectId="grant" entry={entry} onClose={onClose} />);
    await waitFor(() => expect(mocks.collabMergeReview).toHaveBeenCalledTimes(1));
    view.rerender(
      <MergeReviewDialog projectId="grant" entry={{ ...entry, review: { before: "b2", after: "a2" } }} onClose={onClose} />,
    );
    expect(await screen.findByTestId("diff")).toBeInTheDocument();
    await act(async () => stale.reject(collabError("internal")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("diff")).toHaveAttribute("data-path", "next.tex");
  });
});
