// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroLibraryStatus } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  zoteroWebAccount: vi.fn(),
  zoteroWebConnect: vi.fn(),
  zoteroWebDisconnect: vi.fn(),
  zoteroLibraryStatus: vi.fn(),
  zoteroLibrarySync: vi.fn(),
  zoteroLibraryTest: vi.fn(),
  zoteroLibrarySetEnabled: vi.fn(),
  zoteroLibraryKeys: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({ ...mocks }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useZoteroConnectorStore } from "@/store/zotero-connector";
import { resetZoteroLibraryForTest } from "@/store/zotero-library";
import { ZoteroSection } from "./ZoteroSection";

const zotero = enSettings.integrations.zotero;
const actions = enSettings.integrations.actions;

function status(overrides: Partial<ZoteroLibraryStatus> = {}): ZoteroLibraryStatus {
  return {
    local: { state: "notRunning" },
    web: "notConnected",
    libraries: [],
    itemCount: 0,
    syncing: false,
    generation: 1,
    bbtSeen: false,
    loaded: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetZoteroLibraryForTest();
  mocks.zoteroWebAccount.mockResolvedValue(null);
  mocks.zoteroWebConnect.mockResolvedValue({ userId: "4242", username: "ada" });
  mocks.zoteroWebDisconnect.mockResolvedValue(undefined);
  mocks.zoteroLibraryStatus.mockResolvedValue(status());
  mocks.zoteroLibrarySync.mockResolvedValue(status());
  mocks.zoteroLibraryKeys.mockResolvedValue({ generation: 1, keys: [] });
  useZoteroConnectorStore.setState({ connected: false, loading: false, username: null, userId: null, error: null });
});

async function fillAndConnect(userId = " 4242 ", apiKey = " zk-key ") {
  const user = userEvent.setup();
  render(<ZoteroSection />);
  await user.type(await screen.findByLabelText(zotero.userIdLabel), userId);
  await user.type(screen.getByLabelText(zotero.apiKeyLabel), apiKey);
  await user.click(screen.getByRole("button", { name: actions.connect }));
  return user;
}

