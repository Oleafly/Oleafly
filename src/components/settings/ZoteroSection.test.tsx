// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  getConnectorKey: mocks.getConnectorKey,
  setConnectorKey: mocks.setConnectorKey,
}));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useZoteroConnectorStore } from "@/store/zotero-connector";
import { ZoteroSection } from "./ZoteroSection";

const zotero = enSettings.integrations.zotero;
const actions = enSettings.integrations.actions;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue("");
  mocks.setConnectorKey.mockResolvedValue(undefined);
  useZoteroConnectorStore.setState({ connected: false, loading: false });
});

describe("ZoteroSection", () => {
  it("asks for a user id and a key when nothing is stored", async () => {
    render(<ZoteroSection />);

    expect(await screen.findByText(zotero.description)).toBeInTheDocument();
    expect(screen.getByLabelText(zotero.userIdLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(zotero.apiKeyLabel)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /zotero\.org/u }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: actions.connect })).toBeDisabled();
  });

  it("connects with a trimmed id and key, then clears the fields", async () => {
    const user = userEvent.setup();
    render(<ZoteroSection />);

    await user.type(await screen.findByLabelText(zotero.userIdLabel), " 4242 ");
    await user.type(screen.getByLabelText(zotero.apiKeyLabel), " zk-key ");
    await user.click(screen.getByRole("button", { name: actions.connect }));

    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-user-id", "4242"),
    );
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", "zk-key");
    expect(
      await screen.findByRole("button", { name: actions.disconnect }),
    ).toBeInTheDocument();
  });

  it("disconnects a stored library", async () => {
    const user = userEvent.setup();
    mocks.getConnectorKey.mockResolvedValue("zk-key");
    render(<ZoteroSection />);

    await user.click(
      await screen.findByRole("button", { name: actions.disconnect }),
    );
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", ""),
    );
    expect(screen.getByLabelText(zotero.apiKeyLabel)).toBeInTheDocument();
  });
});
