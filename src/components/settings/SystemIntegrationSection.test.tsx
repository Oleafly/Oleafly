// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNative from "@/i18n/locales/en/native.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
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
const menuHint = copy.quickAction.menuHint.replace(
  "{{title}}",
  enNative.systemIntegration.openInOleafly,
);

function item(
  id: SystemIntegrationItemId,
  state: SystemIntegrationItem["state"],
  extra: Partial<SystemIntegrationItem> = {},
): SystemIntegrationItem {
  return {
    id,
    state,
    packaged: false,
    attention: null,
    quick_actions_menu: null,
    menu_title: null,
    ...extra,
  };
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
  vi.resetAllMocks();
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

  it("treats a status of the wrong shape as a failed check instead of crashing", async () => {
    mocks.status.mockResolvedValueOnce([]);
    render(<SystemIntegrationSection shellCommandRow={<div data-testid="shell-command-slot" />} />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.getByTestId("shell-command-slot")).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalled();
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

  it("explains how to add the Quick Action to Quick Actions when macOS shows it only under Services", async () => {
    mocks.status.mockResolvedValue(
      status("macos", [
        item("quick_action", "installed", {
          quick_actions_menu: false,
          menu_title: enNative.systemIntegration.openInOleafly,
        }),
      ]),
    );
    render(<SystemIntegrationSection />);

    const row = await screen.findByTestId("system-integration-quick_action");
    expect(within(row).getByTestId("system-integration-quick-actions-hint")).toHaveTextContent(
      menuHint,
    );
    expect(menuHint).toContain("Quick Actions › Customize");
    expect(menuHint).toContain("turn on Open in Oleafly.");
    for (const text of [menuHint, copy.quickAction.description, enShell.quickActionOffer.added]) {
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
    expect(copy.quickAction.description).toContain("Services menu");
    expect(enShell.quickActionOffer.added).not.toContain("Quick Actions › Open in Oleafly");
    expect(enShell.quickActionOffer.added).toContain("Services");
  });

  it("says to turn it on in Customize once, in the hint, and nowhere else in the row", async () => {
    mocks.status.mockResolvedValue(
      status("macos", [
        item("quick_action", "installed", {
          quick_actions_menu: false,
          menu_title: enNative.systemIntegration.openInOleafly,
        }),
      ]),
    );
    render(<SystemIntegrationSection />);

    const row = await screen.findByTestId("system-integration-quick_action");
    const hint = within(row).getByTestId("system-integration-quick-actions-hint");
    expect(within(row).getAllByText(/Customize/)).toEqual([hint]);
    expect(within(row).getAllByText(/turn on|turn it on/)).toEqual([hint]);
    expect(within(row).getByText(copy.quickAction.description)).not.toBe(hint);
  });

  it("after Install, asks to turn it on only when Quick Actions does not show it yet", async () => {
    for (const quickActionsMenu of [true, false]) {
      mocks.status.mockResolvedValueOnce(status("macos", [item("quick_action", "not_installed")]));
      mocks.set.mockResolvedValueOnce(
        item("quick_action", "installed", {
          quick_actions_menu: quickActionsMenu,
          menu_title: enNative.systemIntegration.openInOleafly,
        }),
      );
      const user = userEvent.setup();
      const { unmount } = render(<SystemIntegrationSection />);
      const row = await screen.findByTestId("system-integration-quick_action");
      expect(row).not.toHaveTextContent(/Customize|turn on|turn it on/);

      await user.click(within(row).getByRole("button", { name: copy.actions.install }));
      expect(await within(row).findByRole("button", { name: enCommon.actions.remove })).toBeEnabled();

      if (quickActionsMenu) {
        expect(row).not.toHaveTextContent(/Customize|turn on|turn it on/);
        expect(within(row).queryByTestId("system-integration-quick-actions-hint")).toBeNull();
      } else {
        expect(within(row).getByTestId("system-integration-quick-actions-hint")).toHaveTextContent(
          menuHint,
        );
      }
      unmount();
    }
  });

  it("names the Quick Action by the title Finder shows, even after a language change", async () => {
    mocks.status.mockResolvedValue(
      status("macos", [
        item("quick_action", "installed", {
          quick_actions_menu: false,
          menu_title: "In Oleafly öffnen",
        }),
      ]),
    );
    render(<SystemIntegrationSection />);

    const hint = await screen.findByTestId("system-integration-quick-actions-hint");
    expect(hint).toHaveTextContent(copy.quickAction.menuHint.replace("{{title}}", "In Oleafly öffnen"));
    expect(hint).not.toHaveTextContent(enNative.systemIntegration.openInOleafly);
  });

  it("hides the Quick Actions hint once it is on, when macOS cannot tell, and before it is installed", async () => {
    for (const [state, quickActionsMenu] of [
      ["installed", true],
      ["installed", null],
      ["not_installed", false],
      ["needs_attention", false],
    ] as const) {
      mocks.status.mockResolvedValueOnce(
        status("macos", [
          item("quick_action", state, {
            quick_actions_menu: quickActionsMenu,
            attention: state === "needs_attention" ? "outdated" : null,
          }),
        ]),
      );
      const { unmount } = render(<SystemIntegrationSection />);
      const row = await screen.findByTestId("system-integration-quick_action");
      expect(within(row).queryByTestId("system-integration-quick-actions-hint")).toBeNull();
      unmount();
    }
  });

  it("checks again on focus only while the hint is showing", async () => {
    mocks.status.mockResolvedValueOnce(status("macos", [item("quick_action", "not_installed")]));
    mocks.set.mockResolvedValue(
      item("quick_action", "installed", { quick_actions_menu: false, menu_title: "Open in Oleafly" }),
    );
    const user = userEvent.setup();
    const { unmount } = render(<SystemIntegrationSection />);

    const row = await screen.findByTestId("system-integration-quick_action");
    fireEvent.focus(window);
    expect(mocks.status).toHaveBeenCalledTimes(1);

    await user.click(within(row).getByRole("button", { name: copy.actions.install }));
    expect(await within(row).findByTestId("system-integration-quick-actions-hint")).toBeInTheDocument();

    mocks.status.mockResolvedValueOnce(
      status("macos", [item("quick_action", "installed", { quick_actions_menu: true })]),
    );
    fireEvent.focus(window);
    await waitFor(() =>
      expect(within(row).queryByTestId("system-integration-quick-actions-hint")).toBeNull(),
    );
    expect(mocks.status).toHaveBeenCalledTimes(2);

    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));
    expect(mocks.status).toHaveBeenCalledTimes(2);

    unmount();
    fireEvent.focus(window);
    expect(mocks.status).toHaveBeenCalledTimes(2);
  });

  it("never checks again on focus on Linux or Windows", async () => {
    for (const next of [
      status("linux", [item("dolphin", "installed"), item("folder_open_with", "not_installed")]),
      status("windows", [item("explorer_menu", "installed")]),
    ]) {
      mocks.status.mockClear();
      mocks.status.mockResolvedValue(next);
      const { unmount } = render(<SystemIntegrationSection />);
      await screen.findByTestId(`system-integration-${next.items[0].id}`);
      fireEvent.focus(window);
      fireEvent(document, new Event("visibilitychange"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(mocks.status).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("checks again when the window becomes visible, not when it is hidden", async () => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    try {
      mocks.status.mockResolvedValueOnce(
        status("macos", [item("quick_action", "installed", { quick_actions_menu: false })]),
      );
      render(<SystemIntegrationSection />);
      const row = await screen.findByTestId("system-integration-quick_action");
      expect(await within(row).findByTestId("system-integration-quick-actions-hint")).toHaveTextContent(
        menuHint,
      );
      expect(mocks.status).toHaveBeenCalledTimes(1);

      visibility = "hidden";
      fireEvent(document, new Event("visibilitychange"));
      expect(mocks.status).toHaveBeenCalledTimes(1);

      mocks.status.mockResolvedValueOnce(
        status("macos", [item("quick_action", "installed", { quick_actions_menu: true })]),
      );
      visibility = "visible";
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() =>
        expect(within(row).queryByTestId("system-integration-quick-actions-hint")).toBeNull(),
      );
      expect(mocks.status).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("keeps the rows when a later check fails and ignores a check that raced a change", async () => {
    mocks.status.mockResolvedValueOnce(
      status("macos", [item("quick_action", "installed", { quick_actions_menu: false })]),
    );
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);
    const row = await screen.findByTestId("system-integration-quick_action");
    await within(row).findByTestId("system-integration-quick-actions-hint");

    mocks.status.mockRejectedValueOnce(new Error("pbs unavailable"));
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.logError).toHaveBeenCalled());
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    expect(row).toHaveTextContent(copy.state.installed);
    expect(within(row).getByTestId("system-integration-quick-actions-hint")).toBeInTheDocument();

    const stale = deferred<SystemIntegrationStatus>();
    mocks.status.mockReturnValueOnce(stale.promise);
    fireEvent.focus(window);
    expect(mocks.status).toHaveBeenCalledTimes(3);
    mocks.set.mockResolvedValueOnce(item("quick_action", "not_installed"));
    await user.click(within(row).getByRole("button", { name: enCommon.actions.remove }));
    expect(await within(row).findByRole("button", { name: copy.actions.install })).toBeEnabled();

    await act(async () => {
      stale.resolve(
        status("macos", [item("quick_action", "installed", { quick_actions_menu: false })]),
      );
      await stale.promise;
    });
    expect(row).toHaveTextContent(copy.state.notInstalled);
    expect(within(row).queryByTestId("system-integration-quick-actions-hint")).toBeNull();
    expect(within(row).queryByRole("button", { name: enCommon.actions.remove })).toBeNull();
  });

  it("drops a check that starts while an install or remove runs and ends after it", async () => {
    mocks.status.mockResolvedValueOnce(
      status("macos", [item("quick_action", "installed", { quick_actions_menu: false })]),
    );
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);
    const row = await screen.findByTestId("system-integration-quick_action");
    await within(row).findByTestId("system-integration-quick-actions-hint");

    const removing = deferred<SystemIntegrationItem>();
    mocks.set.mockReturnValueOnce(removing.promise);
    await user.click(within(row).getByRole("button", { name: enCommon.actions.remove }));
    expect(row).toHaveAttribute("aria-busy", "true");

    const stale = deferred<SystemIntegrationStatus>();
    mocks.status.mockReturnValueOnce(stale.promise);
    fireEvent.focus(window);
    expect(mocks.status).toHaveBeenCalledTimes(2);

    await act(async () => {
      removing.resolve(item("quick_action", "not_installed"));
      await removing.promise;
    });
    expect(await within(row).findByRole("button", { name: copy.actions.install })).toBeEnabled();

    await act(async () => {
      stale.resolve(
        status("macos", [item("quick_action", "installed", { quick_actions_menu: false })]),
      );
      await stale.promise;
    });
    expect(row).toHaveTextContent(copy.state.notInstalled);
    expect(within(row).queryByTestId("system-integration-quick-actions-hint")).toBeNull();
    expect(within(row).getByRole("button", { name: copy.actions.install })).toBeEnabled();
  });

  it("drops a check that started before an install or remove and ends while it runs", async () => {
    mocks.status.mockResolvedValueOnce(
      status("macos", [item("quick_action", "installed", { quick_actions_menu: false })]),
    );
    const user = userEvent.setup();
    render(<SystemIntegrationSection />);
    const row = await screen.findByTestId("system-integration-quick_action");
    await within(row).findByTestId("system-integration-quick-actions-hint");

    const stale = deferred<SystemIntegrationStatus>();
    mocks.status.mockReturnValueOnce(stale.promise);
    fireEvent.focus(window);
    expect(mocks.status).toHaveBeenCalledTimes(2);

    const removing = deferred<SystemIntegrationItem>();
    mocks.set.mockReturnValueOnce(removing.promise);
    await user.click(within(row).getByRole("button", { name: enCommon.actions.remove }));
    expect(row).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      stale.resolve(
        status("macos", [
          item("quick_action", "needs_attention", { attention: "outdated", quick_actions_menu: null }),
        ]),
      );
      await stale.promise;
    });
    expect(row).not.toHaveTextContent(copy.attention.outdated);
    expect(row).toHaveTextContent(copy.state.installed);
    expect(row).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      removing.resolve(item("quick_action", "not_installed"));
      await removing.promise;
    });
    expect(await within(row).findByRole("button", { name: copy.actions.install })).toBeEnabled();
    expect(row).not.toHaveTextContent(copy.attention.outdated);
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
