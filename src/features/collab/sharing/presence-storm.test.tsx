// @vitest-environment jsdom

import { appendFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { Profiler, useState, type ProfilerOnRenderCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { collabEditorSlot } from "@/components/editor/cm/collab-slot";
import { TreeRowPeers, type PeerMarks } from "@/components/collab/CollabSlots";
import type { CollabPresence, CollabProjectMember } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, ((payload: unknown) => void) | undefined>,
  view: null as unknown,
}));

function listener(name: string) {
  return async (handler: (payload: unknown) => void) => {
    mocks.handlers[name] = handler;
    return () => {
      if (mocks.handlers[name] === handler) mocks.handlers[name] = undefined;
    };
  };
}

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabShareInfo: vi.fn(async () => STORM_SHARE),
  collabLiveStart: vi.fn(async () => ({ role: "editor", account_id: SELF_ID, device_id: "device-self" })),
  collabLiveStop: vi.fn(async () => undefined),
  collabLiveFlush: vi.fn(async () => undefined),
  collabMembersList: vi.fn(async () => STORM_MEMBERS),
  collabPresenceSet: vi.fn(async () => undefined),
  collabDocOpen: vi.fn(async () => null),
  collabDocChange: vi.fn(async () => undefined),
  collabDocClose: vi.fn(async () => undefined),
  onCollabLiveStatus: listener("status"),
  onCollabLiveRole: listener("role"),
  onCollabLiveMerged: listener("merged"),
  onCollabLiveNewDevice: listener("newDevice"),
  onCollabPresence: listener("presence"),
  onCollabPresenceLeft: listener("left"),
}));

vi.mock("@oleafly/editor", () => ({
  getEditorView: () => mocks.view,
  getEditorDocumentPath: () => "main.tex",
  subscribeEditorDocument: () => () => {},
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: "grant" as string | null,
      activePath: "main.tex" as string | null,
      files: {} as Record<string, { content: string; dirty: boolean }>,
      projects: [],
      docVersion: 0,
      saveAllDirty: async () => {},
      setContent: () => true,
      bumpDocVersion: () => {},
    })),
    onPathsMoved: () => () => {},
    onPathsDeleted: () => () => {},
  };
});

import { startLive } from "../live";
import { startCollabActivity } from "./activity-feed";
import { ACTIVITY_CAP, useCollabActivity, type ActivityEntry } from "./activity-store";
import { CollabPane } from "./CollabPane";
import { CollabShareButton, CollabToolbarItem } from "./CollabToolbarItem";
import { TreePresence } from "./TreePresence";

const SELF_ID = "account-self";
const PATHS = ["main.tex", "intro.tex", "refs.bib"];
const LINES = 2_000;
const ROUND_MS = 100;
const TREE_ROWS = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}`, path: PATHS[index % PATHS.length] }));

let STORM_MEMBERS: CollabProjectMember[] = [];
const STORM_SHARE = {
  project_id: "grant",
  server_id: "server",
  server_name: "Smith Lab",
  server_url: "https://collab.uni.edu",
  shared_project_id: "shared",
  role: "editor" as const,
  link: "https://collab.uni.edu/p/shared",
  account_id: SELF_ID,
};

function members(count: number): CollabProjectMember[] {
  const list: CollabProjectMember[] = [
    {
      person: { account_id: SELF_ID, display_name: "Self Person", avatar_url: null, email: null, login: null },
      role: "editor",
      granted_at: 1,
    },
    {
      person: { account_id: "account-owner", display_name: "Owner Person", avatar_url: null, email: null, login: null },
      role: "owner",
      granted_at: 1,
    },
  ];
  for (let index = 0; index < count; index += 1) {
    list.push({
      person: {
        account_id: `account-${index}`,
        display_name: `Person ${String(index).padStart(2, "0")} Example`,
        avatar_url: null,
        email: null,
        login: null,
      },
      role: "editor",
      granted_at: 1,
    });
  }
  return list;
}

function history(length: number): ActivityEntry[] {
  return Array.from({ length }, (_, index) => ({
    kind: "joined" as const,
    at: Date.now() - index * 60_000,
    accountId: `account-${index % 7}`,
    name: `Person ${index % 7}`,
    id: `entry-${index}`,
    count: 1,
  }));
}

interface Counter {
  commits: number;
  ms: number;
}

const counters: Record<string, Counter> = {};
const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  const counter = counters[id] ?? { commits: 0, ms: 0 };
  counters[id] = counter;
  counter.commits += 1;
  counter.ms += actualDuration;
};

const NO_MARKS: PeerMarks = new Map();

function TreeHost() {
  const [marks, setMarks] = useState<PeerMarks>(NO_MARKS);
  return (
    <Profiler id="tree" onRender={onRender}>
      <TreePresence onChange={setMarks} />
      <div>
        {TREE_ROWS.map((row) => (
          <div key={row.id}>
            {row.path}
            <TreeRowPeers marks={marks.get(row.path)} />
          </div>
        ))}
      </div>
    </Profiler>
  );
}

function longDocument(): string {
  return Array.from(
    { length: LINES },
    (_, index) => `Line ${index}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  ).join("\n");
}

