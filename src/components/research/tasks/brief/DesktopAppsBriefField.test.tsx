// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { DESKTOP_APPS_STATUS_KEY } from "@/components/settings/desktop-apps/desktop-apps-queries";
import type { DesktopAppsSettings, DesktopAppsStatus } from "@/lib/desktop-apps";

vi.mock("@/lib/desktop-apps", () => ({
  cuaDriverStatus: vi.fn(() => new Promise(() => undefined)),
  cuaDriverInstalledApps: vi.fn(async () => []),
}));

import { DesktopAppsBriefField, desktopAppsReady } from "./DesktopAppsBriefField";

const copy = enSettings.integrations.desktopApps.task;

function status(settings: Partial<DesktopAppsSettings>, supported = true): DesktopAppsStatus {
  return {
    supported,
    settings: { enabled: true, apps: [], sites: [], scriptedControl: false, ...settings },
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
});
