import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "64b7f0c2a1e4b5d6c7e8f901";
const SERVER = "https://www.overleaf.com";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafSignIn: vi.fn(),
  overleafListProjects: vi.fn(),
  overleafLiveProject: vi.fn(),
  resume: vi.fn(),
  collabShareInfo: vi.fn(),
  collabLiveReconnectNow: vi.fn(async () => {}),
  logError: vi.fn(async () => {}),
  logWarning: vi.fn(async () => {}),
}));
const state = vi.hoisted(() => ({
  settings: { overleafLive: true },
  overleaf: {
    server: "https://www.overleaf.com",
    openLive: vi.fn(),
    progress: {} as Record<string, unknown>,
  },
  files: {
    projectId: null as string | null,
    projectName: "",
    projects: [] as Array<{ id: string; name: string }>,
    openProject: vi.fn(),
    refreshProjects: vi.fn(async () => {}),
  },
  backend: { projectId: null as string | null, backend: null as string | null },
}));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  overleafStatus: api.overleafStatus,
  overleafSignIn: api.overleafSignIn,
  overleafListProjects: api.overleafListProjects,
}));
vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveProject: api.overleafLiveProject,
}));
vi.mock("@/lib/collab-live-bridge", () => ({
  overleafLiveActions: () => ({ resume: api.resume }),
  useLiveBackend: { getState: () => state.backend },
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabShareInfo: api.collabShareInfo,
  collabLiveReconnectNow: api.collabLiveReconnectNow,
}));
vi.mock("@/lib/log", () => ({ logError: api.logError, logWarning: api.logWarning }));
vi.mock("@/features/collab/live/live-store", async () => {
  const { create } = await import("zustand");
  return {
    useCollabLiveStore: create(() => ({
      projectId: null as string | null,
      backend: null as string | null,
      share: null as { serverId: string } | null,
      status: null as { state: string; reason?: string } | null,
      role: null as string | null,
      refused: null as string | null,
      refusedParams: {} as Record<string, string>,
      goLiveAgain: vi.fn(),
    })),
  };
});
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => state.settings } }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => state.files } }));
vi.mock("@/store/overleaf-import", () => ({
  useOverleafImportStore: { getState: () => state.overleaf, setState: vi.fn() },
}));

import { useCollabLiveStore } from "@/features/collab/live/live-store";
import { findLive, LIVE_WAIT_MS, openLive } from "./overleaf-ai-host";

type LiveState = Partial<ReturnType<typeof useCollabLiveStore.getState>>;

const live = (next: LiveState) => useCollabLiveStore.setState(next as never);

function listed(importedAs: string | null) {
  api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
  api.overleafListProjects.mockResolvedValue({
    status: { server: SERVER, signedIn: true, email: "ada@uni.edu" },
    projects: [{ id: ID, name: "Thesis", ownerName: "Ada", owned: true, lastUpdated: null, archived: false, importedAs }],
  });
}

function opensAs(status: LiveState["status"], extra: LiveState = {}) {
  state.files.openProject.mockImplementation(async (id: string) => {
    state.files.projectId = id;
    live({ projectId: id, backend: "overleaf", status, ...extra });
  });
}

