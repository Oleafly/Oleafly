// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpManagedServer, McpServerConfig } from "@oleafly/backend-port";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { DesktopAppsStatus } from "@/lib/desktop-apps";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  updateUnvalidated: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  mcpServersList: mocks.list,
  mcpServerAdd: mocks.add,
  mcpServerUpdate: mocks.updateUnvalidated,
  mcpServerUpdateValidated: mocks.update,
  mcpServerRemove: mocks.remove,
}));
vi.mock("@/lib/mcp-agent-tools", () => ({ notifyMcpAgentToolsChanged: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => undefined) }));
vi.mock("./run-in-terminal", () => ({ runInTerminal: vi.fn(async () => undefined) }));

import { cuaSpacesServerConfig, useCuaSpacesConnectorStore } from "@/store/cua-spaces-connector";
import { SpacesCard } from "./SpacesCard";

const copy = enSettings.integrations.desktopApps.spaces;
const COMMAND = "/usr/local/bin/cua";
const DECLINED = `@oleafly/error:${JSON.stringify({ code: "desktop_apps.change_declined", params: {}, detail: null })}`;

function managed(config: McpServerConfig): McpManagedServer {
  return { config, validation: { name: config.name, status: "connected", tool_count: 0, tools: [], error: null } };
}

function status(): DesktopAppsStatus {
  return { spacesCliPath: COMMAND, spacesInstallLine: "", spacesInstallCommand: { program: "/bin/sh", args: [] } } as unknown as DesktopAppsStatus;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  useCuaSpacesConnectorStore.setState({
    connected: false,
    loading: false,
    failed: false,
    declined: false,
    serverName: null,
    options: { fullAccess: false, shareCredentials: false },
  });
  mocks.list.mockResolvedValue([managed(cuaSpacesServerConfig(COMMAND, { fullAccess: false, shareCredentials: false }))]);
});

describe("SpacesCard", () => {
  it("marks Cua Spaces with the same beta badge as the other beta features", async () => {
    render(<SpacesCard status={status()} projectId={null} />);
    const card = screen.getByTestId("desktop-apps-spaces");
    expect(within(card).getByTestId("beta-badge")).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  });

  it("says nothing changed and keeps the switch off when the user says no to the system question", async () => {
    mocks.update.mockRejectedValue(DECLINED);
    render(<SpacesCard status={status()} projectId={null} />);
    const fullAccess = await screen.findByRole("switch", { name: copy.fullAccess.label });
    await waitFor(() => expect(fullAccess).not.toHaveAttribute("aria-disabled", "true"));

    await userEvent.click(fullAccess);

    expect(await screen.findByTestId("desktop-apps-spaces-declined")).toHaveTextContent(
      enErrors.desktop_apps.change_declined,
    );
    expect(fullAccess).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(copy.failed)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
