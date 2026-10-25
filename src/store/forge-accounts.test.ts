import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgeAccount } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  forgeAccountsList: vi.fn(),
  forgeSetCaFile: vi.fn(),
  forgeSignInToken: vi.fn(),
  forgeSignOut: vi.fn(),
  forgeValidate: vi.fn(),
  onForgeAccountsChanged: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  forgeAccountsList: mocks.forgeAccountsList,
  forgeSetCaFile: mocks.forgeSetCaFile,
  forgeSignInToken: mocks.forgeSignInToken,
  forgeSignOut: mocks.forgeSignOut,
  forgeValidate: mocks.forgeValidate,
  onForgeAccountsChanged: mocks.onForgeAccountsChanged,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useForgeAccountsStore } from "./forge-accounts";

function account(base: string, overrides: Partial<ForgeAccount> = {}): ForgeAccount {
  return { base, kind: "gitlab", login: "octo", auth: "token", addedAt: 1, ...overrides };
}

let changed: (() => void) | null = null;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.logError.mockResolvedValue(undefined);
  mocks.onForgeAccountsChanged.mockImplementation(async (handler: () => void) => {
    changed = handler;
    return () => {};
  });
  useForgeAccountsStore.setState({ status: "idle", accounts: [], checks: {}, error: null });
});

describe("Git hosting accounts store", () => {
  it("loads accounts once for concurrent callers", async () => {
    let resolve: (accounts: ForgeAccount[]) => void = () => {};
    mocks.forgeAccountsList.mockReturnValue(new Promise((done) => (resolve = done)));
    const first = useForgeAccountsStore.getState().ensureLoaded();
    const second = useForgeAccountsStore.getState().ensureLoaded();
    expect(useForgeAccountsStore.getState().status).toBe("loading");
    resolve([account("https://gitlab.com")]);
    await expect(first).resolves.toEqual([account("https://gitlab.com")]);
    await expect(second).resolves.toEqual([account("https://gitlab.com")]);
    expect(mocks.forgeAccountsList).toHaveBeenCalledTimes(1);
    expect(useForgeAccountsStore.getState().status).toBe("ready");

    await useForgeAccountsStore.getState().ensureLoaded();
    expect(mocks.forgeAccountsList).toHaveBeenCalledTimes(1);
  });

  it("reloads when another window changes the accounts", async () => {
    mocks.forgeAccountsList.mockResolvedValueOnce([]);
    await useForgeAccountsStore.getState().ensureLoaded();
    expect(changed).not.toBeNull();

    mocks.forgeAccountsList.mockResolvedValueOnce([account("https://codeberg.org", { kind: "gitea" })]);
    changed?.();
    await vi.waitFor(() =>
      expect(useForgeAccountsStore.getState().accounts.map((item) => item.base)).toEqual([
        "https://codeberg.org",
      ]),
    );
  });

  it("adds a token sign-in and removes a signed-out account", async () => {
    const gitlab = account("https://gitlab.com");
    mocks.forgeSignInToken.mockResolvedValue(gitlab);
    mocks.forgeSignOut.mockResolvedValue(undefined);

    const signedIn = await useForgeAccountsStore.getState().signInWithToken({
      base: "https://gitlab.com",
      kind: "gitlab",
      token: "glpat-test",
    });
    expect(signedIn).toEqual(gitlab);
    expect(mocks.forgeSignInToken).toHaveBeenCalledWith("https://gitlab.com", "gitlab", "glpat-test", null);
    expect(useForgeAccountsStore.getState().accounts).toEqual([gitlab]);
    expect(useForgeAccountsStore.getState().checks["https://gitlab.com"]).toBe("ok");
    expect(JSON.stringify(useForgeAccountsStore.getState())).not.toContain("glpat-test");

    await useForgeAccountsStore.getState().signOut("https://gitlab.com");
    expect(mocks.forgeSignOut).toHaveBeenCalledWith("https://gitlab.com");
    expect(useForgeAccountsStore.getState().accounts).toEqual([]);
    expect(useForgeAccountsStore.getState().checks).toEqual({});
  });

  it("records each account's check result", async () => {
    const gitlab = account("https://gitlab.com");
    useForgeAccountsStore.setState({ status: "ready", accounts: [gitlab] });
    let resolve: (value: unknown) => void = () => {};
    mocks.forgeValidate.mockReturnValue(new Promise((done) => (resolve = done)));

    const checking = useForgeAccountsStore.getState().validateAll();
    expect(useForgeAccountsStore.getState().checks["https://gitlab.com"]).toBe("checking");
    resolve({ base: gitlab.base, state: "signed_out", account: { ...gitlab, name: "Octo Cat" } });
    await checking;

    expect(useForgeAccountsStore.getState().checks["https://gitlab.com"]).toBe("signed_out");
    expect(useForgeAccountsStore.getState().accounts[0].name).toBe("Octo Cat");
  });

  it("does not bring back an account signed out while it was being checked", async () => {
    const gitlab = account("https://gitlab.com");
    useForgeAccountsStore.setState({ status: "ready", accounts: [gitlab] });
    let resolve: (value: unknown) => void = () => {};
    mocks.forgeValidate.mockReturnValue(new Promise((done) => (resolve = done)));
    mocks.forgeSignOut.mockResolvedValue(undefined);

    const checking = useForgeAccountsStore.getState().validateAll();
    await useForgeAccountsStore.getState().signOut(gitlab.base);
    resolve({ base: gitlab.base, state: "ok", account: gitlab });
    await checking;

    expect(useForgeAccountsStore.getState().accounts).toEqual([]);
    expect(useForgeAccountsStore.getState().checks).toEqual({});
  });

  it("reports a failed load without throwing at callers that only read", async () => {
    mocks.forgeAccountsList.mockRejectedValue(new Error("store unreadable"));
    await expect(useForgeAccountsStore.getState().ensureLoaded()).resolves.toEqual([]);
    expect(useForgeAccountsStore.getState()).toMatchObject({ status: "error", error: "store unreadable" });
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("keeps the certificate file the backend saved", async () => {
    const gitlab = account("https://git.example.org");
    useForgeAccountsStore.setState({ status: "ready", accounts: [gitlab] });
    mocks.forgeSetCaFile.mockResolvedValue({ ...gitlab, caFile: "/certs/corp.pem" });
    await useForgeAccountsStore.getState().setCaFile(gitlab.base, "/certs/corp.pem");
    expect(mocks.forgeSetCaFile).toHaveBeenCalledWith(gitlab.base, "/certs/corp.pem");
    expect(useForgeAccountsStore.getState().accounts[0].caFile).toBe("/certs/corp.pem");
  });
});
