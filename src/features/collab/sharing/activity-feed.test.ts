import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCollabRail } from "@/components/collab/collab-rail";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL_ID, person, projectMember, shareInfo } from "../tests/fixtures";
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
    const merged = { projectId: "grant", files: [{ path: "main.tex", changes: 4 }] };
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
    expect(useCollabActivity.getState().entries[2]).toMatchObject({ files: merged.files });
    expect(useCollabRail.getState().visible).toBe(true);
  });

  it("names the server when this person is signed out", () => {
    joined("owner");
    stop = startCollabActivity();
    useCollabLiveStore.setState({ status: { state: "ended", reason: "signed_out" }, ended: "signed_out" });
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "signedOut", server: "Smith Lab" });
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
});
