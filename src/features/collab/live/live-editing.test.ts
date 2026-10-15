import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabDocMessage } from "@/lib/tauri";
import type { RemoteCursorSource } from "./remote-cursors";
import {
  collabCompileBarrier,
  collabDocumentSession,
  collabHandBack,
  collabProjectReadOnly,
  collabVisualReadOnly,
} from "@/lib/collab-live-bridge";

const mocks = vi.hoisted(() => ({
  indexUpdateFile: vi.fn(),
  collabDocOpen: vi.fn(),
  collabDocChange: vi.fn(),
  collabDocClose: vi.fn(),
  collabLiveFlush: vi.fn(),
  collabPresenceSet: vi.fn(),
  collabPresenceLeave: vi.fn(),
  setCollabEditorExtension: vi.fn(),
  releaseExtension: vi.fn(),
  view: null as null | { state: { selection: { main: { head: number; anchor: number } } } },
  documentPath: null as string | null,
  documentListeners: new Set<() => void>(),
  cursorSource: null as null | RemoteCursorSource,
  pathMoves: new Set<(event: { projectId: string; from: string; to: string }) => void>(),
  pathDeletes: new Set<(event: { projectId: string; path: string }) => void>(),
}));

vi.mock("@/lib/tauri", () => ({
  collabDocOpen: mocks.collabDocOpen,
  collabDocChange: mocks.collabDocChange,
  collabDocClose: mocks.collabDocClose,
  collabLiveFlush: mocks.collabLiveFlush,
  collabPresenceSet: mocks.collabPresenceSet,
  collabPresenceLeave: mocks.collabPresenceLeave,
  collabShareInfo: vi.fn(),
  collabLiveStart: vi.fn(),
  collabLiveStop: vi.fn(),
  collabMembersList: vi.fn(),
  onCollabLiveStatus: vi.fn(),
  onCollabLiveRole: vi.fn(),
  onCollabLiveMerged: vi.fn(),
  onCollabLiveNewDevice: vi.fn(),
  onCollabPresence: vi.fn(),
  onCollabPresenceLeft: vi.fn(),
}));

vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ updateFile: mocks.indexUpdateFile }) },
}));

vi.mock("@oleafly/editor", () => ({
  getEditorView: () => mocks.view,
  getEditorDocumentPath: () => mocks.documentPath,
  subscribeEditorDocument: (listener: () => void) => {
    mocks.documentListeners.add(listener);
    return () => mocks.documentListeners.delete(listener);
  },
}));

vi.mock("./remote-cursors", () => ({
  remoteCursors: (source: RemoteCursorSource) => {
    mocks.cursorSource = source;
    return [];
  },
}));

vi.mock("@/components/editor/cm/collab-slot", () => ({
  setCollabEditorExtension: mocks.setCollabEditorExtension,
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({
    projectId: null as string | null,
    activePath: null as string | null,
    openTabs: [] as string[],
    files: {} as Record<string, { content: string; dirty: boolean }>,
    docVersion: 0,
    setContent: vi.fn((path: string, content: string) => {
      store.setState((state) => ({ files: { ...state.files, [path]: { content, dirty: true } } }));
      return true;
    }),
    bumpDocVersion: vi.fn(() => store.setState((state) => ({ docVersion: state.docVersion + 1 }))),
  }));
  return {
    useFilesStore: store,
    onPathsMoved: (listener: (event: { projectId: string; from: string; to: string }) => void) => {
      mocks.pathMoves.add(listener);
      return () => mocks.pathMoves.delete(listener);
    },
    onPathsDeleted: (listener: (event: { projectId: string; path: string }) => void) => {
      mocks.pathDeletes.add(listener);
      return () => mocks.pathDeletes.delete(listener);
    },
  };
});

import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { PRESENCE_INTERVAL_MS, PRESENCE_KEEP_ALIVE_MS } from "./presence";
import { type LivePeer, useCollabLiveStore } from "./live-store";
import { BACKGROUND_INDEX_MS, HAND_BACK_WAIT_MS, peerCursors, startLiveEditing } from "./live-editing";

