import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabDocMessage } from "@/lib/tauri";
import {
  collabCompileBarrier,
  collabDocumentSession,
  collabProjectReadOnly,
  collabVisualReadOnly,
} from "@/lib/collab-live-bridge";

const mocks = vi.hoisted(() => ({
  collabDocOpen: vi.fn(),
  collabDocChange: vi.fn(),
  collabDocClose: vi.fn(),
  collabLiveFlush: vi.fn(),
  collabPresenceSet: vi.fn(),
  setCollabEditorExtension: vi.fn(),
  releaseExtension: vi.fn(),
  view: null as null | { state: { selection: { main: { head: number; anchor: number } } } },
  documentPath: null as string | null,
}));

vi.mock("@/lib/tauri", () => ({
  collabDocOpen: mocks.collabDocOpen,
  collabDocChange: mocks.collabDocChange,
  collabDocClose: mocks.collabDocClose,
  collabLiveFlush: mocks.collabLiveFlush,
  collabPresenceSet: mocks.collabPresenceSet,
  collabShareInfo: vi.fn(),
  collabLiveStart: vi.fn(),
  collabLiveStop: vi.fn(),
  collabMembersList: vi.fn(),
  onCollabLiveStatus: vi.fn(),
  onCollabLiveRole: vi.fn(),
  onCollabLiveMerged: vi.fn(),
  onCollabPresence: vi.fn(),
  onCollabPresenceLeft: vi.fn(),
}));

vi.mock("@oleafly/editor", () => ({
  getEditorView: () => mocks.view,
  getEditorDocumentPath: () => mocks.documentPath,
  subscribeEditorDocument: () => () => {},
}));

vi.mock("@/components/editor/cm/collab-slot", () => ({
  setCollabEditorExtension: mocks.setCollabEditorExtension,
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({
    projectId: null as string | null,
    activePath: null as string | null,
    files: {} as Record<string, { content: string; dirty: boolean }>,
    docVersion: 0,
    setContent: vi.fn((path: string, content: string) => {
      store.setState((state) => ({ files: { ...state.files, [path]: { content, dirty: true } } }));
      return true;
    }),
    bumpDocVersion: vi.fn(() => store.setState((state) => ({ docVersion: state.docVersion + 1 }))),
  }));
  return { useFilesStore: store };
});

import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "./live-store";
import { peerCursors, startLiveEditing } from "./live-editing";

const PROJECT = "project-1";
let channels: Map<string, (message: CollabDocMessage) => void>;
let release: (() => void) | null = null;

function start(role: "owner" | "editor" | "viewer" = "editor") {
  useCollabLiveStore.setState({ projectId: PROJECT, role });
  release = startLiveEditing({ projectId: PROJECT, role, accountId: "alice", deviceId: "device-me" });
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  channels = new Map();
  mocks.view = null;
  mocks.documentPath = null;
  mocks.setCollabEditorExtension.mockReturnValue(mocks.releaseExtension);
  mocks.collabDocOpen.mockImplementation(async (_projectId: string, path: string, onMessage) => {
    if (path === "excluded.log") return null;
    channels.set(`id-${path}`, onMessage);
    return { file_id: `id-${path}`, rev: 4, text: "shared" };
  });
  mocks.collabDocChange.mockResolvedValue(undefined);
  mocks.collabDocClose.mockResolvedValue(undefined);
  mocks.collabLiveFlush.mockResolvedValue(undefined);
  mocks.collabPresenceSet.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: PROJECT,
    activePath: "main.tex",
    files: { "main.tex": { content: "shared", dirty: false }, "excluded.log": { content: "log", dirty: false } },
    docVersion: 0,
  });
});

afterEach(() => {
  release?.();
  release = null;
  vi.useRealTimers();
});