const target = (importedAs: string | null) => ({ remoteId: ID, name: "Thesis", importedAs, stops: null });

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  state.settings.overleafLive = true;
  state.overleaf.openLive.mockReset();
  state.overleaf.progress = {};
  state.files.projectId = "other";
  state.files.projectName = "Other";
  state.files.projects = [];
  state.files.openProject.mockReset();
  state.backend = { projectId: null, backend: null };
  live({
    projectId: null,
    backend: null,
    share: null,
    status: null,
    role: null,
    refused: null,
    refusedParams: {},
    goLiveAgain: vi.fn(),
  });
  api.overleafLiveProject.mockResolvedValue({ server: SERVER, remoteId: ID, signedIn: true, paused: false });
  api.collabShareInfo.mockResolvedValue(null);
  api.collabLiveReconnectNow.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("finding the project to open live", () => {
  it("reads a project address on the signed-in server and names the live project that stops", async () => {
    listed("local-a");
    state.backend = { projectId: "other", backend: "server" };
    expect(await findLive(`https://overleaf.com/project/${ID}?x=1`)).toEqual({ ...target("local-a"), stops: "Other" });
    state.backend = { projectId: "local-a", backend: "overleaf" };
    expect(await findLive(ID)).toEqual(target("local-a"));
  });

  it("refuses share links, other servers and unknown ids, and logs each refusal", async () => {
    listed(null);
    expect(await findLive("https://www.overleaf.com/read/abcdefghijkl")).toEqual({ refused: "share_link" });
    expect(await findLive(`https://latex.oleafly.edu/project/${ID}`)).toEqual({
      refused: "other_server",
      detail: "latex.oleafly.edu",
    });
    expect(api.overleafListProjects).not.toHaveBeenCalled();
    expect(await findLive("5f0000000000000000000000")).toEqual({ refused: "not_found", detail: "5f0000000000000000000000" });
    expect(api.logWarning).toHaveBeenCalledWith("overleaf ai open live", "share_link");
  });

  it("refuses a copy that is shared on an Oleafly server before asking anything", async () => {
    listed("local-a");
    api.collabShareInfo.mockResolvedValue({ serverId: "srv" });
    expect(await findLive(ID)).toEqual({ refused: "shared_on_server" });
    expect(api.collabShareInfo).toHaveBeenCalledWith("local-a");

    api.collabShareInfo.mockRejectedValue(new Error("manifest unreadable"));
    expect(await findLive(ID)).toEqual(target("local-a"));
    expect(api.logError).toHaveBeenCalledWith("overleaf ai share check", expect.any(Error));
  });

  it("points to the switch and reaches nothing while live editing with Overleaf is off", async () => {
    state.settings.overleafLive = false;
    expect(await findLive(ID)).toEqual({ refused: "switch_off" });
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "switch_off" });
    expect(api.overleafStatus).not.toHaveBeenCalled();
    expect(api.overleafLiveProject).not.toHaveBeenCalled();
  });
});