describe("ZoteroSection: Zotero on this computer", () => {
  it("gives the exact one-line fix when the local API switch is off", async () => {
    mocks.zoteroLibraryStatus.mockResolvedValue(status({ local: { state: "apiDisabled", zoteroVersion: "7.0.11" } }));
    render(<ZoteroSection />);
    expect(await screen.findByText(zotero.local.apiDisabled)).toBeInTheDocument();
  });

  it("names the Zotero and Better BibTeX versions it found", async () => {
    mocks.zoteroLibraryStatus.mockResolvedValue(
      status({
        local: { state: "ready", zoteroVersion: "7.0.11", bbtVersion: "6.7.240" },
        source: "local",
        lastSync: Date.now() - 120_000,
        itemCount: 1200,
        libraries: [
          { id: "user", name: "", kind: "user", itemCount: 1000, enabled: true },
          { id: "group:7", name: "Lab Group", kind: "group", itemCount: 200, enabled: true },
        ],
      }),
    );
    render(<ZoteroSection />);
    expect(await screen.findByText(zotero.local.ready.replace("{{version}}", "7.0.11"))).toBeInTheDocument();
    expect(screen.getByText(zotero.local.bbtFound.replace("{{version}}", "6.7.240"))).toBeInTheDocument();
    expect(screen.getByTestId("zotero-sync-status")).toHaveTextContent("1,200 items ready to cite");
    expect(screen.getByRole("switch", { name: zotero.library.toggle.replace("{{name}}", zotero.library.myLibrary) })).toBeChecked();
    expect(screen.getByText("Lab Group")).toBeInTheDocument();
  });

  it("tests the connection and reports versions, libraries and item counts", async () => {
    mocks.zoteroLibraryTest.mockResolvedValue({
      local: { state: "ready", zoteroVersion: "7.0.11" },
      web: "notConnected",
      source: "local",
      libraries: [
        { id: "user", name: "", kind: "user", itemCount: 1000 },
        { id: "group:7", name: "Lab Group", kind: "group", itemCount: 1 },
      ],
    });
    const user = userEvent.setup();
    render(<ZoteroSection />);
    await user.click(await screen.findByRole("button", { name: zotero.test }));
    const report = await screen.findByTestId("zotero-report");
    expect(report).toHaveTextContent("Zotero 7.0.11");
    expect(report).toHaveTextContent(zotero.report.noBbt);
    expect(within(report).getByText("My Library: 1,000 items")).toBeInTheDocument();
    expect(within(report).getByText("Lab Group: 1 item")).toBeInTheDocument();
    expect(mocks.zoteroLibrarySync).toHaveBeenCalledWith(false, true);
  });

  it("explains a failed test inline", async () => {
    mocks.zoteroLibraryTest.mockResolvedValue({
      local: { state: "notRunning" },
      web: "notConnected",
      libraries: [],
      error: `@oleafly/error:${JSON.stringify({ code: "zotero.local_not_running" })}`,
    });
    const user = userEvent.setup();
    render(<ZoteroSection />);
    await user.click(await screen.findByRole("button", { name: zotero.test }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enErrors.zotero.local_not_running);
  });

  it("turns a library off", async () => {
    mocks.zoteroLibraryStatus.mockResolvedValue(
      status({ libraries: [{ id: "group:7", name: "Lab Group", kind: "group", itemCount: 2, enabled: true }], itemCount: 2 }),
    );
    mocks.zoteroLibrarySetEnabled.mockResolvedValue(status());
    const user = userEvent.setup();
    render(<ZoteroSection />);
    await user.click(await screen.findByRole("switch", { name: zotero.library.toggle.replace("{{name}}", "Lab Group") }));
    expect(mocks.zoteroLibrarySetEnabled).toHaveBeenCalledWith("group:7", false);
  });
});

describe("ZoteroSection: zotero.org account", () => {
  it("asks for a key when no account is saved", async () => {
    render(<ZoteroSection />);
    expect(await screen.findByText(zotero.citeDescription)).toBeInTheDocument();
    expect(screen.getByLabelText(zotero.userIdLabel)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /zotero\.org/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: actions.connect })).toBeDisabled();
  });

  it("sends a trimmed id and key to Rust, then shows who is connected", async () => {
    await fillAndConnect();
    await waitFor(() => expect(mocks.zoteroWebConnect).toHaveBeenCalledWith("4242", "zk-key"));
    expect(await screen.findByText(zotero.connectedAs.replace("{{username}}", "ada"))).toBeInTheDocument();
    expect(screen.queryByLabelText(zotero.apiKeyLabel)).not.toBeInTheDocument();
  });

  it("shows a busy form while Zotero checks the key", async () => {
    let finish: (value: { userId: string; username: string }) => void = () => {};
    mocks.zoteroWebConnect.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await fillAndConnect();
    const button = screen.getByRole("button", { name: actions.connect });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.closest("form")).toHaveAttribute("aria-busy", "true");
    finish({ userId: "4242", username: "ada" });
    expect(await screen.findByRole("button", { name: actions.disconnect })).toBeInTheDocument();
  });

  it("keeps the fields and shows Zotero's reason inline when the key is refused", async () => {
    mocks.zoteroWebConnect.mockRejectedValue(`@oleafly/error:${JSON.stringify({ code: "zotero.library_not_readable" })}`);
    await fillAndConnect();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(enErrors.zotero.library_not_readable);
    const keyInput = screen.getByLabelText(zotero.apiKeyLabel);
    expect(keyInput).toHaveValue(" zk-key ");
    expect(keyInput).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the saved account after a restart and disconnects it", async () => {
    mocks.zoteroWebAccount.mockResolvedValue({ userId: "4242", username: "grace" });
    const user = userEvent.setup();
    render(<ZoteroSection />);
    expect(await screen.findByText(zotero.connectedAs.replace("{{username}}", "grace"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: actions.disconnect }));
    await waitFor(() => expect(mocks.zoteroWebDisconnect).toHaveBeenCalled());
    expect(await screen.findByLabelText(zotero.apiKeyLabel)).toBeInTheDocument();
  });
});
