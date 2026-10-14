import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCollabRail } from "@/components/collab/collab-rail";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import type { CollabChangeSkipped, CollabLiveRenamed, CollabLiveSettings } from "@/lib/tauri";
import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL_ID, person, projectMember, shareInfo } from "../tests/fixtures";
const renamed = vi.hoisted(() => ({
  handler: null as ((payload: CollabLiveRenamed) => void) | null,
  unlisten: vi.fn(),
}));

const settings = vi.hoisted(() => ({
  handler: null as ((payload: CollabLiveSettings) => void) | null,
  unlisten: vi.fn(),
}));

const skipped = vi.hoisted(() => ({
  handler: null as ((payload: CollabChangeSkipped) => void) | null,
  unlisten: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  onCollabLiveRenamed: vi.fn(async (handler: (payload: CollabLiveRenamed) => void) => {
    renamed.handler = handler;
    return renamed.unlisten;
  }),
  onCollabLiveSettings: vi.fn(async (handler: (payload: CollabLiveSettings) => void) => {
    settings.handler = handler;
    return settings.unlisten;
  }),
  onCollabChangeSkipped: vi.fn(async (handler: (payload: CollabChangeSkipped) => void) => {
    skipped.handler = handler;
    return skipped.unlisten;
  }),
}));

import { startCollabActivity, WELCOMED_KEY } from "./activity-feed";
import { useCollabActivity } from "./activity-store";

function peer(deviceId: string, accountId: string, name: string | null = null): LivePeer {
  return {
    deviceId,
    accountId,
    person: name ? person({ account_id: accountId, display_name: name }) : null,
    path: "main.tex",
    cursor: null,
    anchor: null,
    seenAt: Date.now(),
    hue: 10,
  };
}

const kinds = () => useCollabActivity.getState().entries.map((entry) => entry.kind);
let stop: () => void = () => undefined;

function joined(role: "owner" | "editor" | "viewer" = "editor") {
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo({ role, account_id: role === "owner" ? BOB_ID : ALICE_ID }),
    role,
    status: { state: "online" },
    pending: 0,
    peers: {},
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor")],
    merged: null,
    newDevice: null,
    ended: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
  useCollabRail.setState({ visible: false, unread: false });
  useCollabLiveStore.setState({
    projectId: null,
    share: null,
    role: null,
    status: null,
    pending: 0,
    peers: {},
    members: [],
    merged: null,
    newDevice: null,
    ended: null,
  });
});

afterEach(() => {
  stop();
});

