// @vitest-environment jsdom
import type { ComponentType } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
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

/** A config that keeps what was saved, the way the Rust side does. */
function storeConfig(initial: AppConfig) {
  let stored = initial;
  mocks.getConfig.mockImplementation(async () => stored);
  mocks.setConfig.mockImplementation(async (next: AppConfig) => {
    stored = next;
  });
  return {
    get: () => stored,
    set: (next: AppConfig) => {
      stored = next;
    },
  };
}

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
    storeConfig(config());
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

  it("says when no MCP server is set up", async () => {
    mocks.mcpServersList.mockResolvedValue([]);
    mocks.getConfig.mockResolvedValue(config({ research_task_mcp_servers: [] }));
    render(<ResearchSettingsSection />);
    expect(await screen.findByText(copy.noMcpServers)).toBeInTheDocument();
  });

  it("says when the MCP server list cannot be read, and reads it again on retry", async () => {
    mocks.mcpServersList.mockRejectedValueOnce(new Error("MCP is off"));
    render(<ResearchSettingsSection />);
    expect(await screen.findByText(enSettings.research.mcpServers.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(copy.noMcpServers)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    expect(await screen.findByRole("checkbox", { name: "zotero" })).toBeChecked();
    expect(screen.queryByText(enSettings.research.mcpServers.loadFailed)).toBeNull();
  });

  it("lists a chosen server that is gone so it can be unticked", async () => {
    mocks.getConfig.mockResolvedValue(config({ research_task_mcp_servers: ["zotero", "old-notebook"] }));
    render(<ResearchSettingsSection />);
    await loaded();
    const gone = await screen.findByRole("checkbox", { name: "old-notebook (not found)" });
    expect(gone).toBeChecked();

    await userEvent.click(gone);

    expect(mocks.setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ research_task_mcp_servers: ["zotero"] }),
    );
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "old-notebook (not found)" })).toBeNull());
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
    // Not "could not be saved": nothing was saved.
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadFailed);
    expect(screen.queryByText(copy.saveFailed)).toBeNull();
    expect(screen.getByRole("combobox", { name: copy.timeBudget })).toBeDisabled();
    expect(toggle(copy.keepAwake)).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(toggle(copy.keepAwake));
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(toggle(copy.keepAwake)).toHaveAttribute("aria-checked", "true");
  });

  it("loads the config again on retry and then lets the switches work", async () => {
    mocks.getConfig.mockRejectedValueOnce(new Error("config locked"));
    render(<ResearchSettingsSection />);
    await screen.findByText(copy.loadFailed);

    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    await loaded();
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    await userEvent.click(toggle(copy.keepAwake));
    expect(mocks.setConfig).toHaveBeenCalledOnce();
  });

  it("puts a switch back when its save fails", async () => {
    mocks.setConfig.mockRejectedValueOnce(new Error("disk full"));
    render(<ResearchSettingsSection />);
    await loaded();

    await userEvent.click(toggle(copy.keepAwake));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);
    expect(toggle(copy.keepAwake)).toHaveAttribute("aria-checked", "true");
  });

  it("saves only its own settings over a fresh read of the config", async () => {
    render(<ResearchSettingsSection />);
    await loaded();
    // Another window changed an unrelated setting after this section loaded.
    mocks.getConfig.mockResolvedValue(config({ ai_system_prompt: "Be brief." }));

    await userEvent.click(toggle(copy.keepAwake));

    expect(mocks.setConfig).toHaveBeenCalledExactlyOnceWith(
      config({ ai_system_prompt: "Be brief.", research_keep_awake: false }),
    );
  });

  it("leaves a research setting another writer changed alone when saving a different one", async () => {
    const store = storeConfig(config());
    render(<ResearchSettingsSection />);
    await loaded();
    // A cloud settings round changed the time budget after this section loaded.
    store.set(config({ research_time_budget_minutes: 480 }));

    await userEvent.click(toggle(copy.keepAwake));

    await waitFor(() => expect(mocks.setConfig).toHaveBeenCalledOnce());
    expect(store.get()).toEqual(config({ research_time_budget_minutes: 480, research_keep_awake: false }));
  });

  it("shows the stored value when a save fails behind an earlier one", async () => {
    const store = storeConfig(config());
    render(<ResearchSettingsSection />);
    await loaded();
    let releaseRead: () => void = () => {};
    mocks.getConfig.mockImplementationOnce(
      () => new Promise<AppConfig>((resolve) => { releaseRead = () => resolve(store.get()); }),
    );
    mocks.setConfig
      .mockImplementationOnce(async (next: AppConfig) => store.set(next))
      .mockRejectedValueOnce(new Error("file locked"));

    await userEvent.click(toggle(copy.keepAwake));
    await userEvent.click(toggle(copy.network));
    expect(toggle(copy.network)).toHaveAttribute("aria-checked", "true");
    releaseRead();

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);
    // The first save set only keep awake, so the network stays off in the config and on screen.
    await waitFor(() => expect(toggle(copy.network)).toHaveAttribute("aria-checked", "false"));
    expect(store.get()).toEqual(config({ research_keep_awake: false }));
    expect(toggle(copy.keepAwake)).toHaveAttribute("aria-checked", "false");
  });

  it("explains what allowing the network does", async () => {
    render(<ResearchSettingsSection />);
    await loaded();
    expect(screen.getByText(copy.networkHint)).toBeInTheDocument();
  });

  it("resets the research defaults after a confirmation and leaves the rest of the config alone", async () => {
    mocks.getConfig.mockResolvedValue(
      config({
        research_keep_awake: false,
        research_notifications: false,
        research_command_network: true,
        research_time_budget_minutes: 480,
        research_task_mcp_servers: ["zotero"],
        ai_system_prompt: "Be brief.",
      }),
    );
    render(<ResearchSettingsSection />);
    await loaded();
    expect(screen.getByTestId("reset-changed-dot")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: enSettings.reset.button }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(copy.resetConfirm);
    expect(mocks.setConfig).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole("button", { name: enSettings.reset.button }));

    await waitFor(() => expect(mocks.setConfig).toHaveBeenCalledOnce());
    expect(mocks.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        research_keep_awake: true,
        research_notifications: true,
        research_command_network: false,
        research_time_budget_minutes: 120,
        research_task_mcp_servers: [],
        ai_system_prompt: "Be brief.",
      }),
    );
    expect(toggle(copy.keepAwake)).toHaveAttribute("aria-checked", "true");
    expect(toggle(copy.network)).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("combobox", { name: copy.timeBudget })).toHaveTextContent("2 hours");
    expect(screen.queryByTestId("reset-changed-dot")).toBeNull();
  });

  it("marks nothing as changed while every research setting is at its default", async () => {
    mocks.getConfig.mockResolvedValue(config({ research_task_mcp_servers: [] }));
    render(<ResearchSettingsSection />);
    await loaded();

    expect(screen.queryByTestId("reset-changed-dot")).toBeNull();
    expect(screen.getByRole("button", { name: enSettings.reset.button })).toBeEnabled();
  });

  it("keeps the reset button off until the config has loaded", async () => {
    mocks.getConfig.mockRejectedValue(new Error("config locked"));
    render(<ResearchSettingsSection />);
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: enSettings.reset.button })).toBeDisabled();
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
