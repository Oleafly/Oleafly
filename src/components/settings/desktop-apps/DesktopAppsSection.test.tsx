// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import type { DesktopAppsSettings, DesktopAppsStatus } from "@/lib/desktop-apps";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  settingsSet: vi.fn(),
  test: vi.fn(),
  sync: vi.fn(async () => undefined),
  openTerminalWith: vi.fn(async () => ({ terminalId: "t1" })),
  openInSystemBrowser: vi.fn(async () => true),
}));

vi.mock("@/lib/desktop-apps", () => ({
  cuaDriverStatus: mocks.status,
  cuaDriverSettingsSet: mocks.settingsSet,
  cuaDriverTest: mocks.test,
  cuaDriverInstalledApps: vi.fn(async () => []),
  cuaDriverPickApp: vi.fn(async () => null),
  syncDesktopAppsTool: mocks.sync,
}));
vi.mock("@/lib/terminal-launch", () => ({
  openTerminalWith: mocks.openTerminalWith,
  TerminalLaunchError: class TerminalLaunchError extends Error {
    reason = "invalid";
  },
}));
vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: mocks.openInSystemBrowser }));
vi.mock("./SpacesCard", () => ({ SpacesCard: () => <div data-testid="spaces-card-stub" /> }));

import DesktopAppsSection from "./DesktopAppsSection";

const copy = enSettings.integrations.desktopApps;
const WINDOWS_LINE = 'powershell.exe -NoProfile -Command "irm https://cua.ai/driver/install.ps1 | iex"';

const OFF: DesktopAppsSettings = { enabled: false, apps: [], sites: [], scriptedControl: false };

function status(overrides: Partial<DesktopAppsStatus> = {}): DesktopAppsStatus {
  return {
    platform: "macos",
    supported: true,
    driverPath: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    driverVersion: "0.36.1",
    driverProblem: null,
    minimumVersion: "0.36.0",
    installLine: '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"',
    installCommand: { program: "/bin/sh", args: ["-c", '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"'] },
    permissions: { accessibility: true, screenRecording: true },
    gnomeHelper: null,
    gnomeHelperLine: null,
    running: [],
    spacesCliPath: null,
    spacesInstallLine: "curl -fsSL https://cua.ai/install.sh | sh",
    spacesInstallCommand: { program: "/bin/sh", args: ["-c", "curl -fsSL https://cua.ai/install.sh | sh"] },
    settings: OFF,
    ...overrides,
  };
}

