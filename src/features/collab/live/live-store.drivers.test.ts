import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabLiveInfo } from "@/lib/tauri";
import type { CollabLiveStoreState, LiveBackendDriver } from "./live-store";

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, ((payload: unknown) => void) | undefined>,
  logError: vi.fn(),
}));

function listener(name: string) {
  return vi.fn(async (handler: (payload: unknown) => void) => {
    mocks.handlers[name] = handler;
    return () => {
      if (mocks.handlers[name] === handler) mocks.handlers[name] = undefined;
    };
  });
}

vi.mock("@/lib/tauri", () => ({}));
vi.mock("@/lib/tauri-collab", () => ({
  collabShareInfo: vi.fn(async () => null),
  collabLiveStart: vi.fn(),
  collabLiveStop: vi.fn(),
  collabLiveFlush: vi.fn(async () => undefined),
  collabMembersList: vi.fn(async () => []),
  collabServersList: vi.fn(async () => []),
  onCollabServerChanged: listener("serverChanged"),
  onCollabLiveStatus: listener("status"),
  onCollabLiveRole: listener("role"),
  onCollabLiveMerged: listener("merged"),
  onCollabLiveNewDevice: listener("newDevice"),
  onCollabLiveMembers: listener("members"),
  onCollabPresence: listener("presence"),
  onCollabPresenceLeft: listener("left"),
  onCollabCommentsNotSent: listener("notSent"),
  onCollabLiveUnwritten: listener("unwritten"),
  onCollabLiveProjectFull: listener("projectFull"),
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: null as string | null,
      activePath: null as string | null,
      files: {} as Record<string, { content: string; dirty: boolean }>,
      docVersion: 0,
      saveAllDirty: vi.fn(async () => {}),
      setContent: vi.fn(() => true),
      bumpDocVersion: vi.fn(),
    })),
  };
});

import { liveOnOverleaf } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { startCollabLive, useCollabLiveStore } from "./live-store";

const ON_SERVER = "project-on-server";
const ON_OVERLEAF = "project-on-overleaf";

function driverFor(kind: LiveBackendDriver["kind"], project: string, calls: string[]): LiveBackendDriver {
  return {
    kind,
    wants: (state: CollabLiveStoreState) => state.projectId === project,
    start: vi.fn(async (projectId: string): Promise<CollabLiveInfo> => {
      calls.push(`${kind} start ${projectId}`);
      return { role: "editor", account_id: `${kind}-account`, device_id: `${kind}-device` };
    }),
    stop: vi.fn(async (projectId: string) => {
      calls.push(`${kind} stop ${projectId}`);
    }),
    refresh: vi.fn(async () => {}),
    resumable: () => false,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function openProject(projectId: string | null): void {
  useFilesStore.setState({ projectId, activePath: null, files: {} });
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers = {};
  openProject(null);
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe("live backend drivers", () => {
  it("a project goes live through the driver that wants it", async () => {
    const calls: string[] = [];
    const server = driverFor("server", ON_SERVER, calls);
    const overleaf = driverFor("overleaf", ON_OVERLEAF, calls);
    openProject(ON_OVERLEAF);
    stop = startCollabLive({ drivers: [server, overleaf] });
    await settle();
    expect(server.refresh).toHaveBeenCalledWith(ON_OVERLEAF);
    expect(overleaf.refresh).toHaveBeenCalledWith(ON_OVERLEAF);
    expect(calls).toEqual([`overleaf start ${ON_OVERLEAF}`]);
    expect(server.start).not.toHaveBeenCalled();
    expect(useCollabLiveStore.getState()).toMatchObject({
      projectId: ON_OVERLEAF,
      backend: "overleaf",
      role: "editor",
    });
    expect(liveOnOverleaf(ON_OVERLEAF)).toBe(true);
    expect(liveOnOverleaf(ON_SERVER)).toBe(false);
  });

  it("tells the rest of the app a project is live on Overleaf only while it is", async () => {
    const calls: string[] = [];
    const server = driverFor("server", ON_SERVER, calls);
    const overleaf = driverFor("overleaf", ON_OVERLEAF, calls);
    openProject(ON_OVERLEAF);
    stop = startCollabLive({ drivers: [server, overleaf] });
    await settle();
    expect(liveOnOverleaf(ON_OVERLEAF)).toBe(true);
    mocks.handlers.status?.({ projectId: ON_OVERLEAF, status: { state: "ended", reason: "stopped" }, pending: 0 });
    expect(liveOnOverleaf(ON_OVERLEAF)).toBe(false);
    openProject(ON_SERVER);
    await settle();
    expect(liveOnOverleaf(ON_OVERLEAF)).toBe(false);
    stop();
    stop = null;
    expect(liveOnOverleaf(ON_SERVER)).toBe(false);
  });

  it("switching projects stops the previous driver first", async () => {
    const calls: string[] = [];
    const server = driverFor("server", ON_SERVER, calls);
    const overleaf = driverFor("overleaf", ON_OVERLEAF, calls);
    openProject(ON_SERVER);
    stop = startCollabLive({ drivers: [server, overleaf] });
    await settle();
    expect(useCollabLiveStore.getState().backend).toBe("server");
    openProject(ON_OVERLEAF);
    await settle();
    expect(calls).toEqual([`server start ${ON_SERVER}`, `server stop ${ON_SERVER}`, `overleaf start ${ON_OVERLEAF}`]);
    expect(useCollabLiveStore.getState()).toMatchObject({ projectId: ON_OVERLEAF, backend: "overleaf" });
  });
});
