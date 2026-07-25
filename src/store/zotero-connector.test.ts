import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
}));
vi.mock("@/lib/tauri", () => mocks);

import { useZoteroConnectorStore } from "./zotero-connector";

beforeEach(() => {
  mocks.getConnectorKey.mockReset();
  mocks.setConnectorKey.mockReset();
  useZoteroConnectorStore.setState({ connected: false, loading: false });
});

describe("Zotero connector store", () => {
  it("refresh reflects a stored key as connected", async () => {
    mocks.getConnectorKey.mockResolvedValue("test-key-123");
    await useZoteroConnectorStore.getState().refresh();
    expect(useZoteroConnectorStore.getState().connected).toBe(true);
  });

  it("refresh reflects no stored key as disconnected", async () => {
    mocks.getConnectorKey.mockResolvedValue(null);
    await useZoteroConnectorStore.getState().refresh();
    expect(useZoteroConnectorStore.getState().connected).toBe(false);
  });

  it("connect stores the user id and key and marks connected", async () => {
    mocks.setConnectorKey.mockResolvedValue(undefined);
    await useZoteroConnectorStore.getState().connect("12345", "new-key");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-user-id", "12345");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", "new-key");
    expect(useZoteroConnectorStore.getState().connected).toBe(true);
  });

  it("disconnect clears the key and marks disconnected", async () => {
    await useZoteroConnectorStore.getState().disconnect();
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", "");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-user-id", "");
    expect(useZoteroConnectorStore.getState().connected).toBe(false);
  });
});
