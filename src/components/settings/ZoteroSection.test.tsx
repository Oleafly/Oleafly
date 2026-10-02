// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
  zoteroVerify: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  getConnectorKey: mocks.getConnectorKey,
  setConnectorKey: mocks.setConnectorKey,
  zoteroVerify: mocks.zoteroVerify,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useZoteroConnectorStore } from "@/store/zotero-connector";
import { ZoteroSection } from "./ZoteroSection";

const zotero = enSettings.integrations.zotero;
const actions = enSettings.integrations.actions;

function stored(values: Record<string, string>) {
  mocks.getConnectorKey.mockImplementation(async (id: string) => values[id] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue("");
  mocks.setConnectorKey.mockResolvedValue(undefined);
  mocks.zoteroVerify.mockResolvedValue({ userId: "4242", username: "ada" });
  useZoteroConnectorStore.setState({
    connected: false,
    loading: false,
    username: null,
    error: null,
  });
});

async function fillAndConnect(userId = " 4242 ", apiKey = " zk-key ") {
  const user = userEvent.setup();
  render(<ZoteroSection />);
  await user.type(await screen.findByLabelText(zotero.userIdLabel), userId);
  await user.type(screen.getByLabelText(zotero.apiKeyLabel), apiKey);
  await user.click(screen.getByRole("button", { name: actions.connect }));
  return user;
}

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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("verifies a trimmed id and key, saves them, then shows who is connected", async () => {
    await fillAndConnect();

    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", "zk-key"),
    );
    expect(mocks.zoteroVerify).toHaveBeenCalledWith("4242", "zk-key");
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-user-id", "4242");
    expect(
      await screen.findByText(zotero.connectedAs.replace("{{username}}", "ada")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: actions.disconnect })).toBeInTheDocument();
    expect(screen.queryByLabelText(zotero.apiKeyLabel)).not.toBeInTheDocument();
  });

  it("shows a busy button while Zotero checks the key", async () => {
    let finish: (value: { userId: string; username: string }) => void = () => {};
    mocks.zoteroVerify.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await fillAndConnect();

    const button = screen.getByRole("button", { name: actions.connect });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.closest("form")).toHaveAttribute("aria-busy", "true");

    finish({ userId: "4242", username: "ada" });
    expect(
      await screen.findByRole("button", { name: actions.disconnect }),
    ).toBeInTheDocument();
  });

  it("keeps the fields and shows Zotero's reason inline when verification fails", async () => {
    mocks.zoteroVerify.mockRejectedValue(
      `@oleafly/error:${JSON.stringify({ code: "zotero.library_not_readable" })}`,
    );
    await fillAndConnect();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(enErrors.zotero.library_not_readable);
    expect(mocks.setConnectorKey).not.toHaveBeenCalled();
    const keyInput = screen.getByLabelText(zotero.apiKeyLabel);
    expect(keyInput).toHaveValue(" zk-key ");
    expect(keyInput).toHaveAttribute("aria-invalid", "true");
    expect(keyInput).toHaveAttribute("aria-describedby", alert.id);
    expect(screen.getByRole("button", { name: actions.connect })).toBeEnabled();
  });

  it("shows the generic connected line when no username was saved", async () => {
    stored({ "zotero-api-key": "zk-key" });
    render(<ZoteroSection />);

    expect(await screen.findByText(zotero.connected)).toBeInTheDocument();
  });

  it("shows the saved username after a restart", async () => {
    stored({ "zotero-api-key": "zk-key", "zotero-username": "grace" });
    render(<ZoteroSection />);

    expect(
      await screen.findByText(zotero.connectedAs.replace("{{username}}", "grace")),
    ).toBeInTheDocument();
  });

  it("disconnects a stored library", async () => {
    const user = userEvent.setup();
    stored({ "zotero-api-key": "zk-key", "zotero-username": "ada" });
    render(<ZoteroSection />);

    await user.click(
      await screen.findByRole("button", { name: actions.disconnect }),
    );
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("zotero-api-key", ""),
    );
    expect(await screen.findByLabelText(zotero.apiKeyLabel)).toBeInTheDocument();
  });
});
