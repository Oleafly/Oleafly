// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDateTime } from "@/lib/intl";
import type { CollabTrashEntry } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { useRemovedNotices } from "../live/removed-notices";
import { ALICE_ID, BOB, BOB_ID, collabError, fill, person, projectMember, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabTrashList: vi.fn(),
  collabTrashRestore: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabTrashList: mocks.collabTrashList,
  collabTrashRestore: mocks.collabTrashRestore,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

import { RecentlyDeleted } from "./RecentlyDeleted";

const copy = enCollab.deleted;
const NOW = Date.now();

function trashed(overrides: Partial<CollabTrashEntry> = {}): CollabTrashEntry {
  return {
    id: "intro-id",
    name: "intro.tex",
    kind: "text",
    folder: "chapters",
    deletedBy: BOB_ID,
    deletedAt: NOW - 60_000,
    ...overrides,
  };
}

const LISTED: CollabTrashEntry[] = [
  trashed(),
  trashed({ id: "figs-id", name: "figs", kind: "dir", folder: null, deletedBy: ALICE_ID, deletedAt: NOW - 3_600_000 }),
  trashed({ id: "old-id", name: "old.tex", folder: null, deletedBy: null, deletedAt: null }),
];

function folderChanged(payload: unknown) {
  act(() => mocks.listeners.get("project-folder-changed")?.({ payload }));
}

function view(open = true) {
  const onOpenChange = vi.fn();
  render(<RecentlyDeleted open={open} onOpenChange={onOpenChange} />);
  return onOpenChange;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.collabTrashList.mockResolvedValue(LISTED);
  mocks.collabTrashRestore.mockResolvedValue(undefined);
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo({ role: "editor", account_id: ALICE_ID }),
    role: "editor",
    status: { state: "online" },
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor")],
  });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
});

