import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  zoteroWebAccount: vi.fn(),
  zoteroWebConnect: vi.fn(),
  zoteroWebDisconnect: vi.fn(),
  zoteroLibrarySync: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  zoteroWebAccount: mocks.zoteroWebAccount,
  zoteroWebConnect: mocks.zoteroWebConnect,
  zoteroWebDisconnect: mocks.zoteroWebDisconnect,
  zoteroLibrarySync: mocks.zoteroLibrarySync,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useZoteroConnectorStore } from "./zotero-connector";

function appError(code: string, params: Record<string, string> = {}) {
  return `@oleafly/error:${JSON.stringify({ code, params })}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.zoteroWebAccount.mockResolvedValue(null);
  mocks.zoteroWebConnect.mockResolvedValue({ userId: "12345", username: "ada" });
  mocks.zoteroWebDisconnect.mockResolvedValue(undefined);
  mocks.zoteroLibrarySync.mockResolvedValue({
    local: { state: "notRunning" },
    web: "ready",
    libraries: [],
    itemCount: 0,
    syncing: false,
    generation: 0,
    bbtSeen: false,
    loaded: true,
  });
  useZoteroConnectorStore.setState({
    connected: false,
    loading: false,
    username: null,
    userId: null,
    error: null,
  });
});

describe("Zotero connector store", () => {
  it("refresh reads the saved account without ever reading the key", async () => {
    mocks.zoteroWebAccount.mockResolvedValue({ userId: "12345", username: " ada " });
    await useZoteroConnectorStore.getState().refresh();
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: true,
      username: "ada",
      userId: "12345",
      loading: false,
    });
  });

  it("refresh reflects no saved account as disconnected", async () => {
    await useZoteroConnectorStore.getState().refresh();
    expect(useZoteroConnectorStore.getState()).toMatchObject({ connected: false, username: null });
  });

  it("refresh logs a failed read instead of rejecting", async () => {
    mocks.zoteroWebAccount.mockRejectedValue(new Error("locked"));
    await expect(useZoteroConnectorStore.getState().refresh()).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalledWith("read the Zotero connection", expect.any(Error));
    expect(useZoteroConnectorStore.getState().loading).toBe(false);
  });

  it("hands the key to Rust once and then syncs the library", async () => {
    await expect(useZoteroConnectorStore.getState().connect("12345", "new-key")).resolves.toBe(true);
    expect(mocks.zoteroWebConnect).toHaveBeenCalledWith("12345", "new-key");
    expect(mocks.zoteroLibrarySync).toHaveBeenCalledWith(false, true);
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: true,
      username: "ada",
      error: null,
      loading: false,
    });
  });

  it("keeps the reason when Zotero rejects the key", async () => {
    mocks.zoteroWebConnect.mockRejectedValue(appError("zotero.key_rejected"));
    await expect(useZoteroConnectorStore.getState().connect("12345", "bad-key")).resolves.toBe(false);
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: false,
      username: null,
      error: enErrors.zotero.key_rejected,
      loading: false,
    });
  });

  it("explains a key that belongs to another user", async () => {
    mocks.zoteroWebConnect.mockRejectedValue(appError("zotero.user_mismatch", { keyUserId: "475425", userId: "999" }));
    await useZoteroConnectorStore.getState().connect("999", "key");
    expect(useZoteroConnectorStore.getState().error).toBe(
      enErrors.zotero.user_mismatch.replace("{{keyUserId}}", "475425").replace("{{userId}}", "999"),
    );
  });

  it("clears an old error on the next attempt", async () => {
    useZoteroConnectorStore.setState({ error: "old" });
    await useZoteroConnectorStore.getState().connect("12345", "key");
    expect(useZoteroConnectorStore.getState().error).toBeNull();
  });

  it("disconnect removes the saved account", async () => {
    useZoteroConnectorStore.setState({ connected: true, username: "ada", userId: "12345" });
    await useZoteroConnectorStore.getState().disconnect();
    expect(mocks.zoteroWebDisconnect).toHaveBeenCalled();
    expect(useZoteroConnectorStore.getState()).toMatchObject({ connected: false, username: null, userId: null });
  });

  it("disconnect reports a failed removal without rejecting", async () => {
    useZoteroConnectorStore.setState({ connected: true });
    mocks.zoteroWebDisconnect.mockRejectedValue(new Error("locked"));
    await expect(useZoteroConnectorStore.getState().disconnect()).resolves.toBeUndefined();
    expect(useZoteroConnectorStore.getState().error).toBe(enSettings.integrations.zotero.disconnectFailed);
  });
});
