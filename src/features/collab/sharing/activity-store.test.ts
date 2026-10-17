import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import {
  ACTIVITY_CAP,
  activityKey,
  pushActivity,
  useCollabActivity,
  type ActivityEntry,
  type NewActivity,
} from "./activity-store";

function entry(kind: NewActivity["kind"], at: number, extra: Partial<NewActivity> = {}): NewActivity {
  return { kind, at, ...extra } as NewActivity;
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
});

afterEach(() => {
  localStorage.clear();
});

describe("pushActivity", () => {
  it("puts the newest entry first", () => {
    const first = pushActivity([], entry("online", 1));
    const next = pushActivity(first, entry("merged", 2, { files: [{ path: "main.tex", changes: 3 }] }));
    expect(next.map((item) => item.kind)).toEqual(["merged", "online"]);
    expect(next[0]).toMatchObject({ at: 2, count: 1 });
    expect(next[0].id).not.toBe(next[1].id);
  });

  it("folds repeated connection drops into the newest entry, updating its state, count and time", () => {
    let entries: ActivityEntry[] = pushActivity([], entry("offline", 1, { pending: 2 }));
    entries = pushActivity(entries, entry("online", 2));
    entries = pushActivity(entries, entry("offline", 3, { pending: 5 }));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "offline", at: 3, count: 3, pending: 5 });
    entries = pushActivity(entries, entry("role", 4, { role: "viewer" }));
    entries = pushActivity(entries, entry("online", 5));
    expect(entries.map((item) => item.kind)).toEqual(["online", "role", "offline"]);
  });

  it("folds one person opening and closing the project again and again, but not two people", () => {
    let entries: ActivityEntry[] = pushActivity([], entry("joined", 1, { accountId: "alice", name: "Alice" }));
    entries = pushActivity(entries, entry("left", 2, { accountId: "alice", name: "Alice" }));
    entries = pushActivity(entries, entry("joined", 3, { accountId: "alice", name: "Alice" }));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "joined", count: 3, at: 3 });
    entries = pushActivity(entries, entry("joined", 4, { accountId: "bob", name: "Bob" }));
    expect(entries).toHaveLength(2);
  });

  it("keeps at most the newest 200 entries", () => {
    let entries: ActivityEntry[] = [];
    for (let index = 0; index < ACTIVITY_CAP + 25; index += 1) {
      entries = pushActivity(entries, entry("role", index, { role: index % 2 ? "editor" : "viewer" }));
    }
    expect(entries).toHaveLength(ACTIVITY_CAP);
    expect(entries[0].at).toBe(ACTIVITY_CAP + 24);
    expect(entries.at(-1)?.at).toBe(25);
  });
});

describe("useCollabActivity", () => {
  it("keeps a feed per project that survives a reload", () => {
    const activity = useCollabActivity.getState();
    activity.open("grant");
    activity.add(entry("online", 10));
    activity.open("thesis");
    expect(useCollabActivity.getState().entries).toEqual([]);
    activity.add(entry("merged", 20, { files: [] }));
    expect(JSON.parse(localStorage.getItem(activityKey("grant")) ?? "{}").entries).toHaveLength(1);
    useCollabActivity.setState({ projectId: null, entries: [], unread: false });
    useCollabActivity.getState().open("grant");
    expect(useCollabActivity.getState().entries.map((item) => item.kind)).toEqual(["online"]);
    expect(useCollabActivity.getState().unread).toBe(true);
  });

  it("marks new activity unread unless the pane is open, and opening it clears the mark", () => {
    const activity = useCollabActivity.getState();
    activity.open("grant");
    activity.add(entry("online", 1));
    expect(useCollabActivity.getState().unread).toBe(true);
    useCollabActivity.getState().markRead();
    expect(useCollabActivity.getState().unread).toBe(false);
    expect(JSON.parse(localStorage.getItem(activityKey("grant")) ?? "{}").unread).toBe(false);
    useSettingsStore.setState({ railTab: "collab", showTree: true });
    useCollabActivity.getState().add(entry("offline", 2, { pending: 1 }));
    expect(useCollabActivity.getState().unread).toBe(false);
    useSettingsStore.setState({ railTab: "collab", showTree: false });
    useCollabActivity.getState().add(entry("role", 3, { role: "viewer" }));
    expect(useCollabActivity.getState().unread).toBe(true);
  });

  it("updates waiting changes quietly while still offline", () => {
    const activity = useCollabActivity.getState();
    activity.open("grant");
    activity.add(entry("offline", 1, { pending: 1 }));
    activity.markRead();
    useCollabActivity.getState().setPending(4);
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "offline", pending: 4, count: 1 });
    expect(useCollabActivity.getState().unread).toBe(false);
  });

  it("ignores storage that cannot be read", () => {
    localStorage.setItem(activityKey("grant"), "{not json");
    useCollabActivity.getState().open("grant");
    expect(useCollabActivity.getState()).toMatchObject({ projectId: "grant", entries: [], unread: false });
  });

  it("adds nothing without an open project", () => {
    useCollabActivity.getState().add(entry("online", 1));
    expect(useCollabActivity.getState().entries).toEqual([]);
  });

  it("reads a stored feed without entries as empty but keeps its unread mark", () => {
    localStorage.setItem(activityKey("grant"), JSON.stringify({ entries: "broken", unread: true }));
    useCollabActivity.getState().open("grant");
    expect(useCollabActivity.getState()).toMatchObject({ projectId: "grant", entries: [], unread: true });
  });

  it("clears the unread mark without a project and stores nothing", () => {
    useCollabActivity.setState({ projectId: null, entries: [], unread: true });
    useCollabActivity.getState().markRead();
    expect(useCollabActivity.getState().unread).toBe(false);
    expect(localStorage).toHaveLength(0);
  });

  it("closes the feed when no project is open", () => {
    useCollabActivity.getState().open("grant");
    useCollabActivity.getState().add(entry("online", 1));
    useCollabActivity.getState().open(null);
    expect(useCollabActivity.getState()).toEqual(expect.objectContaining({ projectId: null, entries: [], unread: false }));
  });
});
