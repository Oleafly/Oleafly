// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { avatarHue } from "@/components/ui/avatar";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { resetSidebarViewState } from "@/store/sidebar-view-state";
import { useCollabLiveStore, type CollabLiveStoreState, type LivePeer } from "../live/live-store";
import { peerHue } from "../live/peer-hue";
import { ALICE_ID, BOB, BOB_ID, CAROL, CAROL_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { useCollabActivity, type ActivityEntry, type NewActivity } from "./activity-store";

const spies = vi.hoisted(() => ({ relativeTime: vi.fn(), person: vi.fn(), review: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabTrashList: vi.fn(async () => []),
  collabTrashRestore: vi.fn(async () => undefined),
}));

vi.mock("./MergeReviewDialog", () => ({
  MergeReviewDialog: (props: { projectId: string; entry: unknown; onClose: () => void }) => {
    spies.review(props);
    return (
      <div data-testid="merge-review">
        <button type="button" data-testid="merge-review-done" onClick={props.onClose} />
      </div>
    );
  },
}));

vi.mock("@/lib/intl", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/intl")>();
  return {
    ...original,
    formatRelativeTimeFrom: (...args: Parameters<typeof original.formatRelativeTimeFrom>) => {
      spies.relativeTime();
      return original.formatRelativeTimeFrom(...args);
    },
  };
});

vi.mock("../people", async (importOriginal) => {
  const original = await importOriginal<typeof import("../people")>();
  return {
    ...original,
    collabPerson: (...args: Parameters<typeof original.collabPerson>) => {
      spies.person();
      return original.collabPerson(...args);
    },
  };
});

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
  resetSidebarViewState();
  useFilesStore.setState({ projectId: "grant" });
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
    newDevice: null,
    ended: null,
  });
  feed([]);
});

afterEach(() => {
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
  useFilesStore.setState({ projectId: null });
  resetSidebarViewState();
});

