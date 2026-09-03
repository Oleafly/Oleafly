// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => {
  const github = {
    status: "disconnected" as const,
    user: null,
    loading: false,
    connectWithToken: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
  };
  const useGithubStore = Object.assign(
    (selector: (state: typeof github) => unknown) => selector(github),
    { getState: () => github },
  );
  return {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    useGithubStore,
  };
});

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));
vi.mock("@/store/github", () => ({ useGithubStore: mocks.useGithubStore }));
vi.mock("@/lib/github", () => ({
  GITHUB_OAUTH_CLIENT_ID: "",
  checkDeviceToken: vi.fn(),
  requestDeviceCode: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import { GitHubSection } from "./GitHubSection";

const config = {
  github_token: "",
  github_user: "",
  github_connected: false,
  ai_api_key: "",
  ai_provider: "openai",
  ai_model: "gpt-4o-mini",
  ai_keys: {},
  ai_system_prompt: "",
  ai_pdf_capture: true,
  ai_provider_models: {},
  ai_custom_providers: [],
  ai_personas: [],
  ai_starter_personas_seeded: false,
  checkpoints_enabled: true,
  checkpoint_notifications: true,
  git_auto_init: true,
  mcp_enabled: false,
  mcp_port: 5323,
  mcp_read_only: false,
  mcp_approval_policy: "ask",
  mcp_servers: [],
} satisfies AppConfig;

const SWITCH_NAME = "Initialise Git for every project";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue(config);
  mocks.setConfig.mockResolvedValue(undefined);
});

describe("GitHubSection", () => {
  it("writes the Git auto-init switch back to the app config", async () => {
    const user = userEvent.setup();
    render(<GitHubSection />);

    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "New and opened projects get a Git repository so the Git panel can track changes. Oleafly never commits on its own.",
      ),
    ).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({ ...config, git_auto_init: false }),
    );
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({ ...config, git_auto_init: true }),
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("writes on top of the config as it is stored now, not the copy loaded at mount", async () => {
    const user = userEvent.setup();
    render(<GitHubSection />);

    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    const connected = { ...config, github_user: "octocat" };
    mocks.getConfig.mockResolvedValue(connected);

    await user.click(toggle);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({ ...connected, git_auto_init: false }),
    );
    expect(mocks.setConfig).toHaveBeenCalledTimes(1);
  });

  it("applies quick successive clicks in order", async () => {
    let releaseFirstRead: (value: typeof config) => void = () => {};
    mocks.getConfig
      .mockResolvedValueOnce(config)
      .mockReturnValueOnce(
        new Promise<typeof config>((resolve) => {
          releaseFirstRead = resolve;
        }),
      )
      .mockResolvedValue(config);
    const user = userEvent.setup();
    render(<GitHubSection />);

    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    await user.click(toggle);
    await user.click(toggle);
    expect(mocks.setConfig).not.toHaveBeenCalled();

    releaseFirstRead(config);
    await waitFor(() => expect(mocks.setConfig).toHaveBeenCalledTimes(2));
    expect(mocks.setConfig.mock.calls.map(([written]) => written.git_auto_init)).toEqual([
      false,
      true,
    ]);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("treats a config without the switch as on", async () => {
    const { git_auto_init: _omitted, ...older } = config;
    mocks.getConfig.mockResolvedValue(older);
    const user = userEvent.setup();
    render(<GitHubSection />);

    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({ ...older, git_auto_init: false }),
    );
  });

  it("ignores clicks until the config has loaded and reports a failed save", async () => {
    let resolveConfig: (value: typeof config) => void = () => {};
    mocks.getConfig.mockReturnValue(
      new Promise<typeof config>((resolve) => {
        resolveConfig = resolve;
      }),
    );
    mocks.setConfig.mockRejectedValueOnce(new Error("disk full"));
    const user = userEvent.setup();
    render(<GitHubSection />);

    const toggle = screen.getByRole("switch", { name: SWITCH_NAME });
    await user.click(toggle);
    expect(mocks.setConfig).not.toHaveBeenCalled();

    resolveConfig(config);
    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalled());
    await user.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save Git settings.");
    expect(screen.getByTestId("git-auto-init")).toBeInTheDocument();
  });

  it("reports a failed config load", async () => {
    mocks.getConfig.mockRejectedValueOnce(new Error("no config"));
    render(<GitHubSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load Git settings.");
  });
});
