// @vitest-environment jsdom

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL, CAROL_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { useCollabActivity, type ActivityEntry, type NewActivity } from "./activity-store";
import { CollabPane } from "./CollabPane";

const pane = enCollab.pane;
const activity = enCollab.activity;
const NOW = Date.now();

function peer(deviceId: string, accountId: string, path: string | null): LivePeer {
  return { deviceId, accountId, person: null, path, cursor: null, anchor: null, seenAt: NOW, hue: 20 };
}

function feed(entries: (NewActivity & { count: number })[]) {
  useCollabActivity.setState({
    projectId: "grant",
    entries: entries.map((entry, index) => ({ ...entry, id: `entry-${index}` }) as ActivityEntry),
    unread: true,
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ railTab: "collab", showTree: true });
  useShareDialog.setState({ projectId: null, fromCopy: false });
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo({ role: "editor", account_id: ALICE_ID }),
    role: "editor",
    status: { state: "online" },
    pending: 0,
    peers: { bob: peer("bob", BOB_ID, "main.tex"), mine: peer("mine", ALICE_ID, "intro.tex") },
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor"), projectMember(CAROL, "viewer")],
    merged: null,
    ended: null,
  });
  feed([]);
});

afterEach(() => {
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
});

describe("CollabPane", () => {
  it("names the connection state and the server in its header", () => {
    render(<CollabPane />);
    expect(screen.getByRole("heading", { name: pane.title })).toBeInTheDocument();
    expect(screen.getByText(enCollab.sync.upToDate)).toBeInTheDocument();
    expect(screen.getByText(fill(enCollab.manage.sharedOn, { server: "Smith Lab" }))).toBeInTheDocument();
  });

  it("lists everyone with access, you first, with role and where they are", () => {
    render(<CollabPane />);
    const people = screen.getByRole("list", { name: pane.people });
    const rows = within(people).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Alice Chen");
    expect(rows[0]).toHaveTextContent(enCollab.manage.you);
    expect(rows[1]).toHaveTextContent("Bob Smith");
    expect(rows[1]).toHaveTextContent(enCollab.projectRoles.owner);
    expect(rows[1]).toHaveTextContent(fill(pane.hereIn, { path: "main.tex" }));
    expect(rows[2]).toHaveTextContent("Carol Diaz");
    expect(rows[2]).toHaveTextContent(enCollab.projectRoles.viewer);
    expect(rows[2]).toHaveTextContent(pane.away);
    expect(people).not.toHaveTextContent(CAROL_ID);
  });

  it("shows the activity newest first with relative times and folded counts", () => {
    feed([
      { kind: "joined", at: NOW - 30_000, accountId: CAROL_ID, name: "Carol Diaz", count: 1 },
      { kind: "online", at: NOW - 120_000, count: 3 },
      { kind: "role", at: NOW - 3_600_000, role: "viewer", count: 1 },
      { kind: "welcome", at: NOW - 7_200_000, owner: "Bob Smith", server: "Smith Lab", role: "editor", count: 1 },
    ]);
    render(<CollabPane />);
    const list = screen.getByRole("list", { name: pane.activity });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(fill(activity.joined, { name: "Carol Diaz" }));
    expect(rows[1]).toHaveTextContent(activity.online);
    expect(rows[1]).toHaveTextContent(fill(activity.repeated, { number: "3" }));
    expect(rows[1].querySelector("time")).toHaveTextContent("2 minutes ago");
    expect(rows[2]).toHaveTextContent(fill(activity.role, { role: enCollab.projectRoles.viewer }));
    expect(rows[3]).toHaveTextContent(fill(activity.welcomeEdit, { owner: "Bob Smith", server: "Smith Lab" }));
    expect(rows[0]).not.toHaveTextContent(fill(activity.repeated, { number: "1" }));
  });

  it("lists merged files on request and offers sign in when signed out", async () => {
    feed([
      { kind: "signedOut", at: NOW, server: "Smith Lab", count: 1 },
      { kind: "merged", at: NOW - 1000, files: [{ path: "main.tex", changes: 100 }, { path: "refs.bib", changes: 20 }], count: 1 },
      { kind: "offline", at: NOW - 2000, pending: 4, count: 1 },
      { kind: "removed", at: NOW - 3000, count: 1 },
      { kind: "archived", at: NOW - 4000, count: 1 },
    ]);
    const user = userEvent.setup();
    render(<CollabPane />);
    expect(screen.getByText(fill(activity.signedOut, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(screen.getByText(fill(activity.merged, { number: "120" }))).toBeInTheDocument();
    expect(screen.getByText(fill(enCollab.sync.offline, { number: "4" }))).toBeInTheDocument();
    expect(screen.getByText(activity.removed)).toBeInTheDocument();
    expect(screen.getByText(activity.archived)).toBeInTheDocument();
    expect(screen.queryByText(fill(activity.mergedFile, { path: "main.tex", number: "100" }))).toBeNull();
    await user.click(screen.getByRole("button", { name: activity.showFiles }));
    expect(screen.getByText(fill(activity.mergedFile, { path: "main.tex", number: "100" }))).toBeInTheDocument();
    expect(screen.getByText(fill(activity.mergedFile, { path: "refs.bib", number: "20" }))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: activity.signIn }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "collaboration" });
  });

  it("says when nothing has happened yet", () => {
    render(<CollabPane />);
    expect(screen.getByText(pane.empty)).toBeInTheDocument();
  });

  it("clears the unread mark while it is open", () => {
    render(<CollabPane />);
    expect(useCollabActivity.getState().unread).toBe(false);
    act(() => useCollabActivity.setState({ unread: true }));
    expect(useCollabActivity.getState().unread).toBe(false);
  });

  it("opens the share dialog to manage sharing", async () => {
    const user = userEvent.setup();
    render(<CollabPane />);
    await user.click(screen.getByRole("button", { name: pane.manage }));
    expect(useShareDialog.getState().projectId).toBe("grant");
  });

  it("keeps its activity after access ends", () => {
    useCollabLiveStore.setState({ share: null, status: { state: "ended", reason: "removed" }, ended: "removed", members: [] });
    feed([{ kind: "removed", at: NOW, count: 1 }]);
    render(<CollabPane />);
    expect(screen.getByText(enCollab.sync.removed)).toBeInTheDocument();
    expect(screen.getByText(activity.removed)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: pane.manage })).toBeNull();
  });
});