function sectionToggle(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

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

  it("paints each person in the colour their caret uses, away from your own", () => {
    render(<CollabPane />);
    const people = screen.getByRole("list", { name: pane.people });
    const rows = within(people).getAllByRole("listitem");
    const bob = rows[1].querySelector('[data-slot="avatar"]');
    expect(peerHue(BOB_ID, ALICE_ID)).not.toBe(avatarHue(BOB_ID));
    expect(bob).toHaveStyle({ backgroundColor: `hsl(${peerHue(BOB_ID, ALICE_ID)} 55% 45%)` });
    const you = rows[0].querySelector('[data-slot="avatar"]');
    expect(you).toHaveStyle({ backgroundColor: `hsl(${avatarHue(ALICE_ID)} 55% 45%)` });
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

  it("says quietly who signed in on a new device", () => {
    feed([{ kind: "newDevice", at: NOW, accountId: BOB_ID, name: "Bob Smith", count: 1 }]);
    render(<CollabPane />);
    expect(screen.getByText(fill(activity.newDevice, { name: "Bob Smith" }))).toBeInTheDocument();
  });

  it("offers a read-only review of a merge that recorded its versions", async () => {
    const review = { before: "before-mark", after: "after-mark" };
    feed([
      {
        kind: "merged",
        at: NOW,
        files: [{ path: "main.tex", changes: 2 }],
        authors: [{ accountId: BOB_ID, files: [{ path: "main.tex", changes: 2 }] }],
        review,
        count: 1,
      },
      { kind: "merged", at: NOW - 1000, files: [{ path: "old.tex", changes: 1 }], count: 1 },
    ]);
    const user = userEvent.setup();
    render(<CollabPane />);
    const offered = screen.getAllByRole("button", { name: activity.review });
    expect(offered).toHaveLength(1);
    await user.click(offered[0]);
    expect(screen.getByTestId("merge-review")).toBeInTheDocument();
    expect(spies.review).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "grant", entry: expect.objectContaining({ review }) }),
    );
    await user.click(screen.getByTestId("merge-review-done"));
    expect(screen.queryByTestId("merge-review")).toBeNull();
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

  it("shows People and Activity as the same collapsible sections as the Files sidebar", () => {
    feed([
      { kind: "online", at: NOW - 1000, count: 1 },
      { kind: "joined", at: NOW - 2000, accountId: CAROL_ID, name: "Carol Diaz", count: 1 },
    ]);
    render(<CollabPane />);
    const people = screen.getByTestId("collab-people");
    const activitySection = screen.getByTestId("collab-activity");
    expect(people).toHaveAttribute("aria-label", pane.people);
    expect(activitySection).toHaveAttribute("aria-label", pane.activity);
    expect(people.compareDocumentPosition(activitySection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const peopleToggle = sectionToggle(pane.people);
    const activityToggle = sectionToggle(pane.activity);
    expect(peopleToggle).toHaveAttribute("aria-expanded", "true");
    expect(activityToggle).toHaveAttribute("aria-expanded", "true");
    expect(peopleToggle).toHaveAttribute("aria-controls", "collab-people-content");
    expect(peopleToggle.querySelector("svg.lucide-chevron-down")).toBeInTheDocument();
    expect(peopleToggle.querySelector("svg.lucide-users")).toBeInTheDocument();
    expect(activityToggle.querySelector("svg.lucide-activity")).toBeInTheDocument();
    expect(within(peopleToggle).getByText(pane.people)).toBeInTheDocument();
    expect(peopleToggle.querySelector("output")).toHaveTextContent("3");
    expect(activityToggle.querySelector("output")).toHaveTextContent("2");
  });

  it("adds Recently deleted after Activity, closed until opened", async () => {
    render(<CollabPane />);
    const activitySection = screen.getByTestId("collab-activity");
    const deleted = screen.getByTestId("collab-deleted");
    expect(activitySection.compareDocumentPosition(deleted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const toggle = sectionToggle(pane.deleted);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText(pane.deletedEmpty)).toBeInTheDocument();
  });

  it("says whose name won when someone renamed a file you had just renamed", () => {
    feed([
      {
        kind: "renamed",
        at: NOW,
        accountId: BOB_ID,
        name: "Bob Smith",
        before: "intro.tex",
        ours: "overview.tex",
        theirs: "background.tex",
        count: 1,
      },
      { kind: "renamed", at: NOW - 1000, accountId: null, name: "", before: "a.tex", ours: "b.tex", theirs: "c.tex", count: 1 },
    ]);
    render(<CollabPane />);
    const rows = within(screen.getByRole("list", { name: pane.activity })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(
      fill(activity.renamed, { name: "Bob Smith", before: "intro.tex", theirs: "background.tex", ours: "overview.tex" }),
    );
    expect(rows[0].querySelector("svg.lucide-pencil-line")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(
      fill(activity.renamed, { name: enCollab.toolbar.unknownPerson, before: "a.tex", theirs: "c.tex", ours: "b.tex" }),
    );
  });

  it("collapses and reopens each section from its header", () => {
    render(<CollabPane />);
    const peopleToggle = sectionToggle(pane.people);
    fireEvent.click(peopleToggle);
    expect(peopleToggle).toHaveAttribute("aria-expanded", "false");
    expect(peopleToggle.querySelector("svg.lucide-chevron-right")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: pane.people })).toBeNull();
    expect(document.getElementById("collab-people-content")).toHaveAttribute("hidden");
    expect(sectionToggle(pane.activity)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(pane.empty)).toBeInTheDocument();
    fireEvent.click(sectionToggle(pane.activity));
    expect(screen.queryByText(pane.empty)).toBeNull();
    fireEvent.click(peopleToggle);
    expect(screen.getByRole("list", { name: pane.people })).toBeInTheDocument();
  });

  it("remembers which sections are open for each project when the pane comes back", () => {
    const first = render(<CollabPane />);
    fireEvent.click(sectionToggle(pane.activity));
    first.unmount();
    const second = render(<CollabPane />);
    expect(sectionToggle(pane.people)).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle(pane.activity)).toHaveAttribute("aria-expanded", "false");
    act(() => useFilesStore.setState({ projectId: "thesis" }));
    expect(sectionToggle(pane.activity)).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(sectionToggle(pane.people));
    act(() => useFilesStore.setState({ projectId: "grant" }));
    expect(sectionToggle(pane.people)).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle(pane.activity)).toHaveAttribute("aria-expanded", "false");
    second.unmount();
    render(<CollabPane />);
    act(() => useFilesStore.setState({ projectId: "thesis" }));
    expect(sectionToggle(pane.people)).toHaveAttribute("aria-expanded", "false");
  });

  it.each<["removed" | "archived" | "signed_out", string]>([
    ["removed", enCollab.sync.removed],
    ["archived", enCollab.sync.archived],
    ["signed_out", enCollab.sync.signedOut],
  ])("keeps the ended state (%s) at the top of the pane with its sections still reachable", (reason, words) => {
    useCollabLiveStore.setState({ share: null, status: { state: "ended", reason }, ended: reason, peers: {}, members: [] });
    render(<CollabPane />);
    const header = screen.getByText(words).closest("div") as HTMLElement;
    expect(header.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByTestId("collab-people")).toBeNull();
    expect(sectionToggle(pane.activity)).toHaveAttribute("aria-expanded", "true");
  });

  it("offers Sign in next to the state line while signed out", async () => {
    useCollabLiveStore.setState({ status: { state: "ended", reason: "signed_out" }, ended: "signed_out" });
    const user = userEvent.setup();
    render(<CollabPane />);
    const state = screen.getByText(enCollab.sync.signedOut).closest("div") as HTMLElement;
    await user.click(within(state).getByRole("button", { name: activity.signIn }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "collaboration" });
  });

  it.each<[Pick<CollabLiveStoreState, "status" | "pending">, string]>([
    [{ status: { state: "online" }, pending: 0 }, enCollab.sync.upToDate],
    [{ status: { state: "online" }, pending: 2 }, enCollab.sync.syncing],
    [{ status: { state: "offline", retry_in_ms: 1000 }, pending: 5 }, fill(enCollab.sync.offline, { number: "5" })],
    [{ status: { state: "offline", retry_in_ms: 1000 }, pending: 0 }, enCollab.sync.reconnecting],
    [{ status: { state: "ended", reason: "stopped" }, pending: 0 }, enCollab.sync.paused],
  ])("names the live state %j at the top of the pane without a Sign in button", (live, words) => {
    useCollabLiveStore.setState(live);
    render(<CollabPane />);
    const state = screen.getByText(words).closest("div") as HTMLElement;
    expect(within(state).queryByRole("button")).toBeNull();
  });

  it("does not render again while people only move their cursors", () => {
    let commits = 0;
    render(
      <Profiler id="pane" onRender={() => (commits += 1)}>
        <CollabPane />
      </Profiler>,
    );
    commits = 0;
    for (let cursor = 1; cursor <= 20; cursor += 1) {
      act(() =>
        useCollabLiveStore.setState({
          peers: {
            bob: { ...peer("bob", BOB_ID, "main.tex"), cursor, anchor: cursor },
            mine: peer("mine", ALICE_ID, "intro.tex"),
          },
        }),
      );
    }
    expect(commits).toBe(0);
    act(() => useCollabLiveStore.setState({ peers: { bob: peer("bob", BOB_ID, "refs.bib") } }));
    expect(commits).toBe(1);
    const rows = within(screen.getByRole("list", { name: pane.people })).getAllByRole("listitem");
    expect(rows[1]).toHaveTextContent(fill(pane.hereIn, { path: "refs.bib" }));
  });

  it("redraws only its state line when the sync state changes", () => {
    feed([
      { kind: "online", at: NOW - 1000, count: 1 },
      { kind: "joined", at: NOW - 2000, accountId: CAROL_ID, name: "Carol Diaz", count: 1 },
    ]);
    render(<CollabPane />);
    spies.relativeTime.mockClear();
    spies.person.mockClear();
    act(() => useCollabLiveStore.setState({ pending: 3 }));
    expect(screen.getByText(enCollab.sync.syncing)).toBeInTheDocument();
    act(() => useCollabLiveStore.setState({ pending: 0, status: { state: "online" } }));
    expect(screen.getByText(enCollab.sync.upToDate)).toBeInTheDocument();
    expect(spies.relativeTime).not.toHaveBeenCalled();
    expect(spies.person).not.toHaveBeenCalled();
  });

  it("draws a new activity entry without redrawing the ones already shown", () => {
    feed([
      { kind: "online", at: NOW - 1000, count: 1 },
      { kind: "joined", at: NOW - 2000, accountId: CAROL_ID, name: "Carol Diaz", count: 1 },
      { kind: "role", at: NOW - 3000, role: "viewer", count: 1 },
    ]);
    render(<CollabPane />);
    spies.relativeTime.mockClear();
    act(() => useCollabActivity.getState().add({ kind: "joined", at: NOW, accountId: BOB_ID, name: "Bob Smith" }));
    const rows = within(screen.getByRole("list", { name: pane.activity })).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent(fill(activity.joined, { name: "Bob Smith" }));
    expect(spies.relativeTime).toHaveBeenCalledTimes(1);
  });
});
