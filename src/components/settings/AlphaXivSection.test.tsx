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
import { useAlphaXivConnectorStore } from "@/store/alphaxiv-connector";
import { AlphaXivSection } from "./AlphaXivSection";

const alphaxiv = enSettings.integrations.alphaxiv;
const actions = enSettings.integrations.actions;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue("");
  mocks.setConnectorKey.mockResolvedValue(undefined);
  useAlphaXivConnectorStore.setState({ connected: false, loading: false });
});

describe("AlphaXivSection", () => {
  it("asks for a key when none is stored", async () => {
    render(<AlphaXivSection />);

    expect(await screen.findByText(alphaxiv.description)).toBeInTheDocument();
    expect(screen.getByLabelText(alphaxiv.apiKeyLabel)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /alphaxiv\.org/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: actions.connect })).toBeDisabled();
  });

  it("connects with a trimmed key and then clears the field", async () => {
    const user = userEvent.setup();
    render(<AlphaXivSection />);

    await user.type(await screen.findByLabelText(alphaxiv.apiKeyLabel), " axv1_key ");
    await user.click(screen.getByRole("button", { name: actions.connect }));

    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("alphaxiv", "axv1_key"),
    );
    expect(
      await screen.findByRole("button", { name: actions.disconnect }),
    ).toBeInTheDocument();
  });

  it("disconnects a stored key", async () => {
    const user = userEvent.setup();
    mocks.getConnectorKey.mockResolvedValue("axv1_key");
    render(<AlphaXivSection />);

    await user.click(
      await screen.findByRole("button", { name: actions.disconnect }),
    );
    await waitFor(() => expect(mocks.setConnectorKey).toHaveBeenCalled());
    expect(screen.getByLabelText(alphaxiv.apiKeyLabel)).toBeInTheDocument();
  });
});
