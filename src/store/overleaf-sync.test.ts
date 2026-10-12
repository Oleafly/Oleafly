import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafSyncStatus: vi.fn(),
  overleafSyncLink: vi.fn(),
  overleafSyncNow: vi.fn(),
  overleafSyncCheck: vi.fn(),
  overleafSyncUnlink: vi.fn(),
  overleafSyncSetAuto: vi.fn(),
  overleafGitTokenSet: vi.fn(),
}));
const files = vi.hoisted(() => {
  const state = {
    projectId: "p1" as string | null,
    prepareExternalMutation: vi.fn(async () => 7),
    applyProjectStateChanged: vi.fn(async () => true),
  };
  return {
    state,
    lease: vi.fn(async (_projectId: string, run: () => Promise<unknown>) => run()),
  };
});

vi.mock("@/lib/overleaf-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-sync")>()),
  ...api,
}));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => files.state },
  runWithEditorMutationLease: files.lease,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { useOverleafSyncStore } from "./overleaf-sync";

const SERVER = "https://www.overleaf.com";
const projectState = { projectId: "p1", revision: 2 };
const busy = '@oleafly/error:{"code":"overleaf.sync_busy","params":{}}';

function status(extra: Record<string, unknown> = {}) {
  return {
    linked: false,
    server: SERVER,
    remoteId: null,
    auto: false,
    lastSyncAt: null,
    tokenSaved: true,
    importedFrom: { server: SERVER, projectId: "ov1" },
    ...extra,
  };
}

function report(outcome: string, extra: Record<string, unknown> = {}) {
  return { outcome, files: [], pulled: 0, pushed: false, state: projectState, ...extra };
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  files.state.projectId = "p1";
  files.state.prepareExternalMutation.mockClear();
  files.state.applyProjectStateChanged.mockClear();
  files.lease.mockClear();
  useOverleafSyncStore.setState({
    projectId: "p1",
    status: status(),
    phase: "idle",
    conflicts: [],
    resolutions: {},
    choice: [],
    error: null,
    lastReport: null,
  });
  api.overleafSyncCheck.mockResolvedValue(report("needs-merge", { state: null }));
});