function renderSection(ui: ReactNode = <DesktopAppsSection />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  for (const mock of [mocks.status, mocks.settingsSet, mocks.test, mocks.openTerminalWith, mocks.sync]) {
    mock.mockClear();
  }
  mocks.status.mockReset();
  mocks.settingsSet.mockReset();
  mocks.test.mockReset();
  useFilesStore.setState({ projectId: null });
  useSettingsStore.setState({ settingsOpen: true });
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("DesktopAppsSection", () => {
  it("shows the platform's install line and runs it in the terminal only with a project open", async () => {
    const user = userEvent.setup();
    mocks.status.mockResolvedValue(
      status({
        platform: "windows",
        driverProblem: "not_installed",
        driverPath: null,
        driverVersion: null,
        permissions: null,
        installLine: WINDOWS_LINE,
        installCommand: {
          program: "powershell.exe",
          args: ["-NoProfile", "-Command", "irm https://cua.ai/driver/install.ps1 | iex"],
        },
      }),
    );
    renderSection();
    expect(await screen.findByText(/irm https:\/\/cua\.ai\/driver\/install\.ps1/)).toBeVisible();
    const run = screen.getByRole("button", { name: copy.install.run });
    expect(run).toBeDisabled();
    expect(screen.getByText(copy.install.needsProject)).toBeVisible();
    expect(screen.getByRole("switch", { name: copy.enable.label })).toHaveAttribute("aria-disabled", "true");

    act(() => useFilesStore.setState({ projectId: "p1" }));
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);
    expect(mocks.openTerminalWith).toHaveBeenCalledWith({
      title: "Install Cua Driver",
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", "irm https://cua.ai/driver/install.ps1 | iex"],
      confirmText: copy.install.confirm,
    });
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });

  it("turns the connector on through Rust and refreshes the assistant tool", async () => {
    const user = userEvent.setup();
    mocks.status.mockResolvedValue(status());
    mocks.settingsSet.mockImplementation(async (settings: DesktopAppsSettings) => settings);
    renderSection();
    await user.click(await screen.findByRole("switch", { name: copy.enable.label }));
    await waitFor(() => expect(mocks.settingsSet).toHaveBeenCalledWith({ ...OFF, enabled: true }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalled());
    expect(await screen.findByRole("switch", { name: copy.enable.label })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the error when the user declines the system confirmation", async () => {
    const user = userEvent.setup();
    mocks.status.mockResolvedValue(status());
    mocks.settingsSet.mockRejectedValue(
      `@oleafly/error:${JSON.stringify({ code: "desktop_apps.change_declined", params: {}, detail: null })}`,
    );
    renderSection();
    await user.click(await screen.findByRole("switch", { name: copy.enable.label }));
    expect(await screen.findByText(enErrors.desktop_apps.change_declined)).toBeVisible();
    expect(screen.getByRole("switch", { name: copy.enable.label })).toHaveAttribute("aria-checked", "false");
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("adds a site and marks it for the signed-in browser", async () => {
    const user = userEvent.setup();
    const on = { ...OFF, enabled: true };
    mocks.status.mockResolvedValue(status({ settings: on }));
    mocks.settingsSet.mockImplementation(async (settings: DesktopAppsSettings) => settings);
    renderSection();
    await user.type(await screen.findByRole("textbox", { name: copy.sites.add }), "https://journal.example.org");
    await user.click(screen.getByRole("button", { name: copy.sites.add }));
    await waitFor(() =>
      expect(mocks.settingsSet).toHaveBeenCalledWith({
        ...on,
        sites: [{ origin: "https://journal.example.org", signedIn: false }],
      }),
    );
    const row = (await screen.findByText("https://journal.example.org")).closest("div[class*='rounded-lg']");
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole("switch", { name: copy.sites.signedIn.label }));
    await waitFor(() =>
      expect(mocks.settingsSet).toHaveBeenLastCalledWith({
        ...on,
        sites: [{ origin: "https://journal.example.org", signedIn: true }],
      }),
    );
  });

  it("removes an app with a named button", async () => {
    const user = userEvent.setup();
    const on = {
      ...OFF,
      enabled: true,
      apps: [{ name: "Zotero", bundleId: "org.zotero.zotero" }],
    };
    mocks.status.mockResolvedValue(status({ settings: on }));
    mocks.settingsSet.mockImplementation(async (settings: DesktopAppsSettings) => settings);
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Remove Zotero" }));
    await waitFor(() => expect(mocks.settingsSet).toHaveBeenCalledWith({ ...on, apps: [] }));
  });

  it("reports a passing connection test", async () => {
    const user = userEvent.setup();
    mocks.status.mockResolvedValue(status({ settings: { ...OFF, enabled: true } }));
    mocks.test.mockResolvedValue({ ok: true, version: "0.36.1", runtimes: [{ kind: "desktop", ok: true, detail: null }], problems: [] });
    renderSection();
    await user.click(await screen.findByRole("button", { name: copy.test.action }));
    expect(await screen.findByText(copy.test.ok)).toBeVisible();
  });

  it("asks for the macOS permissions in the terminal", async () => {
    const user = userEvent.setup();
    useFilesStore.setState({ projectId: "p1" });
    mocks.status.mockResolvedValue(status({ permissions: { accessibility: false, screenRecording: true } }));
    renderSection();
    expect(await screen.findByText(copy.permissions.needed)).toBeVisible();
    await user.click(screen.getByRole("button", { name: copy.permissions.grant }));
    expect(mocks.openTerminalWith).toHaveBeenCalledWith({
      title: copy.permissions.terminalTitle,
      command: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      args: ["permissions", "grant"],
      confirmText: undefined,
    });
  });
});
