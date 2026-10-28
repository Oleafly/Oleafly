// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDate, formatList, formatTime } from "@/lib/intl";
import type { CollabHistoryEntry, CollabHistoryPage, CollabProjectRole } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import {
  ALICE_ID,
  BOB,
  BOB_ID,
  CAROL_ID,
  collabError,
  deferred,
  fill,
  person,
  projectMember,
  shareInfo,
} from "../tests/fixtures";

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
const yesterdayHeading = formatDate(yesterday.at, { dateStyle: "full" });

function live(role: CollabProjectRole, shared = true) {
  useCollabLiveStore.setState({
    projectId: "paper",
    role,
    status: { state: "online" },
    members: MEMBERS,
    share: shared ? shareInfo({ project_id: "paper", role, account_id: ALICE_ID }) : null,
  });
}

function show(role: CollabProjectRole = "editor") {
  live(role);
  return render(<SharedHistory open onOpenChange={() => undefined} />);
}

async function rowOf(text: string): Promise<HTMLElement> {
  return (await screen.findByText(text)).closest("li") as HTMLElement;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabHistoryList.mockResolvedValue({ entries: [today, named, yesterday], nextBefore: null });
  mocks.collabHistoryFile.mockImplementation(async (_projectId: string, versionId: string, path: string) => ({
    path,
    text: `${path} at ${versionId}`,
    existed: true,
  }));
  mocks.collabHistoryChangedFiles.mockResolvedValue([]);
  mocks.collabHistoryRestore.mockResolvedValue(undefined);
  mocks.collabVersionName.mockResolvedValue(undefined);
  mocks.collabVersionUnname.mockResolvedValue(undefined);
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex" });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, role: null, status: null, share: null, members: [] });
});

