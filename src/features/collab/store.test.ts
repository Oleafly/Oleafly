import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabServer } from "@/lib/tauri";
import { account, collabError, deferred, server, SERVER_ID, signedOutServer } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServersList: vi.fn(),
  collabServerSignIn: vi.fn(),
  collabServerCodeSignIn: vi.fn(),
  collabServerSignOut: vi.fn(),
  collabServerRemove: vi.fn(),
  collabServerRefresh: vi.fn(),
  onCollabServerChanged: vi.fn(),
}));

const copies = vi.hoisted(() => ({ followLocalCopies: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

vi.mock("./live/removed-notices", () => copies);

const DONE = { signed_out: true, unsent: [], detached: [] };
const PAPER = { project_id: "r3-paper", name: "R3 Paper", changes: 4 };

import { useCollabStore, watchServers } from "./store";

beforeEach(() => {
  vi.clearAllMocks();
  copies.followLocalCopies.mockResolvedValue(undefined);
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {}, unsent: {}, detached: [] });
});

describe("watching for server changes", () => {
  it("reloads a list that was loaded whenever a server changes, with one listener for every watcher", async () => {
    let changed: () => void = () => undefined;
    const unlisten = vi.fn();
    mocks.onCollabServerChanged.mockImplementation(async (handler: () => void) => {
      changed = handler;
      return unlisten;
    });
    const first = watchServers();
    const second = watchServers();
    expect(mocks.onCollabServerChanged).toHaveBeenCalledTimes(1);
    changed();
    expect(mocks.collabServersList).not.toHaveBeenCalled();
    useCollabStore.setState({ servers: [server()], status: "ready" });
    mocks.collabServersList.mockResolvedValue([signedOutServer()]);
    changed();
    await vi.waitFor(() => expect(useCollabStore.getState().servers[0]?.signed_in).toBe(false));
    first();
    first();
    expect(unlisten).not.toHaveBeenCalled();
    second();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("lets go of a listener that starts after the last watcher left", async () => {
    let started: (unlisten: () => void) => void = () => undefined;
    mocks.onCollabServerChanged.mockReturnValue(new Promise((resolve) => (started = resolve)));
    const stop = watchServers();
    stop();
    const unlisten = vi.fn();
    started(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});

describe("collab store", () => {
  it("loads the servers this computer knows", async () => {
    mocks.collabServersList.mockResolvedValue([server()]);
    await useCollabStore.getState().load();
    expect(useCollabStore.getState()).toMatchObject({ servers: [server()], status: "ready", loadError: null });
  });

  it("keeps only the newest of two overlapping loads", async () => {
    const first = deferred<CollabServer[]>();
    mocks.collabServersList
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([server({ name: "New name" })]);
    const stale = useCollabStore.getState().load();
    await useCollabStore.getState().load();
    first.resolve([server({ name: "Old name" })]);
    await stale;
    expect(useCollabStore.getState().servers.map((entry) => entry.name)).toEqual(["New name"]);
  });

  it("records why a load failed", async () => {
    mocks.collabServersList.mockRejectedValue(collabError("unreachable"));
    await useCollabStore.getState().load();
    expect(useCollabStore.getState()).toMatchObject({ status: "failed", loadError: "unreachable" });
  });

  it("adds a newly signed-in server and replaces one it already lists", async () => {
    useCollabStore.setState({ servers: [signedOutServer()], status: "ready" });
    mocks.collabServerSignIn.mockResolvedValueOnce(server());
    await useCollabStore.getState().signIn("https://collab.uni.edu", "github", "CODE");
    expect(mocks.collabServerSignIn).toHaveBeenCalledWith("https://collab.uni.edu", "github", "CODE");
    expect(useCollabStore.getState().servers).toEqual([server()]);

    const other = server({ server_id: "0192a0b0-0000-7000-8000-0000000000b2", name: "Jones Lab" });
    mocks.collabServerSignIn.mockResolvedValueOnce(other);
    await useCollabStore.getState().signIn("https://jones.example.edu", "github");
    expect(useCollabStore.getState().servers.map((entry) => entry.name)).toEqual(["Smith Lab", "Jones Lab"]);
  });

  it("adds a server signed in with a code and passes the code on", async () => {
    useCollabStore.setState({ servers: [signedOutServer()], status: "ready" });
    const shown = vi.fn();
    mocks.collabServerCodeSignIn.mockImplementationOnce(
      async (_url: string, _setup: string | undefined, onCode: (code: unknown) => void) => {
        onCode({ userCode: "BCDF-GHJK" });
        return server();
      },
    );
    await useCollabStore.getState().signInWithCode("https://collab.uni.edu", undefined, shown);
    expect(mocks.collabServerCodeSignIn).toHaveBeenCalledWith("https://collab.uni.edu", undefined, shown);
    expect(shown).toHaveBeenCalledWith({ userCode: "BCDF-GHJK" });
    expect(useCollabStore.getState().servers).toEqual([server()]);
  });

  it("passes a refused sign-in back to the caller", async () => {
    mocks.collabServerSignIn.mockRejectedValueOnce(collabError("not_admitted"));
    await expect(useCollabStore.getState().signIn("https://collab.uni.edu", "github")).rejects.toEqual(
      collabError("not_admitted"),
    );
    expect(useCollabStore.getState().servers).toEqual([]);
  });

  it("signs out once, clears the account and ignores a second click while busy", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    const pending = deferred<typeof DONE>();
    mocks.collabServerSignOut.mockReturnValueOnce(pending.promise);
    const first = useCollabStore.getState().signOut(SERVER_ID);
    expect(useCollabStore.getState().pending[SERVER_ID]).toBe("signOut");
    await expect(useCollabStore.getState().signOut(SERVER_ID)).resolves.toBeNull();
    pending.resolve(DONE);
    await expect(first).resolves.toBeNull();
    expect(mocks.collabServerSignOut).toHaveBeenCalledTimes(1);
    expect(useCollabStore.getState().servers[0]).toMatchObject({ account: null, signed_in: false });
    expect(useCollabStore.getState().pending).toEqual({});
  });

  it("keeps the account and returns the code when sign-out fails", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    mocks.collabServerSignOut.mockRejectedValueOnce(collabError("unreachable"));
    await expect(useCollabStore.getState().signOut(SERVER_ID)).resolves.toBe("unreachable");
    expect(useCollabStore.getState().servers[0]?.account?.display_name).toBe("Alice Chen");
    expect(useCollabStore.getState().servers[0]?.signed_in).toBe(true);
    expect(useCollabStore.getState().pending).toEqual({});
  });

  it("removes a server, and keeps it when removal fails", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    mocks.collabServerRemove.mockRejectedValueOnce(collabError("internal"));
    await expect(useCollabStore.getState().remove(SERVER_ID)).resolves.toBe("internal");
    expect(useCollabStore.getState().servers).toHaveLength(1);
    mocks.collabServerRemove.mockResolvedValueOnce(DONE);
    await expect(useCollabStore.getState().remove(SERVER_ID)).resolves.toBeNull();
    expect(mocks.collabServerRemove).toHaveBeenLastCalledWith(SERVER_ID, false);
    expect(useCollabStore.getState().servers).toEqual([]);
  });

  it("names the shared projects a removed server left as ordinary projects, until dismissed", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    const thesis = { project_id: "thesis", name: "Thesis" };
    mocks.collabServerRemove.mockResolvedValueOnce({ ...DONE, detached: [thesis] });
    await useCollabStore.getState().remove(SERVER_ID);
    expect(useCollabStore.getState().detached).toEqual([{ server: server().name, projects: [thesis] }]);
    expect(copies.followLocalCopies).toHaveBeenCalledWith(["thesis"]);
    useCollabStore.getState().dismissDetached();
    expect(useCollabStore.getState().detached).toEqual([]);
  });

  it("adds what a second Remove left to the notice instead of replacing it", async () => {
    const jones = server({ server_id: "0192a0b0-0000-7000-8000-0000000000b2", name: "Jones Lab" });
    useCollabStore.setState({ servers: [server(), jones], status: "ready" });
    const thesis = { project_id: "thesis", name: "Thesis" };
    const grant = { project_id: "grant", name: "Grant proposal" };
    mocks.collabServerRemove
      .mockResolvedValueOnce({ ...DONE, detached: [thesis] })
      .mockResolvedValueOnce({ ...DONE, detached: [grant] });
    await useCollabStore.getState().remove(SERVER_ID);
    await useCollabStore.getState().remove(jones.server_id);
    expect(useCollabStore.getState().detached).toEqual([
      { server: "Smith Lab", projects: [thesis] },
      { server: "Jones Lab", projects: [grant] },
    ]);
  });

  it("names nothing after a sign-out, or after a remove that left no projects", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    mocks.collabServerSignOut.mockResolvedValueOnce(DONE);
    await useCollabStore.getState().signOut(SERVER_ID);
    mocks.collabServerRemove.mockResolvedValueOnce({ signed_out: true, unsent: [] });
    await useCollabStore.getState().remove(SERVER_ID);
    expect(useCollabStore.getState().detached).toEqual([]);
    expect(copies.followLocalCopies).not.toHaveBeenCalled();
  });

  it("asks before signing out while a shared project still has changes the server lacks", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    mocks.collabServerSignOut.mockResolvedValueOnce({ signed_out: false, unsent: [PAPER] });
    await expect(useCollabStore.getState().signOut(SERVER_ID)).resolves.toBeNull();
    expect(mocks.collabServerSignOut).toHaveBeenCalledWith(SERVER_ID, false);
    expect(useCollabStore.getState().unsent[SERVER_ID]).toEqual({ action: "signOut", projects: [PAPER] });
    expect(useCollabStore.getState().servers[0]?.signed_in).toBe(true);
    expect(useCollabStore.getState().pending).toEqual({});
  });

  it("keeps a local copy and then signs out when the person chooses that", async () => {
    useCollabStore.setState({
      servers: [server()],
      status: "ready",
      unsent: { [SERVER_ID]: { action: "signOut", projects: [PAPER] } },
    });
    mocks.collabServerSignOut.mockResolvedValueOnce({ signed_out: true, unsent: [PAPER] });
    await expect(useCollabStore.getState().keepLocalCopies(SERVER_ID)).resolves.toBeNull();
    expect(mocks.collabServerSignOut).toHaveBeenCalledWith(SERVER_ID, true);
    expect(useCollabStore.getState().unsent).toEqual({});
    expect(useCollabStore.getState().servers[0]).toMatchObject({ account: null, signed_in: false });
    expect(copies.followLocalCopies).toHaveBeenCalledWith(["r3-paper"]);
  });

  it("removes a server only after keeping a local copy when changes are waiting", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    mocks.collabServerRemove.mockResolvedValueOnce({ signed_out: false, unsent: [PAPER] });
    await useCollabStore.getState().remove(SERVER_ID);
    expect(useCollabStore.getState().servers).toHaveLength(1);
    expect(useCollabStore.getState().unsent[SERVER_ID]?.action).toBe("remove");
    mocks.collabServerRemove.mockResolvedValueOnce({ signed_out: true, unsent: [PAPER] });
    await useCollabStore.getState().keepLocalCopies(SERVER_ID);
    expect(mocks.collabServerRemove).toHaveBeenLastCalledWith(SERVER_ID, true);
    expect(useCollabStore.getState().servers).toEqual([]);
  });

  it("stays signed in and forgets the question when the person chooses that", () => {
    useCollabStore.setState({
      servers: [server()],
      status: "ready",
      unsent: { [SERVER_ID]: { action: "signOut", projects: [PAPER] } },
    });
    useCollabStore.getState().stay(SERVER_ID);
    expect(useCollabStore.getState().unsent).toEqual({});
    expect(mocks.collabServerSignOut).not.toHaveBeenCalled();
    expect(useCollabStore.getState().servers[0]?.signed_in).toBe(true);
  });

  it("ignores a failure from a load that a newer load replaced", async () => {
    const first = deferred<CollabServer[]>();
    mocks.collabServersList.mockReturnValueOnce(first.promise).mockResolvedValueOnce([server()]);
    const stale = useCollabStore.getState().load();
    await useCollabStore.getState().load();
    first.reject(collabError("unreachable"));
    await stale;
    expect(useCollabStore.getState()).toMatchObject({ servers: [server()], status: "ready", loadError: null });
  });

  it("signs out of one server and leaves the others as they were", async () => {
    const other = server({ server_id: "0192a0b0-0000-7000-8000-0000000000b2", name: "Jones Lab" });
    useCollabStore.setState({ servers: [server(), other], status: "ready" });
    mocks.collabServerSignOut.mockResolvedValueOnce(DONE);
    await useCollabStore.getState().signOut(SERVER_ID);
    expect(useCollabStore.getState().servers[0]).toMatchObject({ account: null, signed_in: false });
    expect(useCollabStore.getState().servers[1]).toBe(other);
  });

  it("does nothing when asked to keep local copies with no question waiting", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    await expect(useCollabStore.getState().keepLocalCopies(SERVER_ID)).resolves.toBeNull();
    expect(mocks.collabServerSignOut).not.toHaveBeenCalled();
    expect(mocks.collabServerRemove).not.toHaveBeenCalled();
    expect(useCollabStore.getState().servers[0]?.signed_in).toBe(true);
  });

  it("asks each signed-in server for the current role and keeps the answer", async () => {
    const offline = signedOutServer({ server_id: "0192a0b0-0000-7000-8000-0000000000b2" });
    useCollabStore.setState({ servers: [server(), offline], status: "ready" });
    mocks.collabServerRefresh.mockResolvedValueOnce(server({ account: account({ server_role: "maintainer" }) }));
    await useCollabStore.getState().refreshAccounts();
    expect(mocks.collabServerRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.collabServerRefresh).toHaveBeenCalledWith(SERVER_ID);
    expect(useCollabStore.getState().servers[0]?.account?.server_role).toBe("maintainer");
    mocks.collabServerRefresh.mockRejectedValueOnce(collabError("unreachable"));
    await useCollabStore.getState().refreshAccounts();
    expect(useCollabStore.getState().servers[0]?.account?.server_role).toBe("maintainer");
    expect(useCollabStore.getState().servers).toHaveLength(2);
  });

  it("keeps a server signed out when its refresh, started before the sign-out, answers later", async () => {
    const other = server({ server_id: "0192a0b0-0000-7000-8000-0000000000b2", name: "Jones Lab" });
    useCollabStore.setState({ servers: [server(), other], status: "ready" });
    const slow = deferred<CollabServer>();
    mocks.collabServerRefresh.mockImplementation((serverId: string) =>
      serverId === SERVER_ID ? slow.promise : Promise.resolve(other),
    );
    const refreshing = useCollabStore.getState().refreshAccounts();
    mocks.collabServerSignOut.mockResolvedValueOnce(DONE);
    await useCollabStore.getState().signOut(SERVER_ID);
    expect(useCollabStore.getState().servers[0]?.signed_in).toBe(false);

    slow.resolve(server());
    await refreshing;

    expect(useCollabStore.getState().servers[0]).toMatchObject({ server_id: SERVER_ID, signed_in: false, account: null });
  });

  it("applies a quick refresh without waiting for a slow one", async () => {
    const other = server({ server_id: "0192a0b0-0000-7000-8000-0000000000b2", name: "Jones Lab" });
    useCollabStore.setState({ servers: [server(), other], status: "ready" });
    const slow = deferred<CollabServer>();
    mocks.collabServerRefresh.mockImplementation((serverId: string) =>
      serverId === SERVER_ID ? slow.promise : Promise.resolve({ ...other, name: "Jones Lab renamed" }),
    );
    const refreshing = useCollabStore.getState().refreshAccounts();
    await vi.waitFor(() => expect(useCollabStore.getState().servers[1]?.name).toBe("Jones Lab renamed"));
    slow.resolve(server());
    await refreshing;
  });
});