describe("live editing", () => {
  it("binds text files of the live project to shared sessions and asks the editor to rebind", async () => {
    start();
    expect(useFilesStore.getState().docVersion).toBe(1);
    const session = collabDocumentSession("main.tex");
    expect(session).not.toBeNull();
    expect(collabDocumentSession("main.tex")).toBe(session);
    expect(collabDocumentSession("figure.png")).toBeNull();
    await settle();
    expect(mocks.collabDocOpen).toHaveBeenCalledWith(PROJECT, "main.tex", expect.any(Function));
    useFilesStore.setState({ projectId: "other" });
    expect(collabDocumentSession("main.tex")).toBeNull();
  });

  it("sends editor changes and keeps the files store current without marking it unsaved", async () => {
    start();
    const session = collabDocumentSession("main.tex");
    await settle();
    session?.applyLocal([{ from: 6, to: 6, insert: "!" }], session.version());
    expect(mocks.collabDocChange).toHaveBeenCalledWith(PROJECT, "id-main.tex", 4, [6, "!"]);
    expect(useFilesStore.getState().files["main.tex"]).toEqual({ content: "shared!", dirty: false });
    channels.get("id-main.tex")?.({ kind: "ack", rev: 5, length: 7 });
    channels.get("id-main.tex")?.({ kind: "remote", rev: 6, op: ["> ", 7], length: 9 });
    expect(useFilesStore.getState().files["main.tex"]?.content).toBe("> shared!");
  });

  it("hands a file the server does not share back to the files store", async () => {
    start();
    useFilesStore.setState({ activePath: "excluded.log" });
    const before = useFilesStore.getState().docVersion;
    expect(collabDocumentSession("excluded.log")).not.toBeNull();
    await settle();
    expect(collabDocumentSession("excluded.log")).toBeNull();
    expect(useFilesStore.getState().docVersion).toBe(before + 1);
    expect(useFilesStore.getState().setContent).not.toHaveBeenCalled();
  });

  it("flushes the live project before a compile and nothing else", async () => {
    start();
    await collabCompileBarrier("other");
    expect(mocks.collabLiveFlush).not.toHaveBeenCalled();
    await collabCompileBarrier(PROJECT);
    expect(mocks.collabLiveFlush).toHaveBeenCalledWith(PROJECT);
  });

  it("makes viewers read-only and follows role changes", () => {
    start("viewer");
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    expect(collabVisualReadOnly(PROJECT)).toBe(true);
    useCollabLiveStore.setState({ role: "editor" });
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    expect(collabVisualReadOnly(PROJECT)).toBe(true);
  });

  it("shares this person's file and selection, throttled", () => {
    mocks.view = { state: { selection: { main: { head: 4, anchor: 1 } } } };
    mocks.documentPath = "main.tex";
    start();
    expect(mocks.collabPresenceSet).toHaveBeenLastCalledWith(PROJECT, "main.tex", 4, 1);
    useFilesStore.setState({ activePath: "figure.png" });
    expect(mocks.collabPresenceSet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(mocks.collabPresenceSet).toHaveBeenLastCalledWith(PROJECT, "figure.png", null, null);
    expect(mocks.setCollabEditorExtension).toHaveBeenCalledOnce();
  });

  it("closes everything and returns the editor to local files when it stops", async () => {
    start("viewer");
    collabDocumentSession("main.tex");
    await settle();
    const version = useFilesStore.getState().docVersion;
    release?.();
    release = null;
    expect(mocks.collabDocClose).toHaveBeenCalledWith(PROJECT, "id-main.tex");
    expect(collabDocumentSession("main.tex")).toBeNull();
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    expect(collabVisualReadOnly(PROJECT)).toBe(false);
    expect(mocks.releaseExtension).toHaveBeenCalledOnce();
    expect(useFilesStore.getState().docVersion).toBe(version + 1);
  });
});

describe("peer cursors", () => {
  it("lists peers in the given file with their names and colours", () => {
    const person = { account_id: "bob", display_name: "Bob Jones", avatar_url: null, email: null, login: null };
    const cursors = peerCursors(
      {
        a: { deviceId: "a", accountId: "bob", person, path: "main.tex", cursor: 5, anchor: 2, seenAt: 0, hue: 30 },
        b: { deviceId: "b", accountId: "carol", person: null, path: "main.tex", cursor: 1, anchor: null, seenAt: 0, hue: 90 },
        c: { deviceId: "c", accountId: "dan", person: null, path: "other.tex", cursor: 1, anchor: 1, seenAt: 0, hue: 9 },
        d: { deviceId: "d", accountId: "eve", person: null, path: "main.tex", cursor: null, anchor: null, seenAt: 0, hue: 9 },
      },
      "main.tex",
    );
    expect(cursors).toEqual([
      { id: "a", name: "Bob Jones", hue: 30, head: 5, anchor: 2 },
      { id: "b", name: null, hue: 90, head: 1, anchor: 1 },
    ]);
    expect(peerCursors({}, null)).toEqual([]);
  });
});
