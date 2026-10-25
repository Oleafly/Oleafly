// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafListProjects: vi.fn(),
  overleafSignIn: vi.fn(),
  overleafSignInWithAppCookies: vi.fn(),
  overleafSignOut: vi.fn(),
  overleafImportProjects: vi.fn(),
}));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { useOverleafImportStore } from "./overleaf-import";

const SERVER = "https://www.overleaf.com";
const expired = '@oleafly/error:{"code":"overleaf.session_expired","params":{}}';
const cancelled = '@oleafly/error:{"code":"overleaf.sign_in_cancelled","params":{}}';

function project(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Project ${id}`,
    ownerName: "Ada",
    owned: true,
    access: "owner",
    lastUpdated: "2026-10-01T10:00:00Z",
    lastUpdatedBy: null,
    archived: false,
    importedAs: null,
    ...extra,
  };
}

const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu" };
const signedOut = { server: SERVER, signedIn: false, email: null };

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  localStorage.clear();
  useOverleafImportStore.setState({
    server: SERVER,
    status: null,
    projects: [],
    phase: "idle",
    error: null,
    selected: [],
    progress: {},
    importing: false,
    run: null,
  });
});

describe("overleaf import store", () => {
  it("shows the sign-in step when there is no session", async () => {
    api.overleafStatus.mockResolvedValue(signedOut);
    await useOverleafImportStore.getState().open();
    expect(useOverleafImportStore.getState().phase).toBe("signed-out");
    expect(api.overleafListProjects).not.toHaveBeenCalled();
  });

  it("loads projects once signed in and keeps only selections that still exist", async () => {
    api.overleafStatus.mockResolvedValue(signedIn);
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [project("a"), project("b")] });
    useOverleafImportStore.setState({ selected: ["a", "gone"] });
    await useOverleafImportStore.getState().open();
    const state = useOverleafImportStore.getState();
    expect(state.phase).toBe("ready");
    expect(state.projects.map((item) => item.id)).toEqual(["a", "b"]);
    expect(state.selected).toEqual(["a"]);
  });

  it("drops back to sign-in when the session expired and remembers why", async () => {
    api.overleafListProjects.mockRejectedValue(expired);
    useOverleafImportStore.setState({ status: signedIn });
    await useOverleafImportStore.getState().load();
    const state = useOverleafImportStore.getState();
    expect(state.phase).toBe("signed-out");
    expect(state.error).toBe(expired);
    expect(state.status?.signedIn).toBe(false);
  });

  it("reports other load failures as errors", async () => {
    api.overleafListProjects.mockRejectedValue(new Error("offline"));
    await useOverleafImportStore.getState().load();
    expect(useOverleafImportStore.getState().phase).toBe("error");
    api.overleafStatus.mockRejectedValue(new Error("broken"));
    await useOverleafImportStore.getState().open();
    expect(useOverleafImportStore.getState().phase).toBe("error");
  });

  it("signs in, loads the list, and treats a closed window quietly", async () => {
    api.overleafSignIn.mockResolvedValueOnce(signedIn);
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [project("a")] });
    expect(await useOverleafImportStore.getState().signIn("Sign in to Overleaf")).toBe(true);
    expect(api.overleafSignIn).toHaveBeenCalledWith(SERVER, "Sign in to Overleaf");
    expect(useOverleafImportStore.getState().phase).toBe("ready");

    api.overleafSignIn.mockRejectedValueOnce(cancelled);
    expect(await useOverleafImportStore.getState().signIn("t")).toBe(false);
    expect(useOverleafImportStore.getState().phase).toBe("signed-out");
    expect(useOverleafImportStore.getState().error).toBeNull();

    api.overleafSignIn.mockRejectedValueOnce(new Error("blocked"));
    await useOverleafImportStore.getState().signIn("t");
    expect(useOverleafImportStore.getState().error).toEqual(new Error("blocked"));
  });

  it("signs in with copied browser cookies and loads the list", async () => {
    api.overleafSignInWithAppCookies.mockResolvedValue(signedIn);
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [project("a")] });
    await expect(useOverleafImportStore.getState().signInWithAppCookies()).resolves.toBe(true);
    expect(api.overleafSignInWithAppCookies).toHaveBeenCalledWith(SERVER);
    expect(useOverleafImportStore.getState()).toMatchObject({ phase: "ready", status: signedIn });

    const failed = '@oleafly/error:{"code":"overleaf.browser_sign_in_failed","params":{}}';
    api.overleafSignInWithAppCookies.mockRejectedValue(failed);
    await expect(useOverleafImportStore.getState().signInWithAppCookies()).resolves.toBe(false);
    expect(useOverleafImportStore.getState()).toMatchObject({ phase: "signed-out", error: failed });
  });

  it("ignores a second sign-in while one is running", async () => {
    useOverleafImportStore.setState({ phase: "signing-in" });
    expect(await useOverleafImportStore.getState().signIn("t")).toBe(false);
    expect(api.overleafSignIn).not.toHaveBeenCalled();
  });

  it("signs out and clears the list", async () => {
    api.overleafSignOut.mockResolvedValue(signedOut);
    useOverleafImportStore.setState({ projects: [project("a")], selected: ["a"], phase: "ready" });
    await useOverleafImportStore.getState().signOut();
    expect(useOverleafImportStore.getState()).toMatchObject({ projects: [], selected: [], phase: "signed-out" });
    api.overleafSignOut.mockRejectedValue(new Error("x"));
    await useOverleafImportStore.getState().signOut();
    expect(useOverleafImportStore.getState().error).toEqual(new Error("x"));
  });

  it("toggles and sets selections without duplicates", () => {
    useOverleafImportStore.setState({ projects: ["a", "b", "c", "d"].map((id) => project(id)) });
    const store = useOverleafImportStore.getState();
    store.toggle("a");
    store.toggle("b");
    store.toggle("a");
    expect(useOverleafImportStore.getState().selected).toEqual(["b"]);
    store.setSelected(["c", "c", "d"]);
    expect(useOverleafImportStore.getState().selected).toEqual(["c", "d"]);
  });

  it("never selects a project that is already in the library", () => {
    useOverleafImportStore.setState({ projects: [project("a"), { ...project("b"), importedAs: "local-b" }] });
    const store = useOverleafImportStore.getState();
    store.toggle("b");
    expect(useOverleafImportStore.getState().selected).toEqual([]);
    store.setSelected(["a", "b"]);
    expect(useOverleafImportStore.getState().selected).toEqual(["a"]);
  });

  it("starts a run in list order and finishes it only once importing stops", () => {
    useOverleafImportStore.setState({ projects: [project("a"), project("b"), project("c")], selected: ["c", "a"] });
    expect(useOverleafImportStore.getState().startRun()).toEqual(["a", "c"]);
    expect(useOverleafImportStore.getState().run).toEqual(["a", "c"]);
    useOverleafImportStore.setState({ importing: true });
    useOverleafImportStore.getState().finishRun();
    expect(useOverleafImportStore.getState().run).toEqual(["a", "c"]);
    useOverleafImportStore.setState({ importing: false, progress: { a: { phase: "done", projectId: "local-a" } } });
    useOverleafImportStore.getState().finishRun();
    expect(useOverleafImportStore.getState()).toMatchObject({ run: null, selected: [], progress: {} });
  });

  it("remembers a custom server and forgets the default", () => {
    useOverleafImportStore.getState().setServer("https://latex.uni.edu");
    expect(localStorage.getItem("oleafly.overleaf.server")).toBe("https://latex.uni.edu");
    expect(useOverleafImportStore.getState().phase).toBe("idle");
    useOverleafImportStore.getState().setServer("  ");
    expect(useOverleafImportStore.getState().server).toBe(SERVER);
    expect(localStorage.getItem("oleafly.overleaf.server")).toBeNull();
  });

  it("refreshes the status alone", async () => {
    api.overleafStatus.mockResolvedValue(signedIn);
    await useOverleafImportStore.getState().refreshStatus();
    expect(useOverleafImportStore.getState().status).toEqual(signedIn);
    api.overleafStatus.mockRejectedValue(new Error("x"));
    await useOverleafImportStore.getState().refreshStatus();
    expect(useOverleafImportStore.getState().status).toEqual(signedIn);
  });

  it("imports the selection, follows progress and marks finished projects", async () => {
    useOverleafImportStore.setState({ projects: [project("a"), project("b")], selected: ["a", "b"], phase: "ready" });
    const seen: unknown[] = [];
    api.overleafImportProjects.mockImplementation(async (_server: string, ids: string[], onEvent: (event: unknown) => void) => {
      expect(ids).toEqual(["a", "b"]);
      onEvent({ phase: "downloading", remoteId: "a", received: 5, total: 10 });
      seen.push(useOverleafImportStore.getState().progress.a);
      onEvent({ phase: "importing", remoteId: "a" });
      seen.push(useOverleafImportStore.getState().progress.a);
      onEvent({ phase: "done", remoteId: "a", projectId: "local-a", mainDoc: "main.tex", compiler: "pdflatex" });
      onEvent({ phase: "failed", remoteId: "b", error: "nope" });
      return [
        { remoteId: "a", projectId: "local-a", error: null },
        { remoteId: "b", projectId: null, error: "nope" },
      ];
    });
    const outcomes = await useOverleafImportStore.getState().importSelected();
    expect(outcomes).toHaveLength(2);
    expect(seen).toEqual([{ phase: "downloading", received: 5, total: 10 }, { phase: "importing" }]);
    const state = useOverleafImportStore.getState();
    expect(state.progress).toEqual({ a: { phase: "done", projectId: "local-a" }, b: { phase: "failed", error: "nope" } });
    expect(state.selected).toEqual(["b"]);
    expect(state.projects.find((item) => item.id === "a")?.importedAs).toBe("local-a");
    expect(state.importing).toBe(false);
  });

  it("returns to sign-in when an import finds the session expired", async () => {
    useOverleafImportStore.setState({ status: signedIn, selected: ["a"] });
    api.overleafImportProjects.mockResolvedValue([{ remoteId: "a", projectId: null, error: expired }]);
    await useOverleafImportStore.getState().importSelected();
    expect(useOverleafImportStore.getState().phase).toBe("signed-out");
    expect(useOverleafImportStore.getState().status?.signedIn).toBe(false);
  });

  it("marks every unfinished row failed when the import call throws", async () => {
    api.overleafImportProjects.mockImplementation(async (_server: string, _ids: string[], onEvent: (event: unknown) => void) => {
      onEvent({ phase: "done", remoteId: "a", projectId: "x", mainDoc: null, compiler: null });
      throw expired;
    });
    expect(await useOverleafImportStore.getState().importSelected(["a", "b"])).toEqual([]);
    const state = useOverleafImportStore.getState();
    expect(state.progress.a).toEqual({ phase: "done", projectId: "x" });
    expect(state.progress.b).toEqual({ phase: "failed", error: expired });
    expect(state.phase).toBe("signed-out");
  });

  it("does nothing without a selection or while an import runs", async () => {
    expect(await useOverleafImportStore.getState().importSelected()).toEqual([]);
    useOverleafImportStore.setState({ importing: true, selected: ["a"] });
    expect(await useOverleafImportStore.getState().importSelected()).toEqual([]);
    expect(api.overleafImportProjects).not.toHaveBeenCalled();
  });
});