describe("startCollabActivity", () => {
  it("greets a joined project once, with owner, server and role", () => {
    joined();
    stop = startCollabActivity();
    expect(useCollabActivity.getState().entries[0]).toMatchObject({
      kind: "welcome",
      owner: "Bob Smith",
      server: "Smith Lab",
      role: "editor",
    });
    expect(JSON.parse(localStorage.getItem(WELCOMED_KEY) ?? "[]")).toEqual(["grant"]);
    stop();
    useCollabActivity.setState({ projectId: null, entries: [], unread: false });
    stop = startCollabActivity();
    expect(kinds()).toEqual(["welcome"]);
    expect(useCollabActivity.getState().entries).toHaveLength(1);
  });

  it("never greets the owner", () => {
    joined("owner");
    stop = startCollabActivity();
    expect(kinds()).toEqual([]);
  });

  it("records going offline with waiting changes, then one folded entry for coming back", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1000 }, pending: 2 });
    useCollabLiveStore.setState({ pending: 5 });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "offline", pending: 5 });
    useCollabLiveStore.setState({ status: { state: "connecting" } });
    useCollabLiveStore.setState({ status: { state: "online" }, pending: 0 });
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1000 }, pending: 1 });
    useCollabLiveStore.setState({ status: { state: "online" }, pending: 0 });
    expect(useCollabActivity.getState().entries).toHaveLength(1);
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "online", count: 4 });
  });

  it("records people opening and leaving the project, but not this person", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ peers: { mine: peer("mine", BOB_ID, "Bob Smith"), alice: peer("alice", ALICE_ID) } });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "joined", accountId: ALICE_ID, name: "Alice Chen" });
    useCollabLiveStore.setState({
      peers: { mine: peer("mine", BOB_ID), alice: peer("alice", ALICE_ID), laptop: peer("laptop", ALICE_ID) },
    });
    expect(useCollabActivity.getState().entries).toHaveLength(1);
    useCollabLiveStore.setState({ peers: { carol: peer("carol", CAROL_ID, "Carol Diaz") } });
    expect(kinds()).toEqual(["joined", "left"]);
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ name: "Carol Diaz" });
  });

  it("records merges, role changes and the end of sharing, and keeps the rail visible after access ends", () => {
    joined();
    stop = startCollabActivity();
    expect(useCollabRail.getState()).toEqual({ visible: true, unread: true });
    const merged = {
      projectId: "grant",
      files: [{ path: "main.tex", changes: 4 }],
      authors: [{ accountId: BOB_ID, files: [{ path: "main.tex", changes: 4 }] }],
      review: { before: "b", after: "a" },
    };
    useCollabLiveStore.setState({ merged });
    useCollabLiveStore.setState({ role: "viewer" });
    useCollabLiveStore.setState({
      status: { state: "ended", reason: "removed" },
      ended: "removed",
      peers: {},
      share: null,
      role: null,
    });
    expect(kinds()).toEqual(["removed", "role", "merged", "welcome"]);
    expect(useCollabActivity.getState().entries[2]).toMatchObject({
      files: merged.files,
      authors: merged.authors,
      review: merged.review,
    });
    expect(useCollabRail.getState().visible).toBe(true);
  });

  it("notes quietly, with a rail dot, when someone signs in on a new device", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabActivity.getState().markRead();
    useCollabLiveStore.setState({ newDevice: { projectId: "grant", accountId: BOB_ID, deviceId: "tablet" } });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({
      kind: "newDevice",
      accountId: BOB_ID,
      name: "Bob Smith",
    });
    expect(useCollabRail.getState().unread).toBe(true);
    useCollabLiveStore.setState({ newDevice: { projectId: "grant", accountId: CAROL_ID, deviceId: "phone" } });
    expect(kinds().slice(0, 2)).toEqual(["newDevice", "newDevice"]);
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ accountId: CAROL_ID, name: "" });
  });

  it("notes quietly, without a rail dot, a change it had to skip, naming who made it when known", async () => {
    joined();
    useCollabLiveStore.setState({ peers: { "bob-laptop": peer("bob-laptop", BOB_ID) } });
    stop = startCollabActivity();
    await vi.waitFor(() => expect(skipped.handler).not.toBeNull());
    useCollabActivity.getState().markRead();

    skipped.handler?.({ projectId: "thesis", seq: 7, deviceId: "bob-laptop" });
    expect(kinds()).not.toContain("skipped");

    skipped.handler?.({ projectId: "grant", seq: 7, deviceId: "bob-laptop" });
    skipped.handler?.({ projectId: "grant", seq: 8, deviceId: "bob-laptop" });
    skipped.handler?.({ projectId: "grant", seq: 9, deviceId: null });
    expect(useCollabActivity.getState().entries.slice(0, 2)).toMatchObject([
      { kind: "skipped", deviceId: null, name: "", count: 1 },
      { kind: "skipped", deviceId: "bob-laptop", name: "Bob Smith", count: 2 },
    ]);
    expect(useCollabActivity.getState().unread).toBe(false);
    expect(useCollabRail.getState().unread).toBe(false);
    stop();
    expect(skipped.unlisten).toHaveBeenCalled();
  });

  it("notes quietly, with a rail dot, when someone else's name for a file wins over yours", async () => {
    joined();
    stop = startCollabActivity();
    await vi.waitFor(() => expect(renamed.handler).not.toBeNull());
    useCollabActivity.getState().markRead();
    const lost = { before: "intro.tex", ours: "overview.tex", theirs: "background.tex" };
    renamed.handler?.({ projectId: "thesis", accountId: BOB_ID, ...lost });
    expect(kinds()).toEqual(["welcome"]);
    expect(useCollabRail.getState().unread).toBe(false);
    renamed.handler?.({ projectId: "grant", accountId: BOB_ID, ...lost });
    renamed.handler?.({ projectId: "grant", accountId: null, ...lost });
    expect(useCollabActivity.getState().entries.slice(0, 2)).toMatchObject([
      { kind: "renamed", accountId: null, name: "", ...lost },
      { kind: "renamed", accountId: BOB_ID, name: "Bob Smith", ...lost },
    ]);
    expect(useCollabRail.getState().unread).toBe(true);
    stop();
    expect(renamed.unlisten).toHaveBeenCalled();
  });

  it("names who changed a shared compile setting, without a toast", async () => {
    useToastStore.getState().reset();
    joined();
    stop = startCollabActivity();
    await vi.waitFor(() => expect(settings.handler).not.toBeNull());
    useCollabActivity.getState().markRead();
    const compiler = { kind: "compiler", engine: "latexmk", flavor: "xelatex" } as const;
    const main = { kind: "mainDocument", path: "intro.tex" } as const;
    settings.handler?.({ projectId: "thesis", accountId: BOB_ID, changes: [compiler] });
    expect(kinds()).toEqual(["welcome"]);
    settings.handler?.({ projectId: "grant", accountId: BOB_ID, changes: [main, compiler] });
    settings.handler?.({ projectId: "grant", accountId: null, changes: [{ kind: "typstOptions" }] });
    expect(useCollabActivity.getState().entries.slice(0, 3)).toMatchObject([
      { kind: "setting", accountId: null, name: "", change: { kind: "typstOptions" } },
      { kind: "setting", accountId: BOB_ID, name: "Bob Smith", change: compiler },
      { kind: "setting", accountId: BOB_ID, name: "Bob Smith", change: main },
    ]);
    expect(useCollabRail.getState().unread).toBe(true);
    expect(useToastStore.getState().toasts).toEqual([]);
    stop();
    expect(settings.unlisten).toHaveBeenCalled();
  });

  it("keeps the feed working when it cannot listen for renames", async () => {
    const { onCollabLiveRenamed } = await import("@/lib/tauri");
    vi.mocked(onCollabLiveRenamed).mockRejectedValueOnce(new Error("no bridge"));
    joined();
    stop = startCollabActivity();
    useCollabLiveStore.setState({ role: "viewer" });
    expect(kinds()).toEqual(["role", "welcome"]);
    stop();
    await Promise.resolve();
  });

  it("names the server when this person is signed out", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ status: { state: "ended", reason: "signed_out" }, ended: "signed_out" });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "signedOut", server: "Smith Lab" });
  });

  it.each([
    ["client_too_old", "clientTooOld"],
    ["server_too_old", "serverTooOld"],
    ["server_changed", "serverChanged"],
  ] as const)("names the server when syncing stops with %s", (reason, kind) => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ status: { state: "ended", reason }, ended: reason });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind, server: "Smith Lab" });
  });

  it("says an admin paused the account, naming the server", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({
      status: { state: "ended", reason: "account_suspended" },
      ended: "account_suspended",
    });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "suspended", server: "Smith Lab" });
  });

  it("says access to the server ended, and knows when this person was a guest", () => {
    joined();
    useCollabLiveStore.setState({
      members: [projectMember(BOB, "owner"), projectMember(person({ guest: true }), "editor")],
    });
    stop = startCollabActivity();
    useCollabLiveStore.setState({
      status: { state: "ended", reason: "access_ended" },
      ended: "access_ended",
      peers: {},
    });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({
      kind: "accessEnded",
      server: "Smith Lab",
      guest: true,
    });
  });

  it("records who added and removed whom, but not a role change or this person's own arrival", () => {
    joined("owner");
    useCollabLiveStore.setState({ memberChange: null });
    stop = startCollabActivity();
    const change = { projectId: "grant", by: BOB_ID, byName: "Bob Smith" };
    useCollabLiveStore.setState({
      memberChange: { ...change, accountId: CAROL_ID, kind: "added", name: "Carol Diaz" },
    });
    useCollabLiveStore.setState({
      memberChange: { ...change, accountId: CAROL_ID, kind: "role_changed", name: "Carol Diaz" },
    });
    useCollabLiveStore.setState({
      memberChange: { ...change, accountId: BOB_ID, kind: "added", name: "Bob Smith" },
    });
    useCollabLiveStore.setState({
      memberChange: {
        projectId: "grant",
        accountId: CAROL_ID,
        by: ALICE_ID,
        byName: "Alice Chen",
        kind: "removed",
        name: "Carol Diaz",
      },
    });
    expect(useCollabActivity.getState().entries.slice(0, 2)).toMatchObject([
      { kind: "memberRemoved", accountId: CAROL_ID, byAccountId: ALICE_ID, name: "Carol Diaz", by: "Alice Chen", byYou: false },
      { kind: "memberAdded", accountId: CAROL_ID, byAccountId: BOB_ID, name: "Carol Diaz", by: "Bob Smith", byYou: true },
    ]);
    expect(kinds()).toHaveLength(2);
  });

  it("names who removed this person when the project stops syncing for them", () => {
    joined();
    useCollabLiveStore.setState({ memberChange: null });
    stop = startCollabActivity();
    useCollabLiveStore.setState({
      memberChange: {
        projectId: "grant",
        accountId: ALICE_ID,
        by: BOB_ID,
        byName: "Bob Smith",
        kind: "removed",
        name: "Alice Chen",
      },
    });
    useCollabLiveStore.setState({ status: { state: "ended", reason: "removed" }, ended: "removed", peers: {} });
    expect(kinds()).toEqual(["removed", "welcome"]);
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "removed", by: "Bob Smith" });
  });

  it("starts a fresh feed for another project and hides the rail when nothing is shared", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1 }, pending: 0 });
    useCollabLiveStore.setState({ projectId: "thesis", share: null, status: null, peers: {}, members: [] });
    expect(useCollabActivity.getState()).toMatchObject({ projectId: "thesis", entries: [] });
    expect(useCollabRail.getState()).toEqual({ visible: false, unread: false });
    stop();
    expect(useCollabRail.getState()).toEqual({ visible: false, unread: false });
  });

  it("clears the rail dot when the activity is read", () => {
    joined();
    stop = startCollabActivity();
    expect(useCollabRail.getState().unread).toBe(true);
    useCollabActivity.getState().markRead();
    expect(useCollabRail.getState().unread).toBe(false);
  });

  it("leaves stored settings alone while people move around", () => {
    joined();
    stop = startCollabActivity();
    const getItem = vi.spyOn(localStorage, "getItem");
    try {
      for (let cursor = 0; cursor < 20; cursor += 1) {
        useCollabLiveStore.setState({ peers: { carol: { ...peer("carol", CAROL_ID, "Carol Diaz"), cursor } } });
      }
      useCollabLiveStore.setState({ pending: 1 });
      useCollabLiveStore.setState({ pending: 0 });
      expect(getItem).not.toHaveBeenCalled();
      expect(kinds()).toEqual(["joined", "welcome"]);
      useCollabLiveStore.setState({ role: "viewer" });
      expect(getItem).toHaveBeenCalled();
      expect(kinds()).toEqual(["role", "joined", "welcome"]);
    } finally {
      getItem.mockRestore();
    }
  });

  it("greets the project when the stored list of greeted projects is damaged", () => {
    localStorage.setItem(WELCOMED_KEY, JSON.stringify({ grant: true }));
    joined();
    stop = startCollabActivity();
    expect(kinds()).toEqual(["welcome"]);
    expect(JSON.parse(localStorage.getItem(WELCOMED_KEY) ?? "null")).toEqual(["grant"]);
  });

  it("records a visitor it cannot name with an empty name", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ peers: { dan: peer("dan", "acc-dan") } });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "joined", accountId: "acc-dan", name: "" });
  });

  it("says access ended without calling the person a guest once their share is gone", () => {
    joined();
    useCollabLiveStore.setState({
      members: [projectMember(BOB, "owner"), projectMember(person({ guest: true }), "editor")],
    });
    stop = startCollabActivity();
    useCollabLiveStore.setState({
      share: null,
      role: null,
      status: { state: "ended", reason: "access_ended" },
      ended: "access_ended",
      peers: {},
    });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({
      kind: "accessEnded",
      server: "Smith Lab",
      guest: false,
    });
  });

  it("records who added someone while this person's share is not loaded", () => {
    joined("owner");
    useCollabLiveStore.setState({ memberChange: null });
    stop = startCollabActivity();
    useCollabLiveStore.setState({
      share: null,
      memberChange: {
        projectId: "grant",
        accountId: CAROL_ID,
        by: BOB_ID,
        byName: "Bob Smith",
        kind: "added",
        name: "Carol Diaz",
      },
    });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({
      kind: "memberAdded",
      accountId: CAROL_ID,
      by: "Bob Smith",
      byYou: false,
    });
  });

  it("leaves out who removed this person when their name is not known", () => {
    joined();
    useCollabLiveStore.setState({ memberChange: null });
    stop = startCollabActivity();
    useCollabLiveStore.setState({
      memberChange: { projectId: "grant", accountId: ALICE_ID, by: BOB_ID, byName: "", kind: "removed", name: "Alice Chen" },
    });
    useCollabLiveStore.setState({ status: { state: "ended", reason: "removed" }, ended: "removed", peers: {} });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "removed" });
    expect(useCollabActivity.getState().entries[0]).not.toHaveProperty("by", expect.anything());
  });

  it("adds nothing when the owner stops sharing", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ status: { state: "ended", reason: "stopped" }, ended: "stopped", peers: {} });
    expect(kinds()).toEqual([]);
  });
});