describe("shared history list", () => {
  it("says when the project has no history yet", async () => {
    mocks.collabHistoryList.mockResolvedValueOnce({ entries: [], nextBefore: null });
    show();
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("loads the history again after it failed", async () => {
    mocks.collabHistoryList.mockRejectedValueOnce(collabError("unreachable"));
    show();
    expect(await screen.findByText(enCollab.errors.unreachable)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("Sent to reviewers")).toBeInTheDocument();
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    expect(mocks.collabHistoryList).toHaveBeenCalledTimes(2);
  });

  it("shows a time range for a run of edits and no file line when no text file changed", async () => {
    const burst = entry("v5", NOW - 7_200_000, { until: NOW - 7_200_000 + 20 * 60_000, files: [] });
    mocks.collabHistoryList.mockResolvedValueOnce({ entries: [burst], nextBefore: null });
    show();
    const range = fill(copy.timeRange, { from: formatTime(burst.at), to: formatTime(burst.until) });
    const row = await rowOf(range);
    expect(row).toHaveTextContent("Bob Smith");
    expect(row).not.toHaveTextContent("intro.tex");
    expect(row).not.toHaveTextContent(fill(copy.filesChanged, { number: "0" }));
  });

  it("calls authors who are no longer members Someone", async () => {
    const left = entry("v6", NOW - 60_000, { authors: [CAROL_ID, BOB_ID] });
    mocks.collabHistoryList.mockResolvedValueOnce({ entries: [left], nextBefore: null });
    show();
    const row = await rowOf(formatTime(left.at));
    expect(within(row).getByText(`${enCollab.toolbar.unknownPerson} and Bob Smith`)).toBeInTheDocument();
  });

  it("names the first three authors of a busy version and counts the rest", async () => {
    const busy = entry("v7", NOW - 60_000, { authors: [BOB_ID, ALICE_ID, CAROL_ID, "0192a0b0-0000-7000-8000-000000000004"] });
    mocks.collabHistoryList.mockResolvedValueOnce({ entries: [busy], nextBefore: null });
    show();
    const row = await rowOf(formatTime(busy.at));
    const shown = formatList(["Bob Smith", "Alice Chen", enCollab.toolbar.unknownPerson], { type: "unit", style: "short" });
    expect(within(row).getByText(fill(copy.authorsMore, { names: shown, number: "1" }))).toBeInTheDocument();
  });

  it("waits for the project to be shared before asking for its history", async () => {
    live("editor", false);
    render(<SharedHistory open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(mocks.collabHistoryList).not.toHaveBeenCalled();
    act(() => useCollabLiveStore.setState({ share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID }) }));
    expect(await screen.findByText("Sent to reviewers")).toBeInTheDocument();
    expect(mocks.collabHistoryList).toHaveBeenCalledWith("paper", null, 50);
  });
});

describe("replies that arrive out of order", () => {
  it("ignores a slow page once a newer refresh has landed", async () => {
    const slow = deferred<CollabHistoryPage>();
    mocks.collabHistoryList.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ entries: [today], nextBefore: null });
    show();
    fireEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(await screen.findByText(formatTime(today.at))).toBeInTheDocument();
    await act(async () => {
      slow.resolve({ entries: [yesterday], nextBefore: "cursor-1" });
      await slow.promise;
    });
    expect(screen.queryByRole("region", { name: yesterdayHeading })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("ignores a slow failure once a newer refresh has landed", async () => {
    const slow = deferred<CollabHistoryPage>();
    mocks.collabHistoryList.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ entries: [today], nextBefore: null });
    show();
    fireEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(await screen.findByText(formatTime(today.at))).toBeInTheDocument();
    await act(async () => {
      slow.reject(collabError("unreachable"));
      await slow.promise.catch(() => undefined);
    });
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says why older changes couldn't load and keeps what is shown", async () => {
    mocks.collabHistoryList
      .mockResolvedValueOnce({ entries: [today], nextBefore: "cursor-1" })
      .mockRejectedValueOnce(collabError("unreachable"));
    show();
    fireEvent.click(await screen.findByRole("button", { name: copy.loadMore }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(screen.getByText(formatTime(today.at))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.loadMore })).toBeEnabled();
  });

  it("drops an older page that lands after a refresh", async () => {
    const more = deferred<CollabHistoryPage>();
    mocks.collabHistoryList
      .mockResolvedValueOnce({ entries: [today], nextBefore: "cursor-1" })
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce({ entries: [today, named], nextBefore: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: copy.loadMore }));
    fireEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(await screen.findByText("Sent to reviewers")).toBeInTheDocument();
    await act(async () => {
      more.resolve({ entries: [yesterday], nextBefore: "cursor-2" });
      await more.promise;
    });
    expect(screen.queryByRole("region", { name: yesterdayHeading })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("drops a failed older page once a refresh has landed", async () => {
    const more = deferred<CollabHistoryPage>();
    mocks.collabHistoryList
      .mockResolvedValueOnce({ entries: [today], nextBefore: "cursor-1" })
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce({ entries: [today, named], nextBefore: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: copy.loadMore }));
    fireEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(await screen.findByText("Sent to reviewers")).toBeInTheDocument();
    await act(async () => {
      more.reject(collabError("unreachable"));
      await more.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("naming versions", () => {
  it("never saves a name of only spaces and closes the form with Escape", async () => {
    const user = userEvent.setup();
    show("owner");
    const row = await rowOf(formatTime(today.at));
    await user.click(within(row).getByRole("button", { name: copy.name }));
    const field = within(row).getByRole("textbox", { name: copy.nameLabel });
    await user.type(field, "   ");
    expect(within(row).getByRole("button", { name: enCommon.actions.save })).toBeDisabled();
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(mocks.collabVersionName).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(within(row).queryByRole("textbox", { name: copy.nameLabel })).toBeNull();
    expect(within(row).getByRole("button", { name: copy.name })).toBeInTheDocument();
  });

  it("closes the name form with Cancel without saving", async () => {
    const user = userEvent.setup();
    show("owner");
    const row = await rowOf(formatTime(today.at));
    await user.click(within(row).getByRole("button", { name: copy.name }));
    await user.type(within(row).getByRole("textbox", { name: copy.nameLabel }), "Draft");
    await user.click(within(row).getByRole("button", { name: enCommon.actions.cancel }));
    expect(within(row).queryByRole("textbox", { name: copy.nameLabel })).toBeNull();
    expect(mocks.collabVersionName).not.toHaveBeenCalled();
  });

  it("keeps the name form open and says why when naming fails", async () => {
    const user = userEvent.setup();
    mocks.collabVersionName.mockRejectedValueOnce(collabError("forbidden"));
    show("owner");
    const row = await rowOf(formatTime(today.at));
    await user.click(within(row).getByRole("button", { name: copy.name }));
    await user.type(within(row).getByRole("textbox", { name: copy.nameLabel }), "Final draft");
    await user.click(within(row).getByRole("button", { name: enCommon.actions.save }));
    expect(await within(row).findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(within(row).getByRole("textbox", { name: copy.nameLabel })).toHaveValue("Final draft");
    await waitFor(() => expect(within(row).getByRole("button", { name: enCommon.actions.save })).toBeEnabled());
    expect(mocks.collabHistoryList).toHaveBeenCalledTimes(1);
  });

  it("renames a named version starting from its current name", async () => {
    const user = userEvent.setup();
    show("owner");
    const row = await rowOf("Sent to reviewers");
    await user.click(within(row).getByRole("button", { name: copy.rename }));
    const field = within(row).getByRole("textbox", { name: copy.nameLabel });
    expect(field).toHaveValue("Sent to reviewers");
    await user.clear(field);
    await user.type(field, "Accepted");
    await user.click(within(row).getByRole("button", { name: enCommon.actions.save }));
    await waitFor(() => expect(mocks.collabVersionName).toHaveBeenCalledWith("paper", "name-1", "Accepted"));
    await waitFor(() => expect(within(row).queryByRole("textbox", { name: copy.nameLabel })).toBeNull());
    await waitFor(() => expect(mocks.collabHistoryList).toHaveBeenCalledTimes(2));
  });

  it("keeps the name and says why when removing it fails", async () => {
    const user = userEvent.setup();
    mocks.collabVersionUnname.mockRejectedValueOnce(collabError("forbidden"));
    show("owner");
    const row = await rowOf("Sent to reviewers");
    await user.click(within(row).getByRole("button", { name: copy.unname }));
    expect(await within(row).findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(mocks.collabVersionUnname).toHaveBeenCalledWith("paper", "name-1");
    expect(within(row).getByText("Sent to reviewers")).toBeInTheDocument();
    expect(mocks.collabHistoryList).toHaveBeenCalledTimes(1);
  });
});

describe("comparing versions", () => {
  it("lets you back out of picking a second version", async () => {
    show();
    const row = await rowOf(formatTime(today.at));
    fireEvent.click(within(row).getByRole("button", { name: copy.compare }));
    expect(within(row).queryByRole("button", { name: copy.open })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.cancelCompare }));
    expect(screen.queryByText(copy.comparePick)).toBeNull();
    expect(within(row).getByRole("button", { name: copy.open })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.compareWith })).toBeNull();
  });

  it("closes the comparison and returns to the list", async () => {
    show();
    const newer = await rowOf(formatTime(today.at));
    fireEvent.click(within(newer).getByRole("button", { name: copy.compare }));
    const older = await rowOf("Sent to reviewers");
    fireEvent.click(within(older).getByRole("button", { name: copy.compareWith }));
    const dialog = await screen.findByTestId("collab-history-compare");
    expect(await within(dialog).findByText(copy.noChanges)).toBeInTheDocument();
    expect(mocks.collabHistoryChangedFiles).toHaveBeenCalledWith("paper", "v2", "v3");
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.close }));
    await waitFor(() => expect(screen.queryByTestId("collab-history-compare")).toBeNull());
    expect(within(newer).getByRole("button", { name: copy.compare })).toBeInTheDocument();
  });

  it("closes an opened version without restoring anything", async () => {
    show("owner");
    const row = await rowOf(formatTime(today.at));
    fireEvent.click(within(row).getByRole("button", { name: copy.open }));
    const dialog = await screen.findByTestId("collab-history-version");
    await within(dialog).findByText("intro.tex at v3");
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.close }));
    await waitFor(() => expect(screen.queryByTestId("collab-history-version")).toBeNull());
    expect(mocks.collabHistoryRestore).not.toHaveBeenCalled();
  });
});