describe("opening a project live", () => {
  it("opens an imported copy and waits until it is online", async () => {
    state.files.openProject.mockImplementation(async (id: string) => {
      state.files.projectId = id;
      live({ projectId: id, backend: "overleaf", status: { state: "connecting" } });
    });
    const shouldContinue = () => true;
    const pending = openLive(target("local-a"), shouldContinue);
    await vi.waitFor(() => expect(state.files.openProject).toHaveBeenCalledWith("local-a", shouldContinue));
    live({ status: { state: "online" }, role: "editor" });
    expect(await pending).toEqual({ projectId: "local-a", status: "online", role: "editor" });
    expect(api.resume).not.toHaveBeenCalled();
  });

  it("resumes a paused copy before opening it", async () => {
    api.overleafLiveProject.mockResolvedValue({ server: SERVER, remoteId: ID, signedIn: true, paused: true });
    api.resume.mockResolvedValue(undefined);
    opensAs({ state: "online" }, { role: "owner" });
    expect(await openLive(target("local-a"), () => true)).toEqual({ projectId: "local-a", status: "online", role: "owner" });
    expect(api.resume).toHaveBeenCalledWith("local-a");
    expect(api.resume.mock.invocationCallOrder[0]).toBeLessThan(state.files.openProject.mock.invocationCallOrder[0]);
  });

  it("names who holds the project when it is live somewhere else", async () => {
    api.overleafLiveProject.mockResolvedValue({ server: SERVER, remoteId: ID, signedIn: true, paused: true });
    api.resume.mockRejectedValue({
      code: "live_elsewhere",
      message: "this project is live on the command line (process 41)",
      params: { by: "cli", pid: "41" },
    });
    expect(await openLive(target("local-a"), () => true)).toEqual({
      refused: "live_elsewhere",
      detail: "the command line, process 41",
    });
    expect(state.files.openProject).not.toHaveBeenCalled();
    expect(api.logWarning).toHaveBeenCalledWith("overleaf ai open live", "live_elsewhere: the command line, process 41");

    api.overleafLiveProject.mockResolvedValue({ server: SERVER, remoteId: ID, signedIn: true, paused: false });
    opensAs({ state: "ended", reason: "failed" }, { refused: "live_elsewhere", refusedParams: { by: "app", pid: "7" } });
    expect(await openLive(target("local-a"), () => true)).toEqual({
      refused: "live_elsewhere",
      detail: "another Oleafly window",
    });

    live({ refusedParams: { by: "cli", pid: "41" } });
    expect(await openLive(target("local-a"), () => true)).toEqual({
      refused: "live_elsewhere",
      detail: "the command line, process 41",
    });

    live({ refusedParams: {} });
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "live_elsewhere" });
  });

  it("says why a session ended before it connected", async () => {
    opensAs({ state: "ended", reason: "access_ended" });
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "ended", detail: "access_ended" });
  });

  it("imports a project with no copy, then opens it", async () => {
    state.overleaf.openLive.mockResolvedValue("local-b");
    opensAs({ state: "online" }, { role: "reviewer" });
    expect(await openLive(target(null), () => true)).toEqual({ projectId: "local-b", status: "online", role: "reviewer" });
    expect(state.overleaf.openLive).toHaveBeenCalledWith(ID);
    expect(api.overleafLiveProject).toHaveBeenCalledWith("local-b");
  });

  it("passes on an import that failed, logs it, and says when another import is busy", async () => {
    state.overleaf.openLive.mockResolvedValue(null);
    state.overleaf.progress = {
      [ID]: { phase: "failed", error: '@oleafly/error:{"code":"overleaf.project_unavailable","params":{}}', opening: true },
    };
    await expect(openLive(target(null), () => true)).rejects.toThrow(Error);
    expect(api.logError).toHaveBeenCalledWith("overleaf ai open live", expect.any(Error));
    expect(state.files.openProject).not.toHaveBeenCalled();

    state.overleaf.progress = {};
    expect(await openLive(target(null), () => true)).toEqual({ refused: "busy" });
  });

  it("tries again in the open project instead of opening it twice", async () => {
    state.files.projectId = "local-a";
    const goLiveAgain = vi.fn(() =>
      live({ projectId: "local-a", backend: "overleaf", status: { state: "online" }, role: "owner" }),
    );
    live({ projectId: "local-a", status: { state: "ended", reason: "failed" }, goLiveAgain });
    expect(await openLive(target("local-a"), () => true)).toEqual({ projectId: "local-a", status: "online", role: "owner" });
    expect(goLiveAgain).toHaveBeenCalledOnce();
    expect(state.files.openProject).not.toHaveBeenCalled();
    expect(api.collabLiveReconnectNow).not.toHaveBeenCalled();
  });

  it("wakes a resting session in the open project and waits for it", async () => {
    state.files.projectId = "local-a";
    live({ projectId: "local-a", backend: "overleaf", status: { state: "idle" } });
    api.collabLiveReconnectNow.mockImplementation(async () => {
      live({ status: { state: "online" }, role: "editor" });
    });
    expect(await openLive(target("local-a"), () => true)).toEqual({ projectId: "local-a", status: "online", role: "editor" });
    expect(api.collabLiveReconnectNow).toHaveBeenCalledOnce();
  });

  it("does not report Overleaf live editing when the project goes live on an Oleafly server", async () => {
    opensAs({ state: "online" }, { backend: "server", role: "editor" });
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "shared_on_server" });
    expect(api.logWarning).toHaveBeenCalledWith("overleaf ai open live", "shared_on_server");
  });

  it("refuses when another project opens first and when the copy is no longer linked", async () => {
    state.files.openProject.mockImplementation(async () => {
      state.files.projectId = "elsewhere";
    });
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "project_changed" });
    api.overleafLiveProject.mockResolvedValue(null);
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "not_linked" });
  });

  it("says the project did not open when the open fails or is cancelled, not that another one opened", async () => {
    state.files.openProject.mockImplementation(async () => {});
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "not_opened" });
    state.files.openProject.mockImplementation(async () => {
      state.files.projectId = null;
    });
    expect(await openLive(target("local-a"), () => true)).toEqual({ refused: "not_opened" });
    state.files.projectId = "other";
    state.files.openProject.mockImplementation(async () => {});
    expect(await openLive(target("local-a"), () => false)).toEqual({ refused: "cancelled" });
    expect(api.logWarning).toHaveBeenCalledWith("overleaf ai open live", "not_opened");
  });

  it("stops waiting after 20 seconds and reports the state it reached", async () => {
    vi.useFakeTimers();
    opensAs({ state: "connecting" });
    const pending = openLive(target("local-a"), () => true);
    for (let turn = 0; turn < 50 && state.files.openProject.mock.calls.length === 0; turn += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LIVE_WAIT_MS - 1);
    live({ status: { state: "offline", retry_in_ms: 1_000 } });
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ projectId: "local-a", status: "offline", role: null });
  });
});
