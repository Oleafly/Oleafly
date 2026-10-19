// @vitest-environment jsdom
import type { ComponentType } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  mcpServersList: vi.fn(),
  permission: vi.fn(),
  slots: {
    compute: null as ComponentType | null,
    background: null as ComponentType | null,
  },
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  mcpServersList: mocks.mcpServersList,
}));

vi.mock("@/lib/research-tasks", () => ({ researchNotificationPermission: mocks.permission }));

vi.mock("./slots", () => ({
  get ResearchComputeSlot() {
    return mocks.slots.compute;
  },
  get ResearchBackgroundSlot() {
    return mocks.slots.background;
  },
}));

import { ResearchSettingsSection } from "./ResearchSettingsSection";

const copy = enResearchTools.tasks.settings;

function config(patch: Record<string, unknown> = {}): AppConfig {
  return {
    research_keep_awake: true,
    research_notifications: true,
    research_command_network: false,
    research_time_budget_minutes: 120,
    research_task_mcp_servers: ["zotero"],
    ...patch,
  } as unknown as AppConfig;
}

function server(name: string) {
  return { config: { name } };
}

const toggle = (name: string) => screen.getByRole("switch", { name });

/** The time budget stays disabled until the config has loaded. */
async function loaded() {
  await waitFor(() => expect(screen.getByRole("combobox", { name: copy.timeBudget })).toBeEnabled());
}

