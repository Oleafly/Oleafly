import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
}));
vi.mock("@/lib/tauri", () => mocks);

import { useAlphaXivConnectorStore } from "./alphaxiv-connector";

beforeEach(() => {
  mocks.getConnectorKey.mockReset();
  mocks.setConnectorKey.mockReset();
  useAlphaXivConnectorStore.setState({ connected: false, loading: false });
});

describe("alphaXiv connector store", () => {
  it("refresh reflects a stored key as connected", async () => {
    mocks.getConnectorKey.mockResolvedValue("test-key-123");
    await useAlphaXivConnectorStore.getState().refresh();
    expect(useAlphaXivConnectorStore.getState().connected).toBe(true);
  });

  it("refresh reflects no stored key as disconnected", async () => {
    mocks.getConnectorKey.mockResolvedValue(null);
    await useAlphaXivConnectorStore.getState().refresh();
    expect(useAlphaXivConnectorStore.getState().connected).toBe(false);
  });

  it("connect stores the key and marks connected", async () => {
    mocks.setConnectorKey.mockResolvedValue(undefined);
    await useAlphaXivConnectorStore.getState().connect("new-key");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("alphaxiv", "new-key");
    expect(useAlphaXivConnectorStore.getState().connected).toBe(true);
  });

  it("disconnect clears the key and marks disconnected", async () => {
    await useAlphaXivConnectorStore.getState().disconnect();
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("alphaxiv", "");
    expect(useAlphaXivConnectorStore.getState().connected).toBe(false);
  });
});