const PROJECT = "project-1";
let channels: Map<string, (message: CollabDocMessage) => void>;
let release: (() => void) | null = null;

function start(role: "owner" | "editor" | "viewer" | "unknown" = "editor") {
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
  mocks.documentListeners.clear();
  mocks.cursorSource = null;
  mocks.setCollabEditorExtension.mockReturnValue(mocks.releaseExtension);
  mocks.collabDocOpen.mockImplementation(async (_projectId: string, path: string, onMessage) => {
    if (path === "excluded.log") return null;
    channels.set(`id-${path}`, onMessage);
    return { file_id: `id-${path}`, rev: 4, text: "shared", session: 1 };
  });
  mocks.collabDocChange.mockResolvedValue(undefined);
  mocks.collabDocClose.mockResolvedValue(undefined);
  mocks.collabLiveFlush.mockResolvedValue(undefined);
  mocks.collabPresenceSet.mockResolvedValue(undefined);
  mocks.collabPresenceLeave.mockResolvedValue(undefined);
  useSettingsStore.setState({ collabPresence: "cursor" });
  useFilesStore.setState({
    projectId: PROJECT,
    activePath: "main.tex",
    openTabs: ["main.tex"],
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

  it("keeps the same shared document open when its file is renamed, here or by someone else", async () => {
    start();
    const session = collabDocumentSession("main.tex");
    await settle();
    session?.applyLocal([{ from: 6, to: 6, insert: "!" }], session.version());
    for (const listener of mocks.pathMoves) listener({ projectId: PROJECT, from: "main.tex", to: "thesis.tex" });
    useFilesStore.setState((state) => ({
      activePath: "thesis.tex",
      files: { "thesis.tex": state.files["main.tex"] },
    }));
    expect(collabDocumentSession("thesis.tex")).toBe(session);
    session?.applyLocal([{ from: 7, to: 7, insert: "?" }], session.version());
    await settle();
    expect(mocks.collabDocOpen).toHaveBeenCalledTimes(1);
    expect(mocks.collabDocClose).not.toHaveBeenCalled();
    expect(useFilesStore.getState().files["thesis.tex"]?.content).toBe("shared!?");
    release?.();
    release = null;
    expect(mocks.pathMoves.size).toBe(0);
  });

  it("opens a fresh shared document for a path whose file was deleted", async () => {
    start();
    const session = collabDocumentSession("main.tex");
    await settle();
    for (const listener of mocks.pathDeletes) listener({ projectId: PROJECT, path: "main.tex" });
    await settle();
    expect(mocks.collabDocClose).toHaveBeenCalledWith(PROJECT, "id-main.tex", 1);
    expect(collabDocumentSession("main.tex")).not.toBe(session);
    release?.();
    release = null;
    expect(mocks.pathDeletes.size).toBe(0);
  });

  it("closes the shared document of a tab that closes, and only that one", async () => {
    useFilesStore.setState((state) => ({
      openTabs: ["main.tex", "intro.tex"],
      files: { ...state.files, "intro.tex": { content: "shared", dirty: false } },
    }));
    start();
    collabDocumentSession("main.tex");
    const intro = collabDocumentSession("intro.tex");
    await settle();
    useFilesStore.setState({ openTabs: ["main.tex"] });
    await settle();
    expect(mocks.collabDocClose).toHaveBeenCalledTimes(1);
    expect(mocks.collabDocClose).toHaveBeenCalledWith(PROJECT, "id-intro.tex", 1);
    expect(collabDocumentSession("intro.tex")).not.toBe(intro);
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

  it("flushes the live project before a compile and nothing else, waiting for figures", async () => {
    start();
    await collabCompileBarrier("other");
    expect(mocks.collabLiveFlush).not.toHaveBeenCalled();
    await collabCompileBarrier(PROJECT);
    expect(mocks.collabLiveFlush).toHaveBeenCalledExactlyOnceWith(PROJECT, { waitForFigures: true });
  });

  it("makes a role from a later server read-only, like a viewer", () => {
    start("unknown");
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    useCollabLiveStore.setState({ role: "editor" });
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    useCollabLiveStore.setState({ role: "unknown" });
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
  });

  it("makes viewers read-only and follows role changes", () => {
    start("viewer");
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    expect(collabVisualReadOnly(PROJECT)).toBe(true);
    useCollabLiveStore.setState({ role: "editor" });
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    expect(collabVisualReadOnly(PROJECT)).toBe(true);
  });

  it("shares this person's file and selection, throttled", async () => {
    mocks.view = { state: { selection: { main: { head: 4, anchor: 1 } } } };
    mocks.documentPath = "main.tex";
    start();
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenLastCalledWith(PROJECT, "main.tex", 4, 1);
    useFilesStore.setState({ activePath: "figure.png" });
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenLastCalledWith(PROJECT, "figure.png", null, null);
    expect(mocks.setCollabEditorExtension).toHaveBeenCalledOnce();
  });

  it("shares only the open file when this person chooses that", async () => {
    useSettingsStore.getState().setCollabPresence("file");
    mocks.view = { state: { selection: { main: { head: 4, anchor: 1 } } } };
    mocks.documentPath = "main.tex";
    start();
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenCalledExactlyOnceWith(PROJECT, "main.tex", null, null);
  });

  it("sends no presence at all while hidden and starts again when shown", async () => {
    useSettingsStore.getState().setCollabPresence("hidden");
    mocks.view = { state: { selection: { main: { head: 4, anchor: 1 } } } };
    mocks.documentPath = "main.tex";
    start();
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS * 2);
    await settle();
    expect(mocks.collabPresenceSet).not.toHaveBeenCalled();
    expect(mocks.collabPresenceLeave).not.toHaveBeenCalled();
    useSettingsStore.getState().setCollabPresence("cursor");
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenCalledExactlyOnceWith(PROJECT, "main.tex", 4, 1);
  });

  it("tells the others when this person hides mid-session, only after what is already on its way", async () => {
    let finish = () => {};
    mocks.collabPresenceSet.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.view = { state: { selection: { main: { head: 4, anchor: 1 } } } };
    mocks.documentPath = "main.tex";
    start();
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenCalledTimes(1);
    useSettingsStore.getState().setCollabPresence("hidden");
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    await settle();
    expect(mocks.collabPresenceLeave).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(mocks.collabPresenceLeave).toHaveBeenCalledExactlyOnceWith(PROJECT);
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS * 2);
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenCalledTimes(1);
    expect(mocks.collabPresenceLeave).toHaveBeenCalledTimes(1);
  });

  it("stops following the presence choice when live editing stops", async () => {
    start();
    await settle();
    release?.();
    release = null;
    useSettingsStore.getState().setCollabPresence("hidden");
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS);
    await settle();
    expect(mocks.collabPresenceLeave).not.toHaveBeenCalled();
  });

  it("closes everything and returns the editor to local files when it stops", async () => {
    start("viewer");
    collabDocumentSession("main.tex");
    await settle();
    const version = useFilesStore.getState().docVersion;
    release?.();
    release = null;
    expect(mocks.collabDocClose).toHaveBeenCalledWith(PROJECT, "id-main.tex", 1);
    expect(collabDocumentSession("main.tex")).toBeNull();
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    expect(collabVisualReadOnly(PROJECT)).toBe(false);
    expect(mocks.releaseExtension).toHaveBeenCalledOnce();
    expect(useFilesStore.getState().docVersion).toBe(version + 1);
  });
});