function emit(name: string, payload: unknown): void {
  const handler = mocks.handlers[name];
  if (!handler) throw new Error(`no ${name} listener`);
  handler(payload);
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

interface StormResult {
  events: number;
  openFileEvents: number;
  pathChanges: number;
  paneCommits: number;
  paneMs: number;
  toolbarCommits: number;
  shareCommits: number;
  treeCommits: number;
  treeMs: number;
  cursorUpdates: number;
  storageReads: number;
  presenceMs: number;
  typingPaneCommits: number;
  typingPaneMs: number;
}

function clearCounters(): void {
  for (const key of Object.keys(counters)) delete counters[key];
}

interface StormSize {
  peers: number;
  rounds: number;
  entries: number;
  flips: number;
}

async function storm({ peers, rounds, entries, flips }: StormSize): Promise<StormResult> {
  STORM_MEMBERS = members(peers);
  const doc = longDocument();
  let cursorUpdates = 0;
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        collabEditorSlot(),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet && update.transactions.some((tr) => tr.effects.length > 0)) {
            cursorUpdates += 1;
          }
        }),
      ],
    }),
    parent: document.body,
  });
  mocks.view = view;
  const stopLive = startLive();
  const stopActivity = startCollabActivity();
  await act(async () => {
    await flush();
  });
  useCollabActivity.setState({ entries: history(entries), unread: false });
  const screen = render(
    <>
      <Profiler id="pane" onRender={onRender}>
        <CollabPane />
      </Profiler>
      <Profiler id="toolbar" onRender={onRender}>
        <CollabToolbarItem />
      </Profiler>
      <Profiler id="share" onRender={onRender}>
        <CollabShareButton />
      </Profiler>
      <TreeHost />
    </>,
  );
  await act(async () => {
    await flush();
  });
  clearCounters();
  cursorUpdates = 0;
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  let seed = 7;
  const random = (limit: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % limit;
  };
  let events = 0;
  let openFileEvents = 0;
  let pathChanges = 0;
  const where = Array.from({ length: peers }, (_, index) => PATHS[index % PATHS.length]);
  const started = performance.now();
  for (let round = 0; round < rounds; round += 1) {
    vi.advanceTimersByTime(ROUND_MS);
    for (let index = 0; index < peers; index += 1) {
      const before = where[index];
      if ((index * 7 + 3) % rounds === round) {
        where[index] = PATHS[(PATHS.indexOf(before) + 1) % PATHS.length];
        pathChanges += 1;
      }
      if (before === PATHS[0] || where[index] === PATHS[0]) openFileEvents += 1;
      const cursor = random(doc.length);
      const payload: CollabPresence = {
        projectId: "grant",
        deviceId: `device-${index}`,
        accountId: `account-${index}`,
        path: where[index],
        cursor,
        anchor: round % 2 === 0 ? cursor : Math.max(0, cursor - 12),
      };
      await act(async () => {
        emit("presence", payload);
        await flush();
      });
      events += 1;
    }
  }
  const presenceMs = performance.now() - started;
  const storageReads = getItem.mock.calls.length;
  getItem.mockRestore();
  const presence = { ...counters };
  clearCounters();
  for (let flip = 0; flip < flips; flip += 1) {
    await act(async () => {
      emit("status", { projectId: "grant", status: { state: "online" }, pending: flip % 2 === 0 ? 1 : 0 });
      await flush();
    });
  }
  const result: StormResult = {
    events,
    openFileEvents,
    pathChanges,
    paneCommits: presence.pane?.commits ?? 0,
    paneMs: Math.round(presence.pane?.ms ?? 0),
    toolbarCommits: presence.toolbar?.commits ?? 0,
    shareCommits: presence.share?.commits ?? 0,
    treeCommits: presence.tree?.commits ?? 0,
    treeMs: Math.round(presence.tree?.ms ?? 0),
    cursorUpdates,
    storageReads,
    presenceMs: Math.round(presenceMs),
    typingPaneCommits: counters.pane?.commits ?? 0,
    typingPaneMs: Math.round(counters.pane?.ms ?? 0),
  };
  screen.unmount();
  stopActivity();
  stopLive();
  view.destroy();
  mocks.view = null;
  clearCounters();
  return result;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  localStorage.clear();
  mocks.handlers = {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe("presence storm", () => {
  it("redraws only what a presence or sync change actually alters", async () => {
    const peers = 6;
    const result = await storm({ peers, rounds: 6, entries: 20, flips: 10 });
    const placeChanges = peers + result.pathChanges;
    expect(result.events).toBe(36);
    expect(result.paneCommits).toBeLessThanOrEqual(3 * placeChanges);
    expect(result.toolbarCommits).toBeLessThanOrEqual(placeChanges);
    expect(result.treeCommits).toBeLessThanOrEqual(2 * placeChanges);
    expect(result.shareCommits).toBe(0);
    expect(result.cursorUpdates).toBeLessThanOrEqual(result.openFileEvents);
    expect(result.storageReads).toBe(0);
    expect(result.typingPaneCommits).toBe(10);
  });
});

describe.skipIf(!process.env.COLLAB_BENCH_OUT)("presence storm timing", () => {
  it.each([10, 30])("handles %i people moving their cursors ten times a second for five seconds", async (peers) => {
    const result = await storm({ peers, rounds: 50, entries: ACTIVITY_CAP, flips: 40 });
    appendFileSync(process.env.COLLAB_BENCH_OUT ?? "", `storm ${peers} ${JSON.stringify(result)}\n`);
    expect(result.events).toBe(peers * 50);
  }, 300_000);
});
