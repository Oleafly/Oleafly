import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabServer } from "@/lib/tauri";
import { account, collabError, deferred, server, SERVER_ID, signedOutServer } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServersList: vi.fn(),
  collabServerSignIn: vi.fn(),
  collabServerSignOut: vi.fn(),
  collabServerRemove: vi.fn(),
  collabServerRefresh: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { useCollabStore } from "./store";

beforeEach(() => {
  vi.clearAllMocks();
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
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

  it("passes a refused sign-in back to the caller", async () => {
    mocks.collabServerSignIn.mockRejectedValueOnce(collabError("not_admitted"));
    await expect(useCollabStore.getState().signIn("https://collab.uni.edu", "github")).rejects.toEqual(
      collabError("not_admitted"),
    );
    expect(useCollabStore.getState().servers).toEqual([]);
  });

  it("signs out once, clears the account and ignores a second click while busy", async () => {
    useCollabStore.setState({ servers: [server()], status: "ready" });
    const pending = deferred<void>();
    mocks.collabServerSignOut.mockReturnValueOnce(pending.promise);
    const first = useCollabStore.getState().signOut(SERVER_ID);
    expect(useCollabStore.getState().pending[SERVER_ID]).toBe("signOut");
    await expect(useCollabStore.getState().signOut(SERVER_ID)).resolves.toBeNull();
    pending.resolve();
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
    mocks.collabServerRemove.mockResolvedValueOnce(undefined);
    await expect(useCollabStore.getState().remove(SERVER_ID)).resolves.toBeNull();
    expect(mocks.collabServerRemove).toHaveBeenLastCalledWith(SERVER_ID);
    expect(useCollabStore.getState().servers).toEqual([]);
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
});