describe("overleaf sync store", () => {
  it("refreshes the status and resets when the project changes", async () => {
    useOverleafSyncStore.setState({ conflicts: ["a.tex"] });
    api.overleafSyncStatus.mockResolvedValue(status({ linked: true }));
    await useOverleafSyncStore.getState().refresh("p2");
    expect(useOverleafSyncStore.getState()).toMatchObject({ projectId: "p2", conflicts: [], status: { linked: true } });
    api.overleafSyncStatus.mockRejectedValue(new Error("x"));
    await useOverleafSyncStore.getState().refresh("p2");
    expect(useOverleafSyncStore.getState().status?.linked).toBe(true);
  });

  it("links through the editor lease, applies the new state and syncs once linked", async () => {
    api.overleafSyncLink.mockResolvedValue(report("linked", { files: ["extra.tex"] }));
    api.overleafSyncStatus.mockResolvedValue(status({ linked: true, remoteId: "ov1", auto: true }));
    api.overleafSyncNow.mockResolvedValue(report("synced", { pushed: true }));
    const result = await useOverleafSyncStore.getState().link();
    expect(result?.outcome).toBe("linked");
    expect(files.lease).toHaveBeenCalled();
    expect(api.overleafSyncLink).toHaveBeenCalledWith("p1", 7, SERVER, "ov1", null);
    expect(files.state.applyProjectStateChanged).toHaveBeenCalledWith(projectState);
    expect(api.overleafSyncNow).toHaveBeenCalledWith("p1", 7, null, true);
    expect(useOverleafSyncStore.getState().phase).toBe("idle");
  });

  it("asks which version wins and links with the chosen side", async () => {
    api.overleafSyncLink.mockResolvedValueOnce(report("needs-choice", { files: ["main.tex"] }));
    api.overleafSyncStatus.mockResolvedValue(status());
    await useOverleafSyncStore.getState().link();
    expect(useOverleafSyncStore.getState().choice).toEqual(["main.tex"]);
    expect(api.overleafSyncNow).not.toHaveBeenCalled();
    useOverleafSyncStore.getState().dismissChoice();
    expect(useOverleafSyncStore.getState().choice).toEqual([]);
    api.overleafSyncLink.mockResolvedValueOnce(report("linked"));
    api.overleafSyncNow.mockResolvedValue(report("up-to-date"));
    await useOverleafSyncStore.getState().link("local");
    expect(api.overleafSyncLink).toHaveBeenLastCalledWith("p1", 7, SERVER, "ov1", "local");
  });

  it("records clashes and resolves them with the picks", async () => {
    useOverleafSyncStore.setState({ status: status({ linked: true, remoteId: "ov1" }) });
    api.overleafSyncStatus.mockResolvedValue(status({ linked: true, remoteId: "ov1" }));
    api.overleafSyncNow.mockResolvedValueOnce(report("conflicts", { files: ["a.tex", "b.tex"] }));
    await useOverleafSyncStore.getState().sync();
    expect(useOverleafSyncStore.getState().conflicts).toEqual(["a.tex", "b.tex"]);
    api.overleafSyncNow.mockResolvedValueOnce(report("synced"));
    await useOverleafSyncStore.getState().sync({ "a.tex": "local", "b.tex": "remote" });
    expect(api.overleafSyncNow).toHaveBeenLastCalledWith("p1", 7, { "a.tex": "local", "b.tex": "remote" }, false);
    expect(useOverleafSyncStore.getState().conflicts).toEqual([]);
  });

  it("keeps quiet about a busy sync or a project switch, and reports other failures", async () => {
    useOverleafSyncStore.setState({ status: status({ linked: true, remoteId: "ov1" }) });
    api.overleafSyncNow.mockRejectedValueOnce(busy);
    await useOverleafSyncStore.getState().sync(null, "auto");
    expect(useOverleafSyncStore.getState().error).toBeNull();
    files.state.projectId = "other";
    expect(await useOverleafSyncStore.getState().sync()).toBeNull();
    expect(useOverleafSyncStore.getState().error).toBeNull();
    files.state.projectId = "p1";
    api.overleafSyncNow.mockRejectedValueOnce(new Error("offline"));
    await useOverleafSyncStore.getState().sync();
    expect(useOverleafSyncStore.getState().error).toEqual(new Error("offline"));
    api.overleafSyncLink.mockRejectedValueOnce(new Error("no git"));
    useOverleafSyncStore.setState({ status: status() });
    await useOverleafSyncStore.getState().link();
    expect(useOverleafSyncStore.getState().error).toEqual(new Error("no git"));
  });

  it("does nothing when unlinked, busy or missing an id", async () => {
    expect(await useOverleafSyncStore.getState().sync()).toBeNull();
    useOverleafSyncStore.setState({ phase: "syncing", status: status({ linked: true }) });
    expect(await useOverleafSyncStore.getState().sync()).toBeNull();
    useOverleafSyncStore.setState({ phase: "idle", status: status({ importedFrom: null }) });
    expect(await useOverleafSyncStore.getState().link()).toBeNull();
    expect(api.overleafSyncNow).not.toHaveBeenCalled();
    expect(api.overleafSyncLink).not.toHaveBeenCalled();
  });

  it("saves the token, toggles auto sync and unlinks", async () => {
    useOverleafSyncStore.setState({ status: status({ tokenSaved: false }) });
    api.overleafGitTokenSet.mockResolvedValueOnce(undefined);
    expect(await useOverleafSyncStore.getState().saveToken("olp_token")).toBe(true);
    expect(useOverleafSyncStore.getState().status?.tokenSaved).toBe(true);
    api.overleafGitTokenSet.mockRejectedValueOnce(new Error("bad"));
    expect(await useOverleafSyncStore.getState().saveToken("x")).toBe(false);
    expect(useOverleafSyncStore.getState().error).toEqual(new Error("bad"));

    api.overleafSyncSetAuto.mockResolvedValue(status({ linked: true, auto: false }));
    await useOverleafSyncStore.getState().setAuto(false);
    expect(api.overleafSyncSetAuto).toHaveBeenCalledWith("p1", false);
    api.overleafSyncSetAuto.mockRejectedValueOnce(new Error("io"));
    await useOverleafSyncStore.getState().setAuto(true);
    expect(useOverleafSyncStore.getState().error).toEqual(new Error("io"));

    api.overleafSyncUnlink.mockResolvedValue(status());
    useOverleafSyncStore.setState({ conflicts: ["a.tex"] });
    await useOverleafSyncStore.getState().unlink();
    expect(useOverleafSyncStore.getState()).toMatchObject({ conflicts: [], error: null, status: { linked: false } });
    api.overleafSyncUnlink.mockRejectedValueOnce(new Error("locked"));
    await useOverleafSyncStore.getState().unlink();
    expect(useOverleafSyncStore.getState().error).toEqual(new Error("locked"));
  });

  it("finishes a quiet sync without the editor lease", async () => {
    useOverleafSyncStore.setState({ status: status({ linked: true, remoteId: "ov1" }) });
    api.overleafSyncStatus.mockResolvedValue(status({ linked: true, remoteId: "ov1" }));
    api.overleafSyncCheck.mockResolvedValueOnce(report("synced", { pushed: true, state: null }));
    const result = await useOverleafSyncStore.getState().sync(null, "auto");
    expect(result?.outcome).toBe("synced");
    expect(api.overleafSyncNow).not.toHaveBeenCalled();
    expect(files.lease).not.toHaveBeenCalled();
    expect(useOverleafSyncStore.getState()).toMatchObject({ phase: "idle", lastReport: { outcome: "synced" } });
  });

  it("carries earlier picks into the next round of clashes", async () => {
    useOverleafSyncStore.setState({ status: status({ linked: true, remoteId: "ov1" }) });
    api.overleafSyncStatus.mockResolvedValue(status({ linked: true, remoteId: "ov1" }));
    api.overleafSyncNow.mockResolvedValueOnce(report("conflicts", { files: ["b.tex"] }));
    await useOverleafSyncStore.getState().sync({ "a.tex": "local" });
    expect(useOverleafSyncStore.getState()).toMatchObject({ conflicts: ["b.tex"], resolutions: { "a.tex": "local" } });
    api.overleafSyncNow.mockResolvedValueOnce(report("conflicts", { files: ["b.tex"] }));
    await useOverleafSyncStore.getState().sync(null, "auto");
    expect(useOverleafSyncStore.getState().resolutions).toEqual({ "a.tex": "local" });
    api.overleafSyncNow.mockResolvedValueOnce(report("synced"));
    await useOverleafSyncStore.getState().sync({ "b.tex": "remote" });
    expect(api.overleafSyncNow).toHaveBeenLastCalledWith("p1", 7, { "a.tex": "local", "b.tex": "remote" }, false);
    expect(useOverleafSyncStore.getState()).toMatchObject({ conflicts: [], resolutions: {} });
  });

  it("leaves another project's state alone when it finishes after a switch", async () => {
    useOverleafSyncStore.setState({ status: status({ linked: true, remoteId: "ov1" }) });
    let finish: (value: unknown) => void = () => {};
    api.overleafSyncCheck.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const running = useOverleafSyncStore.getState().sync();
    api.overleafSyncStatus.mockResolvedValue(status({ linked: true, remoteId: "ov2" }));
    await useOverleafSyncStore.getState().refresh("p2");
    finish(report("conflicts", { files: ["a.tex"], state: null }));
    await running;
    expect(useOverleafSyncStore.getState()).toMatchObject({ projectId: "p2", conflicts: [], lastReport: null });
    expect(api.overleafSyncStatus).not.toHaveBeenCalledWith("p1");

    let fail: (reason: unknown) => void = () => {};
    useOverleafSyncStore.setState({ projectId: "p1", status: status() });
    api.overleafSyncLink.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    const linking = useOverleafSyncStore.getState().link();
    await useOverleafSyncStore.getState().refresh("p3");
    fail(new Error("late"));
    await linking;
    expect(useOverleafSyncStore.getState()).toMatchObject({ projectId: "p3", error: null });
  });
});