describe("live editing edges", () => {
  it("binds nothing for a file the files store has not loaded", async () => {
    start();
    expect(collabDocumentSession("missing.tex")).toBeNull();
    await settle();
    expect(mocks.collabDocOpen).not.toHaveBeenCalled();
  });

  it("hands typing done before the server said no back to the files store", async () => {
    start();
    useFilesStore.setState({ activePath: "main.tex" });
    const version = useFilesStore.getState().docVersion;
    const session = collabDocumentSession("excluded.log");
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    await settle();
    expect(useFilesStore.getState().setContent).toHaveBeenCalledWith("excluded.log", "log!", {
      unsaved: true,
      base: "log",
    });
    expect(useFilesStore.getState().docVersion).toBe(version);
  });

  it("hands back typing Rust hasn't confirmed before the files store leaves the project", async () => {
    start();
    const session = collabDocumentSession("main.tex");
    await settle();
    session?.applyLocal([{ from: 6, to: 6, insert: "!" }], session.version());
    session?.applyLocal([{ from: 7, to: 7, insert: "?" }], session.version());
    await collabHandBack("other");
    expect(useFilesStore.getState().setContent).not.toHaveBeenCalled();
    const handing = collabHandBack(PROJECT);
    await vi.advanceTimersByTimeAsync(HAND_BACK_WAIT_MS);
    await handing;
    expect(useFilesStore.getState().setContent).toHaveBeenCalledExactlyOnceWith("main.tex", "shared!?", {
      unsaved: true,
      base: "shared",
    });
  });

  it("keeps typing Rust never confirmed when live editing stops, to merge from the shared text", async () => {
    start();
    const session = collabDocumentSession("main.tex");
    await settle();
    channels.get("id-main.tex")?.({ kind: "remote", rev: 5, op: ["> ", 6], length: 8 });
    session?.applyLocal([{ from: 8, to: 8, insert: "!" }], session.version());
    expect(useFilesStore.getState().files["main.tex"]).toEqual({ content: "> shared!", dirty: false });
    release?.();
    release = null;
    expect(useFilesStore.getState().setContent).toHaveBeenCalledExactlyOnceWith("main.tex", "> shared!", {
      unsaved: true,
      base: "> shared",
    });
    expect(useFilesStore.getState().files["main.tex"]).toEqual({ content: "> shared!", dirty: true });
  });

  it("updates the index for a shared file in a background tab after a collaborator's edits, once per interval", async () => {
    useFilesStore.setState((state) => ({
      openTabs: ["main.tex", "refs.bib"],
      files: { ...state.files, "refs.bib": { content: "shared", dirty: false } },
    }));
    start();
    collabDocumentSession("refs.bib");
    await settle();
    channels.get("id-refs.bib")?.({ kind: "remote", rev: 5, op: [6, "@a"], length: 8 });
    channels.get("id-refs.bib")?.({ kind: "remote", rev: 6, op: [8, "@b"], length: 10 });
    expect(mocks.indexUpdateFile).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BACKGROUND_INDEX_MS);
    expect(mocks.indexUpdateFile).toHaveBeenCalledExactlyOnceWith("refs.bib", "shared@a@b");
    channels.get("id-refs.bib")?.({ kind: "remote", rev: 7, op: [10, "@c"], length: 12 });
    vi.advanceTimersByTime(BACKGROUND_INDEX_MS);
    expect(mocks.indexUpdateFile).toHaveBeenLastCalledWith("refs.bib", "shared@a@b@c");
  });

  it("leaves the active file's index to the index keeper, and stops with live editing", async () => {
    useFilesStore.setState((state) => ({
      openTabs: ["main.tex", "refs.bib"],
      files: { ...state.files, "refs.bib": { content: "shared", dirty: false } },
    }));
    start();
    collabDocumentSession("main.tex");
    collabDocumentSession("refs.bib");
    await settle();
    channels.get("id-main.tex")?.({ kind: "remote", rev: 5, op: ["> ", 6], length: 8 });
    channels.get("id-refs.bib")?.({ kind: "remote", rev: 5, op: [6, "@a"], length: 8 });
    release?.();
    release = null;
    vi.advanceTimersByTime(BACKGROUND_INDEX_MS);
    expect(mocks.indexUpdateFile).not.toHaveBeenCalled();
  });

  it("leaves the files store alone when the server says no after another project opened", async () => {
    start();
    useFilesStore.setState({ activePath: "excluded.log" });
    const session = collabDocumentSession("excluded.log");
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    useFilesStore.setState({ projectId: "other" });
    const version = useFilesStore.getState().docVersion;
    await settle();
    expect(useFilesStore.getState().setContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().docVersion).toBe(version);
  });

  it("ignores renames and deletes in other projects", async () => {
    start();
    const session = collabDocumentSession("main.tex");
    await settle();
    for (const listener of mocks.pathMoves) listener({ projectId: "other", from: "main.tex", to: "thesis.tex" });
    for (const listener of mocks.pathDeletes) listener({ projectId: "other", path: "main.tex" });
    await settle();
    expect(collabDocumentSession("main.tex")).toBe(session);
    expect(session?.path).toBe("main.tex");
    expect(mocks.collabDocClose).not.toHaveBeenCalled();
  });

  it("shares no file while the files store shows another project", async () => {
    mocks.view = { state: { selection: { main: { head: 4, anchor: 1 } } } };
    mocks.documentPath = "main.tex";
    start();
    await settle();
    useFilesStore.setState({ projectId: "other", activePath: "notes.tex" });
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenLastCalledWith(PROJECT, null, null, null);
  });

  it("does not share the cursor again for an unrelated setting", async () => {
    mocks.view = { state: { selection: { main: { head: 4, anchor: 1 } } } };
    mocks.documentPath = "main.tex";
    start();
    await settle();
    mocks.view = { state: { selection: { main: { head: 6, anchor: 6 } } } };
    const fontSize = useSettingsStore.getState().editorFontSize;
    useSettingsStore.setState({ editorFontSize: fontSize + 2 });
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    await settle();
    useSettingsStore.setState({ editorFontSize: fontSize });
    expect(mocks.collabPresenceSet).toHaveBeenCalledOnce();
    useSettingsStore.setState({ collabPresence: "file" });
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    await settle();
    expect(mocks.collabPresenceSet).toHaveBeenLastCalledWith(PROJECT, "main.tex", null, null);
  });
});