describe("RecentlyDeleted", () => {
  it("lists deleted files and folders newest first with where they were, who deleted them and when", async () => {
    view();
    const list = await screen.findByRole("list", { name: enCollab.pane.deleted });
    const rows = within(list).getAllByRole("listitem");
    expect(mocks.collabTrashList).toHaveBeenCalledWith("grant");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("intro.tex");
    expect(rows[0]).toHaveTextContent(fill(copy.inFolder, { folder: "chapters" }));
    expect(rows[0]).toHaveTextContent(fill(copy.by, { name: "Bob Smith" }));
    expect(rows[0].querySelector("time")).toHaveTextContent("1 minute ago");
    expect(rows[1]).toHaveTextContent("figs");
    expect(rows[1]).toHaveTextContent(copy.inProject);
    expect(rows[1]).toHaveTextContent(copy.byYou);
    expect(rows[2]).toHaveTextContent("old.tex");
    expect(rows[2]).not.toHaveTextContent(fill(copy.by, { name: "" }).trim());
    expect(rows[2].querySelector("time")).toBeNull();
    const toggle = screen.getByRole("button", { name: enCollab.pane.deleted });
    expect(toggle.querySelector("output")).toHaveTextContent("3");
    expect(toggle.querySelector("svg.lucide-trash-2")).toBeInTheDocument();
  });

  it("shows the exact deletion time in the app tooltip, never in a native title", async () => {
    const user = userEvent.setup();
    view();
    const list = await screen.findByRole("list", { name: enCollab.pane.deleted });
    expect(list.querySelector("[title]")).toBeNull();
    await user.hover(within(list).getAllByRole("listitem")[0].querySelector("time") as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(formatDateTime(NOW - 60_000));
  });

  it("calls someone who left the project by a neutral name", async () => {
    mocks.collabTrashList.mockResolvedValue([trashed({ deletedBy: "0192a0b0-0000-7000-8000-0000000000ff" })]);
    view();
    const list = await screen.findByRole("list", { name: enCollab.pane.deleted });
    expect(within(list).getByRole("listitem")).toHaveTextContent(
      fill(copy.by, { name: enCollab.toolbar.unknownPerson }),
    );
  });

  it("counts deleted items while the section is closed", async () => {
    view(false);
    const toggle = screen.getByRole("button", { name: enCollab.pane.deleted });
    await waitFor(() => expect(toggle.querySelector("output")).toHaveTextContent("3"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: enCollab.pane.deleted })).toBeNull();
  });

  it("restores a file through the command and shows the list without it", async () => {
    const user = userEvent.setup();
    view();
    await screen.findByRole("list", { name: enCollab.pane.deleted });
    mocks.collabTrashList.mockResolvedValue(LISTED.slice(1));
    await user.click(screen.getByRole("button", { name: fill(copy.restoreLabel, { name: "intro.tex" }) }));
    expect(mocks.collabTrashRestore).toHaveBeenCalledWith("grant", "intro-id");
    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: enCollab.pane.deleted })).getAllByRole("listitem")).toHaveLength(2),
    );
    expect(screen.queryByText("intro.tex")).toBeNull();
  });

  it("clears the deleted-file notice of a file restored here", async () => {
    useRemovedNotices.setState({
      projectId: "grant",
      notices: [{ id: "intro-id", path: "chapters/intro.tex", kind: "text", by: BOB_ID, yours: true }],
    });
    const user = userEvent.setup();
    view();
    await screen.findByRole("list", { name: enCollab.pane.deleted });
    await user.click(screen.getByRole("button", { name: fill(copy.restoreLabel, { name: "intro.tex" }) }));
    await waitFor(() => expect(useRemovedNotices.getState().notices).toEqual([]));
  });

  it("says why a restore did not work", async () => {
    const user = userEvent.setup();
    mocks.collabTrashRestore.mockRejectedValue(collabError("forbidden"));
    view();
    await screen.findByRole("list", { name: enCollab.pane.deleted });
    await user.click(screen.getByRole("button", { name: fill(copy.restoreLabel, { name: "figs" }) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(screen.getByText("figs")).toBeInTheDocument();
  });

  it("shows viewers the list with no Restore", async () => {
    useCollabLiveStore.setState({ role: "viewer", share: shareInfo({ role: "viewer", account_id: ALICE_ID }) });
    view();
    await screen.findByRole("list", { name: enCollab.pane.deleted });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
  });

  it("says so in one quiet line when nothing was deleted", async () => {
    mocks.collabTrashList.mockResolvedValue([]);
    view();
    expect(await screen.findByText(enCollab.pane.deletedEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: enCollab.pane.deleted })).toBeNull();
  });

  it("reads the list again when files are added, moved or deleted in this project", async () => {
    view();
    await screen.findByRole("list", { name: enCollab.pane.deleted });
    expect(mocks.collabTrashList).toHaveBeenCalledTimes(1);
    folderChanged({ projectId: "thesis", paths: [], rescan: false, structural: true });
    folderChanged({ projectId: "grant", paths: ["main.tex"], rescan: false, structural: false });
    expect(mocks.collabTrashList).toHaveBeenCalledTimes(1);
    mocks.collabTrashList.mockResolvedValue([]);
    folderChanged({ projectId: "grant", paths: ["intro.tex"], rescan: false, structural: true });
    expect(await screen.findByText(enCollab.pane.deletedEmpty)).toBeInTheDocument();
    expect(mocks.collabTrashList).toHaveBeenCalledTimes(2);
  });

  it("waits until the project is live before asking", async () => {
    useCollabLiveStore.setState({ status: null });
    view();
    expect(screen.getByText(enCollab.pane.deletedEmpty)).toBeInTheDocument();
    expect(mocks.collabTrashList).not.toHaveBeenCalled();
    act(() => useCollabLiveStore.setState({ status: { state: "connecting" } }));
    await screen.findByRole("list", { name: enCollab.pane.deleted });
    expect(mocks.collabTrashList).toHaveBeenCalledWith("grant");
  });

  it("drops an answer that arrives after the project changed", async () => {
    let answer: (entries: CollabTrashEntry[]) => void = () => undefined;
    mocks.collabTrashList.mockImplementationOnce(
      () => new Promise<CollabTrashEntry[]>((resolve) => (answer = resolve)),
    );
    mocks.collabTrashList.mockResolvedValue([]);
    view();
    act(() => useCollabLiveStore.setState({ projectId: "thesis" }));
    await waitFor(() => expect(mocks.collabTrashList).toHaveBeenCalledWith("thesis"));
    await act(async () => answer(LISTED));
    expect(screen.getByText(enCollab.pane.deletedEmpty)).toBeInTheDocument();
  });

  it("keeps the list when reading it fails", async () => {
    view();
    await screen.findByRole("list", { name: enCollab.pane.deleted });
    mocks.collabTrashList.mockRejectedValue(collabError("internal"));
    folderChanged({ projectId: "grant", paths: [], rescan: true, structural: true });
    await waitFor(() => expect(mocks.collabTrashList).toHaveBeenCalledTimes(2));
    expect(within(screen.getByRole("list", { name: enCollab.pane.deleted })).getAllByRole("listitem")).toHaveLength(3);
  });
});
