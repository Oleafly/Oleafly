// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDateTime } from "@/lib/intl";
import { avatarHue } from "@/components/ui/avatar";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { resetSidebarViewState } from "@/store/sidebar-view-state";
import { useCollabLiveStore, type CollabLiveStoreState, type LivePeer } from "../live/live-store";
import { peerHue } from "../live/peer-hue";
import { ALICE_ID, BOB, BOB_ID, CAROL, CAROL_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { useCollabActivity, type ActivityEntry, type NewActivity } from "./activity-store";

const spies = vi.hoisted(() => ({
  relativeTime: vi.fn(),
  person: vi.fn(),
  review: vi.fn(),
  openProjectLocation: vi.fn(async () => true),
}));

vi.mock("@/lib/open-location", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/open-location")>()),
  openProjectLocation: spies.openProjectLocation,
}));

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
  await loadNamespace("workspace");
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
  spies.openProjectLocation.mockClear();
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
  useFilesStore.setState({ projectId: null });
  resetSidebarViewState();
});

function sectionToggle(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("CollabPane", () => {
  it("shows the sync state as an icon left of the Share button instead of a status block", () => {
    render(<CollabPane />);
    const header = screen.getByRole("heading", { name: pane.title }).closest("header") as HTMLElement;
    const status = within(header).getByRole("button", { name: enCollab.sync.upToDate });
    const manage = within(header).getByRole("button", { name: pane.manage });
    expect(status.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.querySelector("svg.lucide-cloud-check")).toBeInTheDocument();
    expect(screen.queryByText(enCollab.sync.upToDate)).toBeNull();
    expect(screen.queryByText(fill(enCollab.manage.sharedOn, { server: "Smith Lab" }))).toBeNull();
  });

  it("opens the full status and the server details from the status icon", async () => {
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1000 }, pending: 4 });
    const user = userEvent.setup();
    render(<CollabPane />);
    const words = fill(enCollab.sync.offline, { number: "4" });
    await user.click(screen.getByRole("button", { name: words }));
    const details = screen.getByRole("dialog", { name: pane.status });
    expect(details).toHaveTextContent(words);
    expect(details).toHaveTextContent(fill(enCollab.manage.sharedOn, { server: "Smith Lab" }));
    expect(details).toHaveTextContent("https://collab.uni.edu");
    expect(details).toHaveTextContent(fill(enCollab.manage.yourRole, { role: enCollab.projectRoles.editor }));
    expect(details).toHaveTextContent(fill(pane.waiting, { number: "4" }));
  });

  it("opens the status details when the pointer rests on the status icon", () => {
    vi.useFakeTimers();
    try {
      render(<CollabPane />);
      const status = screen.getByRole("button", { name: enCollab.sync.upToDate });
      fireEvent.pointerEnter(status, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("dialog", { name: pane.status })).toHaveTextContent(
        fill(enCollab.manage.sharedOn, { server: "Smith Lab" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<[Pick<CollabLiveStoreState, "status" | "pending">, string, string, string]>([
    [{ status: { state: "online" }, pending: 0 }, enCollab.sync.upToDate, "cloud-check", "text-muted-foreground"],
    [{ status: { state: "online" }, pending: 2 }, enCollab.sync.syncing, "cloud-upload", "text-primary"],
    [{ status: { state: "connecting" }, pending: 0 }, enCollab.sync.syncing, "cloud-upload", "text-primary"],
    [
      { status: { state: "offline", retry_in_ms: 1000 }, pending: 5 },
      fill(enCollab.sync.offline, { number: "5" }),
      "cloud-off",
      "text-amber-600",
    ],
    [{ status: { state: "offline", retry_in_ms: 1000 }, pending: 0 }, enCollab.sync.reconnecting, "refresh-cw", "text-amber-600"],
    [{ status: { state: "ended", reason: "stopped" }, pending: 0 }, enCollab.sync.paused, "circle-pause", "text-muted-foreground"],
    [{ status: { state: "ended", reason: "access_ended" }, pending: 0 }, enCollab.sync.accessEnded, "ban", "text-destructive"],
    [{ status: { state: "ended", reason: "signed_out" }, pending: 0 }, enCollab.sync.signedOut, "log-out", "text-destructive"],
  ])("draws the state %j as its own icon and colour", (live, words, icon, tone) => {
    useCollabLiveStore.setState(live);
    render(<CollabPane />);
    const glyph = screen.getByRole("button", { name: words }).querySelector("svg");
    expect(glyph).toHaveClass(`lucide-${icon}`, tone);
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

  it("shows the full place and exact times in app tooltips, never in native titles", async () => {
    useCollabLiveStore.setState({
      peers: {
        bob: peer("bob", BOB_ID, "chapters/methods/experiments/results/main.tex"),
        mine: peer("mine", ALICE_ID, "intro.tex"),
      },
    });
    feed([{ kind: "online", at: NOW - 120_000, count: 1 }]);
    const user = userEvent.setup();
    const { container } = render(<CollabPane />);
    expect(container.querySelector("[title]")).toBeNull();
    const people = screen.getByRole("list", { name: pane.people });
    const place = within(people).getByText(/…\/results\/main\.tex$/);
    await user.hover(place);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      fill(pane.hereIn, { path: "chapters/methods/experiments/results/main.tex" }),
    );
    await user.unhover(place);
    const time = within(screen.getByRole("list", { name: pane.activity })).getAllByRole("listitem")[0].querySelector(
      "time",
    ) as HTMLElement;
    await user.hover(time);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(formatDateTime(NOW - 120_000));
  });

  it("goes to a person from their row in People by mouse, Enter or Space", async () => {
    useCollabLiveStore.setState({
      peers: {
        bob: { ...peer("bob", BOB_ID, "chapters/main.tex"), cursor: 42, anchor: 40 },
        mine: peer("mine", ALICE_ID, "intro.tex"),
      },
    });
    const user = userEvent.setup();
    render(<CollabPane />);
    const people = screen.getByRole("list", { name: pane.people });
    const row = within(people).getByRole("button", { name: fill(enCollab.toolbar.goTo, { name: "Bob Smith" }) });
    const there = [{ path: "chapters/main.tex", range: { from: 42, to: 42 } }, { keepSelection: true }];

    await user.click(row);
    await vi.waitFor(() => expect(spies.openProjectLocation).toHaveBeenCalledTimes(1));
    expect(spies.openProjectLocation).toHaveBeenLastCalledWith(...there);

    row.focus();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(spies.openProjectLocation).toHaveBeenCalledTimes(2));
    await user.keyboard(" ");
    await vi.waitFor(() => expect(spies.openProjectLocation).toHaveBeenCalledTimes(3));
    expect(spies.openProjectLocation).toHaveBeenLastCalledWith(...there);
  });

  it("offers to go only to people who are in a file, and keeps their role and place readable", () => {
    useCollabLiveStore.setState({
      peers: {
        bob: peer("bob", BOB_ID, "main.tex"),
        carol: peer("carol", CAROL_ID, null),
        mine: peer("mine", ALICE_ID, "intro.tex"),
      },
    });
    render(<CollabPane />);
    const people = screen.getByRole("list", { name: pane.people });
    const buttons = within(people).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      fill(enCollab.toolbar.goTo, { name: "Bob Smith" }),
    ]);
    expect(buttons[0]).toHaveAccessibleDescription(
      `${enCollab.projectRoles.owner} · ${fill(pane.hereIn, { path: "main.tex" })}`,
    );
    expect(buttons[0].className).toMatch(/hover:bg-/);
    expect(buttons[0].className).toMatch(/focus-visible:bg-/);
    expect(buttons[0].className).not.toMatch(/(^|\s)(focus-visible:)?(ring|outline)/);
    const rows = within(people).getAllByRole("listitem");
    expect(rows[2]).toHaveTextContent(pane.here);
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
    expect(rows[1]).not.toHaveTextContent("3");
    expect(rows[1].querySelector("time")).toHaveTextContent("2 minutes ago");
    expect(rows[2]).toHaveTextContent(fill(activity.role, { role: enCollab.projectRoles.viewer }));
    expect(rows[3]).toHaveTextContent(fill(activity.welcomeEdit, { owner: "Bob Smith", server: "Smith Lab" }));
  });

  it("says plainly when someone came and went more than once", () => {
    feed([
      { kind: "left", at: NOW, accountId: CAROL_ID, name: "Carol Diaz", count: 2 },
      { kind: "joined", at: NOW - 1000, accountId: BOB_ID, name: "Bob Smith", count: 3 },
      { kind: "left", at: NOW - 2000, accountId: ALICE_ID, name: "Alice Chen", count: 1 },
    ]);
    render(<CollabPane />);
    const rows = within(screen.getByRole("list", { name: pane.activity })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(fill(activity.visited, { name: "Carol Diaz" }));
    expect(rows[1]).toHaveTextContent(fill(activity.rejoined, { name: "Bob Smith" }));
    expect(rows[2]).toHaveTextContent(fill(activity.left, { name: "Alice Chen" }));
  });

  it("says who added or removed whom, and when someone joined or left on their own", () => {
    const base = { at: NOW, count: 1, byYou: false };
    feed([
      { ...base, kind: "memberAdded", accountId: CAROL_ID, byAccountId: BOB_ID, name: "Carol Diaz", by: "Bob Smith" },
      { ...base, kind: "memberAdded", accountId: CAROL_ID, byAccountId: ALICE_ID, name: "Carol Diaz", by: "Alice Chen", byYou: true },
      { ...base, kind: "memberAdded", accountId: CAROL_ID, byAccountId: CAROL_ID, name: "Carol Diaz", by: "Carol Diaz" },
      { ...base, kind: "memberRemoved", accountId: CAROL_ID, byAccountId: BOB_ID, name: "Carol Diaz", by: "Bob Smith" },
      { ...base, kind: "memberRemoved", accountId: CAROL_ID, byAccountId: ALICE_ID, name: "Carol Diaz", by: "Alice Chen", byYou: true },
      { ...base, kind: "memberRemoved", accountId: CAROL_ID, byAccountId: CAROL_ID, name: "Carol Diaz", by: "Carol Diaz" },
      { ...base, kind: "memberRemoved", accountId: CAROL_ID, byAccountId: BOB_ID, name: "", by: "" },
    ]);
    render(<CollabPane />);
    const rows = within(screen.getByRole("list", { name: pane.activity })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(fill(activity.memberAdded, { by: "Bob Smith", name: "Carol Diaz" }));
    expect(rows[1]).toHaveTextContent(fill(activity.memberAddedByYou, { name: "Carol Diaz" }));
    expect(rows[2]).toHaveTextContent(fill(activity.memberJoined, { name: "Carol Diaz" }));
    expect(rows[3]).toHaveTextContent(fill(activity.memberRemoved, { by: "Bob Smith", name: "Carol Diaz" }));
    expect(rows[4]).toHaveTextContent(fill(activity.memberRemovedByYou, { name: "Carol Diaz" }));
    expect(rows[5]).toHaveTextContent(fill(activity.memberLeft, { name: "Carol Diaz" }));
    const someone = enCollab.toolbar.unknownPerson;
    expect(rows[6]).toHaveTextContent(fill(activity.memberRemoved, { by: someone, name: someone }));
  });

  it("explains a paused account with Sign in, and ended access without it", async () => {
    feed([
      { kind: "suspended", at: NOW, server: "Smith Lab", count: 1 },
      { kind: "accessEnded", at: NOW - 1000, server: "Smith Lab", guest: false, count: 1 },
      { kind: "accessEnded", at: NOW - 2000, server: "Smith Lab", guest: true, count: 1 },
      { kind: "removed", at: NOW - 3000, by: "Bob Smith", count: 1 },
    ]);
    const user = userEvent.setup();
    render(<CollabPane />);
    const rows = within(screen.getByRole("list", { name: pane.activity })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(fill(activity.suspended, { server: "Smith Lab" }));
    expect(rows[1]).toHaveTextContent(fill(activity.accessEnded, { server: "Smith Lab" }));
    expect(rows[2]).toHaveTextContent(fill(activity.accessEndedGuest, { server: "Smith Lab" }));
    expect(rows[3]).toHaveTextContent(fill(activity.removedBy, { name: "Bob Smith" }));
    for (const row of rows.slice(1)) expect(within(row).queryByRole("button")).toBeNull();
    await user.click(within(rows[0]).getByRole("button", { name: activity.signIn }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "collaboration" });
  });

  it("offers Sign in in the status details while the account is paused", async () => {
    useCollabLiveStore.setState({ status: { state: "ended", reason: "account_suspended" }, ended: "account_suspended" });
    const user = userEvent.setup();
    render(<CollabPane />);
    await user.click(screen.getByRole("button", { name: enCollab.sync.suspended }));
    const details = screen.getByRole("dialog", { name: pane.status });
    await user.click(within(details).getByRole("button", { name: activity.signIn }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "collaboration" });
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
    expect(screen.getByRole("button", { name: enCollab.sync.removed })).toBeInTheDocument();
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

  it("says who changed a shared compile setting and what it is now", () => {
    const setting = (change: Extract<NewActivity, { kind: "setting" }>["change"], name = "Bob Smith"): ActivityEntry => ({
      kind: "setting",
      at: NOW,
      accountId: name ? BOB_ID : null,
      name,
      change,
      id: crypto.randomUUID(),
      count: 1,
    });
    feed([
      setting({ kind: "compiler", engine: "latexmk", flavor: "xelatex" }),
      setting({ kind: "mainDocument", path: "chapters/intro.tex" }),
      setting({ kind: "compiler", engine: "xetex", flavor: null }),
      setting({ kind: "compiler", engine: "latexmk", flavor: null }),
      setting({ kind: "spellingLanguage", locale: "fr_FR" }),
      setting({ kind: "spellingLanguage", locale: null }),
      setting({ kind: "typstVersion", version: "0.13.1" }),
      setting({ kind: "typstVersion", version: null }),
      setting({ kind: "typstOptions" }, ""),
    ]);
    render(<CollabPane />);
    const rows = within(screen.getByRole("list", { name: pane.activity })).getAllByRole("listitem");
    const said = activity.settings;
    const names = said.compilers;
    expect(rows[0]).toHaveTextContent(fill(said.compiler, { name: "Bob Smith", compiler: names.xelatex }));
    expect(rows[0].querySelector("svg.lucide-sliders-horizontal")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(fill(said.mainDocument, { name: "Bob Smith", path: "chapters/intro.tex" }));
    expect(rows[2]).toHaveTextContent(fill(said.compiler, { name: "Bob Smith", compiler: names.tectonic }));
    expect(rows[3]).toHaveTextContent(fill(said.compiler, { name: "Bob Smith", compiler: names.auto }));
    expect(rows[4]).toHaveTextContent(fill(said.spellingLanguage, { name: "Bob Smith", language: "French (France)" }));
    expect(rows[5]).toHaveTextContent(fill(said.spellingCleared, { name: "Bob Smith" }));
    expect(rows[6]).toHaveTextContent(fill(said.typstVersion, { name: "Bob Smith", version: "0.13.1" }));
    expect(rows[7]).toHaveTextContent(fill(said.typstDefault, { name: "Bob Smith" }));
    expect(rows[8]).toHaveTextContent(fill(said.typstOptions, { name: enCollab.toolbar.unknownPerson }));
    expect(activity.settings.compiler).toBe("{{name}} set the compiler to {{compiler}}");
    expect(fill(said.mainDocument, { name: "Alice", path: "intro.tex" })).toBe("Alice made intro.tex the main document");
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
  ])("keeps the ended state (%s) in the header with its sections still reachable", (reason, words) => {
    useCollabLiveStore.setState({ share: null, status: { state: "ended", reason }, ended: reason, peers: {}, members: [] });
    render(<CollabPane />);
    const header = screen.getByRole("heading", { name: pane.title }).closest("header") as HTMLElement;
    expect(within(header).getByRole("button", { name: words }).querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByTestId("collab-people")).toBeNull();
    expect(sectionToggle(pane.activity)).toHaveAttribute("aria-expanded", "true");
  });

  it("offers Sign in in the status details while signed out", async () => {
    useCollabLiveStore.setState({ status: { state: "ended", reason: "signed_out" }, ended: "signed_out" });
    const user = userEvent.setup();
    render(<CollabPane />);
    await user.click(screen.getByRole("button", { name: enCollab.sync.signedOut }));
    const details = screen.getByRole("dialog", { name: pane.status });
    await user.click(within(details).getByRole("button", { name: activity.signIn }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "collaboration" });
  });

  it.each<[Pick<CollabLiveStoreState, "status" | "pending">, string]>([
    [{ status: { state: "online" }, pending: 0 }, enCollab.sync.upToDate],
    [{ status: { state: "online" }, pending: 2 }, enCollab.sync.syncing],
    [{ status: { state: "offline", retry_in_ms: 1000 }, pending: 5 }, fill(enCollab.sync.offline, { number: "5" })],
    [{ status: { state: "offline", retry_in_ms: 1000 }, pending: 0 }, enCollab.sync.reconnecting],
    [{ status: { state: "ended", reason: "stopped" }, pending: 0 }, enCollab.sync.paused],
    [{ status: { state: "ended", reason: "access_ended" }, pending: 0 }, enCollab.sync.accessEnded],
  ])("shows the live state %j in its details without a Sign in button", async (live, words) => {
    useCollabLiveStore.setState(live);
    const user = userEvent.setup();
    render(<CollabPane />);
    await user.click(screen.getByRole("button", { name: words }));
    const details = screen.getByRole("dialog", { name: pane.status });
    expect(details).toHaveTextContent(words);
    expect(within(details).queryByRole("button")).toBeNull();
  });

  it("lets each section scroll on its own, split and resized like the Explorer sections", () => {
    feed(
      Array.from({ length: 40 }, (_, index) => ({
        kind: "joined" as const,
        at: NOW - index * 1000,
        accountId: CAROL_ID,
        name: "Carol Diaz",
        count: 1,
      })),
    );
    render(<CollabPane />);
    const stack = screen.getByTestId("collab-stack");
    expect(stack.closest(".overflow-y-auto")).toBeNull();
    for (const id of ["collab-people", "collab-activity", "collab-deleted"]) {
      const section = screen.getByTestId(id);
      expect(stack).toContainElement(section);
      expect(section.closest("[data-panel]")).not.toBeNull();
    }
    expect(document.getElementById("collab-people-content")).toHaveClass("overflow-y-auto");
    expect(document.getElementById("collab-activity-content")).toHaveClass("overflow-y-auto");
    const resize = fill(enWorkspace.explorer.resizeSections, { first: pane.people, second: pane.activity });
    expect(screen.getByRole("separator", { name: resize })).toBeInTheDocument();
  });

  it("keeps the file name whole when a person is in a file with a long path", async () => {
    const long = "chapters/part-one/section-three/subsection-alpha/very-long-file-name.tex";
    useCollabLiveStore.setState({ peers: { bob: peer("bob", BOB_ID, long) } });
    render(<CollabPane />);
    const rows = within(screen.getByRole("list", { name: pane.people })).getAllByRole("listitem");
    const where = within(rows[1]).getByText(/very-long-file-name\.tex$/);
    expect(where.textContent).toContain("…");
    expect(where.textContent).not.toContain("section-three");
    fireEvent.mouseEnter(where);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(fill(pane.hereIn, { path: long }));
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

  it("redraws only its status icon when the sync state changes", () => {
    feed([
      { kind: "online", at: NOW - 1000, count: 1 },
      { kind: "joined", at: NOW - 2000, accountId: CAROL_ID, name: "Carol Diaz", count: 1 },
    ]);
    render(<CollabPane />);
    spies.relativeTime.mockClear();
    spies.person.mockClear();
    act(() => useCollabLiveStore.setState({ pending: 3 }));
    expect(screen.getByRole("button", { name: enCollab.sync.syncing })).toBeInTheDocument();
    act(() => useCollabLiveStore.setState({ pending: 0, status: { state: "online" } }));
    expect(screen.getByRole("button", { name: enCollab.sync.upToDate })).toBeInTheDocument();
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
