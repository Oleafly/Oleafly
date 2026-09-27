// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type {
  SystemIntegrationItem,
  SystemIntegrationItemId,
  SystemIntegrationStatus,
} from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  set: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  systemIntegrationStatus: mocks.status,
  setSystemIntegration: mocks.set,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { SystemIntegrationSection } from "./SystemIntegrationSection";

const copy = enSettings.systemIntegration;

function item(
  id: SystemIntegrationItemId,
  state: SystemIntegrationItem["state"],
  extra: Partial<SystemIntegrationItem> = {},
): SystemIntegrationItem {
  return { id, state, packaged: false, attention: null, ...extra };
}

function status(
  platform: SystemIntegrationStatus["platform"],
  items: SystemIntegrationItem[],
): SystemIntegrationStatus {
  return { platform, items };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SystemIntegrationSection", () => {
  it("installs the Finder Quick Action on macOS and then offers to remove it", async () => {
    mocks.status.mockResolvedValue(status("macos", [item("quick_action", "not_installed")]));
    mocks.set.mockResolvedValue(item("quick_action", "installed"));
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);

    const row = await screen.findByTestId("system-integration-quick_action");
    expect(row).toHaveTextContent(copy.quickAction.label);
    expect(row).toHaveTextContent(copy.quickAction.description);
    expect(row).toHaveTextContent(copy.state.notInstalled);
    expect(screen.queryByRole("switch")).toBeNull();

    await user.click(within(row).getByRole("button", { name: copy.actions.install }));

    expect(mocks.set).toHaveBeenCalledWith("quick_action", true);
    expect(await within(row).findByRole("button", { name: enCommon.actions.remove })).toBeEnabled();
    expect(row).toHaveTextContent(copy.state.installed);
  });

  it("shows why a quick action needs attention and repairs it", async () => {
    mocks.status.mockResolvedValue(
      status("macos", [item("quick_action", "needs_attention", { attention: "outdated" })]),
    );
    mocks.set.mockResolvedValue(item("quick_action", "installed"));
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);

    const row = await screen.findByTestId("system-integration-quick_action");
    expect(row).toHaveTextContent(copy.state.needsAttention);
    expect(row).toHaveTextContent(copy.attention.outdated);
    expect(within(row).getByRole("button", { name: enCommon.actions.remove })).toBeEnabled();

    await user.click(within(row).getByRole("button", { name: copy.actions.repair }));

    expect(mocks.set).toHaveBeenCalledWith("quick_action", true);
    await waitFor(() => expect(row).not.toHaveTextContent(copy.attention.outdated));
  });

  it("explains a failed install inside the row and keeps the row usable", async () => {
    mocks.status.mockResolvedValue(status("macos", [item("quick_action", "not_installed")]));
    mocks.set.mockRejectedValueOnce(new Error("disk full"));
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);

    const row = await screen.findByTestId("system-integration-quick_action");
    await user.click(within(row).getByRole("button", { name: copy.actions.install }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(copy.failed.install);
    expect(within(row).getByRole("button", { name: copy.actions.install })).toBeEnabled();
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("switches the File Explorer menu on Windows from the keyboard", async () => {
    mocks.status.mockResolvedValue(status("windows", [item("explorer_menu", "installed")]));
    mocks.set.mockResolvedValue(item("explorer_menu", "not_installed"));
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);

    const toggle = await screen.findByRole("switch", { name: copy.explorerMenu.toggle });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("system-integration-explorer_menu")).toHaveTextContent(
      copy.explorerMenu.description,
    );

    toggle.focus();
    await user.keyboard(" ");

    expect(mocks.set).toHaveBeenCalledWith("explorer_menu", false);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByTestId("system-integration-explorer_menu")).toHaveTextContent(
      copy.state.notInstalled,
    );
  });

  it("offers a repair when the Explorer menu opens another copy", async () => {
    mocks.status.mockResolvedValue(
      status("windows", [item("explorer_menu", "needs_attention", { attention: "elsewhere" })]),
    );
    mocks.set.mockResolvedValue(item("explorer_menu", "installed"));
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);

    const row = await screen.findByTestId("system-integration-explorer_menu");
    expect(row).toHaveTextContent(copy.attention.elsewhere);
    expect(within(row).getByRole("switch")).toHaveAttribute("aria-checked", "true");

    await user.click(within(row).getByRole("button", { name: copy.actions.repair }));

    expect(mocks.set).toHaveBeenCalledWith("explorer_menu", true);
  });

  it("shows only the file managers found on Linux, with packaged actions read-only", async () => {
    mocks.status.mockResolvedValue(
      status("linux", [
        item("dolphin", "installed", { packaged: true }),
        item("nautilus", "not_installed"),
        item("folder_open_with", "needs_attention", { attention: "no_default_file_manager" }),
      ]),
    );
    render(<SystemIntegrationSection />);

    const dolphin = await screen.findByTestId("system-integration-dolphin");
    expect(dolphin).toHaveTextContent(copy.packaged);
    expect(within(dolphin).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("system-integration-nemo")).toBeNull();
    expect(screen.queryByTestId("system-integration-quick_action")).toBeNull();

    const nautilus = screen.getByTestId("system-integration-nautilus");
    expect(nautilus).toHaveTextContent(copy.nautilus.label);
    expect(within(nautilus).getByRole("button", { name: copy.actions.install })).toBeEnabled();

    const openWith = screen.getByTestId("system-integration-folder_open_with");
    expect(openWith).toHaveTextContent(copy.attention.noDefaultFileManager);
    expect(within(openWith).queryByRole("button", { name: copy.actions.repair })).toBeNull();
    expect(within(openWith).getByRole("button", { name: enCommon.actions.remove })).toBeEnabled();
  });

  it("keeps other rows usable while one change is running", async () => {
    mocks.status.mockResolvedValue(
      status("linux", [item("dolphin", "not_installed"), item("nemo", "not_installed")]),
    );
    const pending = deferred<SystemIntegrationItem>();
    mocks.set.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);

    const dolphin = await screen.findByTestId("system-integration-dolphin");
    await user.click(within(dolphin).getByRole("button", { name: copy.actions.install }));

    expect(dolphin).toHaveAttribute("aria-busy", "true");
    expect(within(dolphin).getByRole("button", { name: copy.actions.install })).toBeDisabled();
    const nemo = screen.getByTestId("system-integration-nemo");
    expect(within(nemo).getByRole("button", { name: copy.actions.install })).toBeEnabled();

    pending.resolve(item("dolphin", "installed"));
    expect(await within(dolphin).findByRole("button", { name: enCommon.actions.remove })).toBeEnabled();
  });

  it("says it is checking, then says so when the check fails", async () => {
    const pending = deferred<SystemIntegrationStatus>();
    mocks.status.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<SystemIntegrationSection />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.checking);
    unmount();

    mocks.status.mockRejectedValueOnce(new Error("no bridge"));
    render(<SystemIntegrationSection />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("survives a bridge that fails before it returns a promise", async () => {
    mocks.status.mockImplementationOnce(() => {
      throw new Error("No invoke export");
    });
    render(<SystemIntegrationSection />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("keeps a slot for the shell command row and hides when there is nothing to show", async () => {
    mocks.status.mockResolvedValue(status("linux", []));
    const { unmount } = render(
      <SystemIntegrationSection shellCommandRow={<div data-testid="shell-command-slot" />} />,
    );
    expect(await screen.findByTestId("shell-command-slot")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    unmount();

    render(<SystemIntegrationSection />);
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("settings-system-integration")).toBeNull());
  });

  it("never draws an outline or ring for focus", async () => {
    mocks.status.mockResolvedValue(
      status("windows", [item("explorer_menu", "needs_attention", { attention: "elsewhere" })]),
    );
    render(<SystemIntegrationSection />);
    const section = await screen.findByTestId("settings-system-integration");
    await screen.findByRole("switch");
    for (const element of section.querySelectorAll("*")) {
      expect(element.getAttribute("class") ?? "").not.toMatch(/(^|\s|:)(ring|outline)(-|\s|$)/);
    }
  });
});
