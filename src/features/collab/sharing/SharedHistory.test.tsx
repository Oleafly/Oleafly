// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDate, formatTime } from "@/lib/intl";
import type { CollabHistoryEntry, CollabProjectRole } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabHistoryList: vi.fn(),
  collabHistoryFile: vi.fn(),
  collabHistoryChangedFiles: vi.fn(),
  collabHistoryRestore: vi.fn(),
  collabVersionName: vi.fn(),
  collabVersionUnname: vi.fn(),
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

import { SharedHistory } from "./SharedHistory";

const copy = enCollab.history;
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 24, 15, 0).getTime();
const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];

function entry(id: string, at: number, overrides: Partial<CollabHistoryEntry> = {}): CollabHistoryEntry {
  return { id, at, until: at, authors: [BOB_ID], files: ["intro.tex"], name: null, versionId: null, ...overrides };
}

const today = entry("v3", NOW - 60_000, { authors: [BOB_ID, ALICE_ID] });
const named = entry("v2", NOW - 3_600_000, { name: "Sent to reviewers", versionId: "name-1", files: ["a.tex", "b.tex"] });
const yesterday = entry("v1", NOW - DAY);
const early = entry("v0", 0, { authors: [] });

function live(role: CollabProjectRole) {
  useCollabLiveStore.setState({
    projectId: "paper",
    role,
    status: { state: "online" },
    members: MEMBERS,
    share: shareInfo({ project_id: "paper", role, account_id: ALICE_ID }),
  });
}

function show(role: CollabProjectRole = "editor") {
  live(role);
  return render(<SharedHistory open onOpenChange={() => undefined} />);
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabHistoryList.mockResolvedValue({ entries: [today, named, yesterday, early], nextBefore: null });
  mocks.collabHistoryFile.mockImplementation(async (_projectId: string, versionId: string, path: string) => ({
    path,
    text: `${path} at ${versionId}`,
    existed: true,
  }));
  mocks.collabHistoryRestore.mockResolvedValue(undefined);
  mocks.collabVersionName.mockResolvedValue(undefined);
  mocks.collabVersionUnname.mockResolvedValue(undefined);
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex" });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, role: null, status: null, share: null, members: [] });
});

describe("shared history", () => {
  it("groups versions by day, newest first, with earlier changes last", async () => {
    show();
    await screen.findByText("Sent to reviewers");
    expect(mocks.collabHistoryList).toHaveBeenCalledWith("paper", null, 50);
    const days = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-label"))
      .filter((name) => name !== copy.title);
    expect(days).toEqual([
      formatDate(today.at, { dateStyle: "full" }),
      formatDate(yesterday.at, { dateStyle: "full" }),
      copy.earlier,
    ]);
    const first = screen.getByRole("region", { name: formatDate(today.at, { dateStyle: "full" }) });
    expect(within(first).getByText(formatTime(today.at))).toBeInTheDocument();
    expect(within(first).getByText("Bob Smith and Alice Chen")).toBeInTheDocument();
    expect(within(first).getByText(fill(copy.filesChanged, { number: "2" }))).toBeInTheDocument();
  });

  it("loads older versions from where the list stops", async () => {
    mocks.collabHistoryList
      .mockResolvedValueOnce({ entries: [today], nextBefore: "cursor-1" })
      .mockResolvedValueOnce({ entries: [yesterday], nextBefore: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: copy.loadMore }));
    await waitFor(() => expect(mocks.collabHistoryList).toHaveBeenLastCalledWith("paper", "cursor-1", 50));
    expect(await screen.findByRole("region", { name: formatDate(yesterday.at, { dateStyle: "full" }) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("opens a version read-only and restores the file after asking", async () => {
    show("owner");
    const row = (await screen.findByText(formatTime(today.at))).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: copy.open }));
    const dialog = await screen.findByTestId("collab-history-version");
    expect(await within(dialog).findByText("intro.tex at v3")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.restoreFile }));
    const confirm = await screen.findByRole("alertdialog", { name: fill(copy.restoreFileConfirm.title, { path: "intro.tex" }) });
    expect(mocks.collabHistoryRestore).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: new RegExp(`^${copy.restoreFileConfirm.confirm}`) }));
    await waitFor(() => expect(mocks.collabHistoryRestore).toHaveBeenCalledWith("paper", "v3", ["intro.tex"]));
    await waitFor(() => expect(screen.queryByTestId("collab-history-version")).toBeNull());
  });

  it("restores the whole project only after a confirmation", async () => {
    show("editor");
    const row = (await screen.findByText("Sent to reviewers")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: copy.open }));
    const dialog = await screen.findByTestId("collab-history-version");
    fireEvent.click(within(dialog).getByRole("button", { name: copy.restoreProject }));
    const confirm = await screen.findByRole("alertdialog", { name: copy.restoreProjectConfirm.title });
    fireEvent.click(within(confirm).getByRole("button", { name: copy.restoreProjectConfirm.confirm }));
    await waitFor(() => expect(mocks.collabHistoryRestore).toHaveBeenCalledWith("paper", "v2", null));
  });

  it("lets reviewers look but not restore or name versions", async () => {
    show("reviewer");
    const row = (await screen.findByText(formatTime(today.at))).closest("li") as HTMLElement;
    expect(within(row).queryByRole("button", { name: copy.name })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: copy.open }));
    const dialog = await screen.findByTestId("collab-history-version");
    await within(dialog).findByText("intro.tex at v3");
    expect(within(dialog).queryByRole("button", { name: copy.restoreFile })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: copy.restoreProject })).toBeNull();
  });

  it("names a version and removes a name", async () => {
    const user = userEvent.setup();
    show("owner");
    const row = (await screen.findByText(formatTime(today.at))).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: copy.name }));
    await user.type(within(row).getByRole("textbox", { name: copy.nameLabel }), "Final draft");
    await user.click(within(row).getByRole("button", { name: enCommon.actions.save }));
    await waitFor(() => expect(mocks.collabVersionName).toHaveBeenCalledWith("paper", "v3", "Final draft"));
    const namedRow = screen.getByText("Sent to reviewers").closest("li") as HTMLElement;
    await user.click(within(namedRow).getByRole("button", { name: copy.unname }));
    await waitFor(() => expect(mocks.collabVersionUnname).toHaveBeenCalledWith("paper", "name-1"));
    expect(mocks.collabHistoryList.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("compares two versions with the older one first", async () => {
    mocks.collabHistoryChangedFiles.mockResolvedValue(["intro.tex"]);
    show();
    const newer = (await screen.findByText(formatTime(today.at))).closest("li") as HTMLElement;
    fireEvent.click(within(newer).getByRole("button", { name: copy.compare }));
    expect(screen.getByText(copy.comparePick)).toBeInTheDocument();
    const older = screen.getByText(formatTime(yesterday.at)).closest("li") as HTMLElement;
    fireEvent.click(within(older).getByRole("button", { name: copy.compareWith }));
    const dialog = await screen.findByTestId("collab-history-compare");
    await waitFor(() => expect(mocks.collabHistoryChangedFiles).toHaveBeenCalledWith("paper", "v1", "v3"));
    expect(await within(dialog).findByTestId("diff-intro.tex")).toHaveTextContent("intro.tex at v1 -> intro.tex at v3");
  });

  it("says why the history couldn't load and offers to try again", async () => {
    mocks.collabHistoryList.mockRejectedValue({ code: "history_unavailable", message: "x" });
    show();
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.history_unavailable)).toBeInTheDocument();
  });
});