describe("ResearchSettingsSection", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    mocks.getConfig.mockReset().mockResolvedValue(config());
    mocks.setConfig.mockReset().mockResolvedValue(undefined);
    mocks.mcpServersList.mockReset().mockResolvedValue([server("zotero"), server("lab-notebook")]);
    mocks.permission.mockReset().mockResolvedValue("granted");
    mocks.slots.compute = null;
    mocks.slots.background = null;
  });

  it("toggles keep awake through the app config", async () => {
    render(<ResearchSettingsSection />);
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    await loaded();
    expect(screen.getByText(copy.keepAwakeHint)).toBeInTheDocument();

    await userEvent.click(toggle(copy.keepAwake));

    expect(mocks.setConfig).toHaveBeenCalledExactlyOnceWith(config({ research_keep_awake: false }));
    expect(toggle(copy.keepAwake)).toHaveAttribute("aria-checked", "false");
  });

  it("turns notifications and default network access on and off", async () => {
    render(<ResearchSettingsSection />);
    await loaded();
    expect(toggle(copy.notifications)).toHaveAttribute("aria-checked", "true");
    expect(toggle(copy.network)).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(copy.notificationsHint)).toBeInTheDocument();

    await userEvent.click(toggle(copy.notifications));
    expect(mocks.setConfig).toHaveBeenLastCalledWith(expect.objectContaining({ research_notifications: false }));
    await userEvent.click(toggle(copy.network));
    expect(mocks.setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ research_notifications: false, research_command_network: true }),
    );
    expect(toggle(copy.network)).toHaveAttribute("aria-checked", "true");
  });

  it("asks for notification permission when it is not granted", async () => {
    mocks.permission.mockResolvedValueOnce("prompt").mockResolvedValueOnce("granted");
    render(<ResearchSettingsSection />);
    expect(await screen.findByText(copy.notificationsBlocked)).toBeInTheDocument();
    expect(mocks.permission).toHaveBeenCalledWith(false);

    await userEvent.click(screen.getByRole("button", { name: copy.allowNotifications }));

    expect(mocks.permission).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(screen.queryByText(copy.notificationsBlocked)).toBeNull());
  });

  it("keeps the permission note when the system refuses or the request fails", async () => {
    mocks.permission.mockResolvedValueOnce("denied").mockRejectedValueOnce(new Error("No notification service"));
    render(<ResearchSettingsSection />);
    await screen.findByText(copy.notificationsBlocked);

    await userEvent.click(screen.getByRole("button", { name: copy.allowNotifications }));

    await waitFor(() => expect(mocks.permission).toHaveBeenCalledTimes(2));
    expect(screen.getByText(copy.notificationsBlocked)).toBeInTheDocument();
  });

  it("hides the permission note while notifications are off or the permission is unknown", async () => {
    mocks.permission.mockResolvedValue("prompt");
    mocks.getConfig.mockResolvedValue(config({ research_notifications: false }));
    const view = render(<ResearchSettingsSection />);
    await waitFor(() => expect(mocks.permission).toHaveBeenCalled());
    await waitFor(() => expect(toggle(copy.notifications)).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText(copy.notificationsBlocked)).toBeNull();
    view.unmount();

    mocks.permission.mockRejectedValue(new Error("Not supported"));
    mocks.getConfig.mockResolvedValue(config());
    render(<ResearchSettingsSection />);
    await loaded();
    expect(screen.queryByText(copy.notificationsBlocked)).toBeNull();
  });

  it("sets the default time budget and keeps an unusual saved value", async () => {
    mocks.getConfig.mockResolvedValue(config({ research_time_budget_minutes: 90 }));
    render(<ResearchSettingsSection />);
    await loaded();
    const budget = screen.getByRole("combobox", { name: copy.timeBudget });
    expect(budget).toHaveTextContent("90 minutes");

    const user = userEvent.setup();
    await user.click(budget);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toContain("90 minutes");
    await user.click(screen.getByRole("option", { name: "8 hours" }));

    expect(mocks.setConfig).toHaveBeenLastCalledWith(expect.objectContaining({ research_time_budget_minutes: 480 }));
  });

  it("chooses the MCP servers tasks may use", async () => {
    render(<ResearchSettingsSection />);
    await loaded();
    expect(screen.getByText(copy.mcpServersHint)).toBeInTheDocument();
    const zotero = await screen.findByRole("checkbox", { name: "zotero" });
    const notebook = screen.getByRole("checkbox", { name: "lab-notebook" });
    expect(zotero).toBeChecked();
    expect(notebook).not.toBeChecked();

    await userEvent.click(notebook);
    expect(mocks.setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ research_task_mcp_servers: ["zotero", "lab-notebook"] }),
    );
    await userEvent.click(zotero);
    expect(mocks.setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ research_task_mcp_servers: ["lab-notebook"] }),
    );
  });

  it("says when no MCP server is set up or the list cannot be read", async () => {
    mocks.mcpServersList.mockResolvedValue([]);
    const view = render(<ResearchSettingsSection />);
    expect(await screen.findByText(copy.noMcpServers)).toBeInTheDocument();
    view.unmount();

    mocks.mcpServersList.mockRejectedValue(new Error("MCP is off"));
    render(<ResearchSettingsSection />);
    expect(await screen.findByText(copy.noMcpServers)).toBeInTheDocument();
  });

  it("uses the defaults for a config from before the research settings", async () => {
    mocks.getConfig.mockResolvedValue({} as AppConfig);
    render(<ResearchSettingsSection />);
    await loaded();
    expect(toggle(copy.notifications)).toHaveAttribute("aria-checked", "true");
    expect(toggle(copy.network)).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("combobox", { name: copy.timeBudget })).toHaveTextContent("2 hours");
    expect(await screen.findByRole("checkbox", { name: "zotero" })).not.toBeChecked();
  });

  it("says the settings could not be saved and clears that after a good save", async () => {
    mocks.setConfig.mockRejectedValueOnce(new Error("disk full"));
    render(<ResearchSettingsSection />);
    await loaded();

    await userEvent.click(toggle(copy.keepAwake));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);

    await userEvent.click(toggle(copy.keepAwake));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(mocks.setConfig).toHaveBeenCalledTimes(2);
  });

  it("changes nothing until the config has loaded, and says when it cannot load", async () => {
    mocks.getConfig.mockRejectedValue(new Error("config locked"));
    render(<ResearchSettingsSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);
    expect(screen.getByRole("combobox", { name: copy.timeBudget })).toBeDisabled();

    await userEvent.click(toggle(copy.keepAwake));
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(toggle(copy.keepAwake)).toHaveAttribute("aria-checked", "true");
  });

  it("ignores answers that arrive after the section closed", async () => {
    let finish!: (value: AppConfig) => void;
    mocks.getConfig.mockReturnValue(
      new Promise<AppConfig>((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ResearchSettingsSection />);
    view.unmount();
    await act(async () => finish(config()));
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });

  it("shows the compute and background cards when they are available", async () => {
    mocks.slots.compute = () => <section data-testid="compute-card" />;
    mocks.slots.background = () => <section data-testid="background-card" />;
    const view = render(<ResearchSettingsSection />);
    const settings = screen.getByTestId("research-settings");
    expect(within(settings).getByTestId("compute-card")).toBeInTheDocument();
    expect(within(settings).getByTestId("background-card")).toBeInTheDocument();
    view.unmount();

    mocks.slots.compute = null;
    mocks.slots.background = null;
    render(<ResearchSettingsSection />);
    expect(screen.queryByTestId("compute-card")).toBeNull();
    expect(screen.queryByTestId("background-card")).toBeNull();
    await loaded();
  });
});
