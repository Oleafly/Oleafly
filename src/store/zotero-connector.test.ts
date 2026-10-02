import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
  zoteroVerify: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  getConnectorKey: mocks.getConnectorKey,
  setConnectorKey: mocks.setConnectorKey,
  zoteroVerify: mocks.zoteroVerify,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useZoteroConnectorStore } from "./zotero-connector";

function stored(values: Record<string, string | null>) {
  mocks.getConnectorKey.mockImplementation(async (id: string) => values[id] ?? null);
}

function appError(code: string, params: Record<string, string> = {}) {
  return `@oleafly/error:${JSON.stringify({ code, params })}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue(null);
  mocks.setConnectorKey.mockResolvedValue(undefined);
  mocks.zoteroVerify.mockResolvedValue({ userId: "12345", username: "ada" });
  useZoteroConnectorStore.setState({
    connected: false,
    loading: false,
    username: null,
    error: null,
  });
});

describe("Zotero connector store", () => {
  it("refresh reflects a stored key and the saved username", async () => {
    stored({ "zotero-api-key": "test-key-123", "zotero-username": "ada" });
    await useZoteroConnectorStore.getState().refresh();
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: true,
      username: "ada",
      loading: false,
    });
  });

  it("refresh reflects no stored key as disconnected", async () => {
    stored({ "zotero-username": "ada" });
    await useZoteroConnectorStore.getState().refresh();
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: false,
      username: null,
    });
  });

  it("refresh logs a failed read instead of rejecting", async () => {
    mocks.getConnectorKey.mockRejectedValue(new Error("locked"));
    await expect(useZoteroConnectorStore.getState().refresh()).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalledWith("read the Zotero connection", expect.any(Error));
    expect(useZoteroConnectorStore.getState().loading).toBe(false);
  });

  it("verifies the key before saving the user id, username and key", async () => {
    const order: string[] = [];
    mocks.zoteroVerify.mockImplementation(async () => {
      order.push("verify");
      return { userId: "12345", username: "ada" };
    });
    mocks.setConnectorKey.mockImplementation(async (id: string) => {
      order.push(id);
    });

    await expect(
      useZoteroConnectorStore.getState().connect("12345", "new-key"),
    ).resolves.toBe(true);

    expect(mocks.zoteroVerify).toHaveBeenCalledWith("12345", "new-key");
    expect(order).toEqual(["verify", "zotero-user-id", "zotero-username", "zotero-api-key"]);
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-user-id", "12345");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-username", "ada");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", "new-key");
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: true,
      username: "ada",
      error: null,
      loading: false,
    });
  });

  it("saves nothing and keeps the reason when Zotero rejects the key", async () => {
    mocks.zoteroVerify.mockRejectedValue(appError("zotero.key_rejected"));

    await expect(
      useZoteroConnectorStore.getState().connect("12345", "bad-key"),
    ).resolves.toBe(false);

    expect(mocks.setConnectorKey).not.toHaveBeenCalled();
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: false,
      username: null,
      error: enErrors.zotero.key_rejected,
      loading: false,
    });
  });

  it("explains a key that belongs to another user", async () => {
    mocks.zoteroVerify.mockRejectedValue(
      appError("zotero.user_mismatch", { keyUserId: "475425", userId: "999" }),
    );

    await useZoteroConnectorStore.getState().connect("999", "key");

    expect(mocks.setConnectorKey).not.toHaveBeenCalled();
    expect(useZoteroConnectorStore.getState().error).toBe(
      enErrors.zotero.user_mismatch
        .replace("{{keyUserId}}", "475425")
        .replace("{{userId}}", "999"),
    );
  });

  it("clears what it saved when storing the key fails", async () => {
    mocks.setConnectorKey.mockImplementation(async (id: string, value: string) => {
      if (id === "zotero-api-key" && value) throw new Error("disk full");
    });

    await expect(useZoteroConnectorStore.getState().connect("12345", "key")).resolves.toBe(false);

    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-user-id", "");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-username", "");
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: false,
      error: "disk full",
    });
  });

  it("clears an old error on the next attempt", async () => {
    useZoteroConnectorStore.setState({ error: "old" });
    await useZoteroConnectorStore.getState().connect("12345", "key");
    expect(useZoteroConnectorStore.getState().error).toBeNull();
  });

  it("disconnect clears the key, user id and username", async () => {
    useZoteroConnectorStore.setState({ connected: true, username: "ada" });
    await useZoteroConnectorStore.getState().disconnect();
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", "");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-user-id", "");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-username", "");
    expect(useZoteroConnectorStore.getState()).toMatchObject({
      connected: false,
      username: null,
    });
  });

  it("disconnect reports a failed removal without rejecting", async () => {
    useZoteroConnectorStore.setState({ connected: true });
    mocks.setConnectorKey.mockRejectedValue(new Error("locked"));
    await expect(useZoteroConnectorStore.getState().disconnect()).resolves.toBeUndefined();
    expect(useZoteroConnectorStore.getState().error).toBe(
      enSettings.integrations.zotero.disconnectFailed,
    );
  });
});