describe("remote cursor source", () => {
  function peer(deviceId: string, path: string | null, cursor: number | null): LivePeer {
    return { deviceId, accountId: deviceId, person: null, path, cursor, anchor: cursor, seenAt: Date.now(), hue: 30 };
  }

  function place(...peers: LivePeer[]) {
    useCollabLiveStore.setState({ peers: Object.fromEntries(peers.map((entry) => [entry.deviceId, entry])) });
  }

  it("wakes the editor only when someone in the open file moves or the file changes", () => {
    mocks.documentPath = "main.tex";
    place();
    start();
    const source = mocks.cursorSource;
    if (!source) throw new Error("no cursor source");
    const listener = vi.fn();
    const stop = source.subscribe(listener);
    listener.mockClear();
    place(peer("bob", "main.tex", 4));
    expect(listener).toHaveBeenCalledTimes(1);
    useCollabLiveStore.setState({ pending: 3 });
    place(peer("bob", "main.tex", 4));
    place(peer("bob", "main.tex", 4), peer("carol", "intro.tex", 1));
    place(peer("bob", "main.tex", 4), peer("carol", "intro.tex", 9));
    expect(listener).toHaveBeenCalledTimes(1);
    place(peer("bob", "main.tex", 5), peer("carol", "intro.tex", 9));
    expect(listener).toHaveBeenCalledTimes(2);
    place(peer("bob", "main.tex", 5), peer("carol", "main.tex", 9));
    expect(listener).toHaveBeenCalledTimes(3);
    expect(source.cursors()).toEqual([
      { id: "bob", name: null, hue: 30, head: 5, anchor: 5 },
      { id: "carol", name: null, hue: 30, head: 9, anchor: 9 },
    ]);
    mocks.documentPath = "intro.tex";
    for (const notify of mocks.documentListeners) notify();
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
    place(peer("bob", "intro.tex", 1));
    expect(listener).toHaveBeenCalledTimes(4);
    expect(mocks.documentListeners.size).toBe(0);
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
