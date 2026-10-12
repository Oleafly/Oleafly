// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useCollabLiveStore } from "../live/live-store";
import { BOB, BOB_ID, CAROL_ID, collabError, fill, person, projectMember } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({ collabMergeReview: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabMergeReview: mocks.collabMergeReview,
}));

vi.mock("@/components/ai/turns/DiffPreview", () => ({
  DiffPreview: ({ path, oldText, newText, label }: { path: string; oldText: string; newText: string; label: string }) => (
    <pre data-testid="diff" data-path={path} data-label={label}>
      {`${oldText}|${newText}`}
    </pre>
  ),
}));

import { MergeReviewDialog } from "./MergeReviewDialog";

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
});
