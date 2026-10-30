// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { DESKTOP_APPS_STATUS_KEY } from "@/components/settings/desktop-apps/desktop-apps-queries";
import type { DesktopAppsSettings, DesktopAppsStatus } from "@/lib/desktop-apps";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  status: vi.fn(() => new Promise(() => undefined)),
  toolSpec: vi.fn(),
}));

vi.mock("@/lib/desktop-apps", () => ({
  cuaDriverStatus: mocks.status,
  cuaDriverInstalledApps: vi.fn(async () => []),
  cuaDriverToolSpec: mocks.toolSpec,
}));

import { DesktopAppsBriefField, desktopAppsReady } from "./DesktopAppsBriefField";

const copy = enSettings.integrations.desktopApps.task;

function status(settings: Partial<DesktopAppsSettings>, supported = true): DesktopAppsStatus {
  return {
    supported,
    settings: { enabled: true, apps: [], sites: [], scriptedControl: false, askBeforeActions: false, ...settings },
  } as unknown as DesktopAppsStatus;
}

const ONE_APP = { apps: [{ id: "com.example.lab", name: "Lab Notebook" }] } as unknown as Partial<DesktopAppsSettings>;

describe("desktopAppsReady", () => {
  it("needs a supported system, the connector on and something allowed", () => {
    expect(desktopAppsReady(undefined)).toBe(false);
    expect(desktopAppsReady(status(ONE_APP, false))).toBe(false);
    expect(desktopAppsReady(status({ ...ONE_APP, enabled: false }))).toBe(false);
    expect(desktopAppsReady(status({}))).toBe(false);
    expect(desktopAppsReady(status(ONE_APP))).toBe(true);
  });
});

describe("DesktopAppsBriefField", () => {
  function withStatus(value: DesktopAppsStatus, node: ReactNode) {
    const client = new QueryClient();
    client.setQueryData(DESKTOP_APPS_STATUS_KEY, value);
    return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  }

  it("stays off without the app's query client", () => {
    render(<DesktopAppsBriefField id="d" checked disabled={false} unattended={false} onCheckedChange={vi.fn()} />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(copy.off);
  });

  it("links to the Desktop apps settings when the connector is off, and opens them", async () => {
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null });
    render(<DesktopAppsBriefField id="d" checked={false} disabled={false} unattended={false} onCheckedChange={vi.fn()} />);
    const link = screen.getByRole("button", { name: enResearchTools.compute.brief.openSettings });

    await userEvent.click(link);

    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "integrations",
      settingsScrollTarget: "desktop-apps",
    });
  });

  it("leaves the link out when the connector is ready or the task is unattended", () => {
    const view = render(
      withStatus(
        status(ONE_APP),
        <DesktopAppsBriefField id="d" checked={false} disabled={false} unattended={false} onCheckedChange={vi.fn()} />,
      ),
    );
    expect(screen.queryByTestId("research-brief-desktop-apps-settings")).toBeNull();
    view.unmount();

    render(<DesktopAppsBriefField id="d" checked={false} disabled={false} unattended onCheckedChange={vi.fn()} />);
    expect(screen.queryByTestId("research-brief-desktop-apps-settings")).toBeNull();
  });

  it("turns on when the connector is ready", async () => {
    const onCheckedChange = vi.fn();
    render(
      withStatus(
        status(ONE_APP),
        <DesktopAppsBriefField id="d" checked={false} disabled={false} unattended={false} onCheckedChange={onCheckedChange} />,
      ),
    );
    const box = screen.getByRole("checkbox");
    expect(box).toBeEnabled();
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(copy.description);
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("is refused for tasks nobody watches", () => {
    render(
      withStatus(
        status(ONE_APP),
        <DesktopAppsBriefField id="d" checked disabled={false} unattended onCheckedChange={vi.fn()} />,
      ),
    );
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(copy.unattended);
  });

  it("asks for the light tool spec, not the driver's full status, when Settings has not loaded it", async () => {
    mocks.status.mockClear();
    mocks.toolSpec.mockResolvedValue({ name: "desktop_apps", description: "", inputSchema: {} });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DesktopAppsBriefField id="d" checked={false} disabled={false} unattended={false} onCheckedChange={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    expect(mocks.status).not.toHaveBeenCalled();
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(copy.description);
  });

  it("stays off while the tool spec says desktop apps aren't ready", async () => {
    mocks.toolSpec.mockResolvedValue(null);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DesktopAppsBriefField id="d" checked disabled={false} unattended={false} onCheckedChange={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocks.toolSpec).toHaveBeenCalled());
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(copy.off);
  });

  it("gives the permission up when the connector is off, so the brief can't save it on", () => {
    const onCheckedChange = vi.fn();
    render(
      withStatus(
        status({ ...ONE_APP, enabled: false }),
        <DesktopAppsBriefField id="d" checked disabled={false} unattended={false} onCheckedChange={onCheckedChange} />,
      ),
    );

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("gives the permission up for a task nobody watches", () => {
    const onCheckedChange = vi.fn();
    render(
      withStatus(
        status(ONE_APP),
        <DesktopAppsBriefField id="d" checked disabled={false} unattended onCheckedChange={onCheckedChange} />,
      ),
    );

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("keeps the permission while the connector's state is still unknown", () => {
    const onCheckedChange = vi.fn();
    render(<DesktopAppsBriefField id="d" checked disabled={false} unattended={false} onCheckedChange={onCheckedChange} />);

    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("opens Settings through the composer when it asks to close first", async () => {
    useSettingsStore.setState({ settingsOpen: false });
    const onOpenSettings = vi.fn((open: () => void) => open());
    render(
      <DesktopAppsBriefField
        id="d"
        checked={false}
        disabled={false}
        unattended={false}
        onCheckedChange={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: enResearchTools.compute.brief.openSettings }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });
});
