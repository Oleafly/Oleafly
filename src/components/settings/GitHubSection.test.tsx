// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => {
  const github = {
    status: "disconnected" as string,
    user: null as { login: string; name?: string; avatar_url?: string } | null,
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
    github,
    oauth: { clientId: "" },
    checkDeviceToken: vi.fn(),
    requestDeviceCode: vi.fn(),
    open: vi.fn(),
  };
});

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));
vi.mock("@/store/github", () => ({ useGithubStore: mocks.useGithubStore }));
vi.mock("@/lib/github", () => ({
  get GITHUB_OAUTH_CLIENT_ID() {
    return mocks.oauth.clientId;
  },
  checkDeviceToken: mocks.checkDeviceToken,
  requestDeviceCode: mocks.requestDeviceCode,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
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

const SWITCH_NAME = enSettings.github.autoInit.label;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue(config);
  mocks.setConfig.mockResolvedValue(undefined);
  mocks.oauth.clientId = "";
  mocks.github.status = "disconnected";
  mocks.github.user = null;
  mocks.github.loading = false;
});

describe("GitHubSection", () => {
  it("writes the Git auto-init switch back to the app config", async () => {
    const user = userEvent.setup();
    render(<GitHubSection />);

    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(enSettings.github.autoInit.description)).toBeInTheDocument();

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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      enSettings.github.config.saveFailed,
    );
    expect(screen.getByTestId("git-auto-init")).toBeInTheDocument();
  });

  it("reports a failed config load", async () => {
    mocks.getConfig.mockRejectedValueOnce(new Error("no config"));
    render(<GitHubSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      enSettings.github.config.loadFailed,
    );
  });
});

const github = enSettings.github;

describe("GitHubSection connected account", () => {
  it("shows the avatar, the handle, and the account name", async () => {
    mocks.github.status = "connected";
    mocks.github.user = {
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.test/octocat.png",
    };
    render(<GitHubSection />);

    expect(
      await screen.findByText(github.account.handle.replace("{{login}}", "octocat")),
    ).toBeInTheDocument();
    expect(screen.getByText("The Octocat")).toBeInTheDocument();
    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src",
      "https://avatars.test/octocat.png",
    );
  });

  it("falls back to a generic label when the profile has no name or avatar", async () => {
    mocks.github.status = "connected";
    mocks.github.user = { login: "octocat" };
    render(<GitHubSection />);

    expect(await screen.findByText(github.account.connected)).toBeInTheDocument();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("disconnects and says so", async () => {
    const user = userEvent.setup();
    mocks.github.status = "connected";
    mocks.github.user = { login: "octocat" };
    mocks.github.disconnect.mockResolvedValue(undefined);
    render(<GitHubSection />);

    await user.click(
      await screen.findByRole("button", { name: github.account.disconnect }),
    );
    expect(mocks.github.disconnect).toHaveBeenCalled();
    expect(await screen.findByText(github.notice.disconnected)).toBeInTheDocument();
  });

  it("asks the store to refresh an unknown status", async () => {
    mocks.github.status = "unknown";
    mocks.github.refresh.mockResolvedValue(undefined);
    render(<GitHubSection />);

    await waitFor(() => expect(mocks.github.refresh).toHaveBeenCalled());
  });
});

describe("GitHubSection personal access token", () => {
  it("routes Connect to the token field when no OAuth app is configured", async () => {
    const user = userEvent.setup();
    render(<GitHubSection />);

    expect(await screen.findByText(github.hint.token)).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(github.advanced.tokenPlaceholder),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: github.connect }));
    expect(
      screen.getByPlaceholderText(github.advanced.tokenPlaceholder),
    ).toBeInTheDocument();
  });

  it("connects with a pasted token and reports the account", async () => {
    const user = userEvent.setup();
    mocks.github.connectWithToken.mockImplementation(async () => {
      mocks.github.user = { login: "octocat" };
    });
    render(<GitHubSection />);

    await user.click(
      await screen.findByRole("button", { name: github.advanced.toggle }),
    );
    const field = screen.getByPlaceholderText(github.advanced.tokenPlaceholder);
    const connect = screen.getByRole("button", { name: github.advanced.connect });
    expect(connect).toBeDisabled();

    await user.type(field, "  ghp_token  ");
    await user.click(connect);

    await waitFor(() =>
      expect(mocks.github.connectWithToken).toHaveBeenCalledWith("ghp_token"),
    );
    expect(
      await screen.findByText(github.notice.connected.replace("{{login}}", "octocat")),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(github.advanced.tokenPlaceholder),
    ).not.toBeInTheDocument();
  });

  it("surfaces a rejected token", async () => {
    const user = userEvent.setup();
    mocks.github.connectWithToken.mockRejectedValue(new Error("bad credentials"));
    render(<GitHubSection />);

    await user.click(
      await screen.findByRole("button", { name: github.advanced.toggle }),
    );
    await user.type(
      screen.getByPlaceholderText(github.advanced.tokenPlaceholder),
      "ghp_bad",
    );
    await user.click(screen.getByRole("button", { name: github.advanced.connect }));

    expect(await screen.findByText("bad credentials")).toBeInTheDocument();
  });
});

describe("GitHubSection device flow", () => {
  const deviceCode = {
    device_code: "dev-1",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    interval: 5,
    expires_in: 900,
  };

  beforeEach(() => {
    mocks.oauth.clientId = "Iv1.testclient";
  });

  it("shows the one-time code and lets the user copy it, reopen GitHub, or cancel", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mocks.requestDeviceCode.mockResolvedValue(deviceCode);
    mocks.checkDeviceToken.mockResolvedValue({ status: "pending" });
    render(<GitHubSection />);

    expect(await screen.findByText(github.hint.oauth)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: github.connect }));

    expect(await screen.findByText(github.device.title)).toBeInTheDocument();
    expect(screen.getByText(deviceCode.user_code)).toBeInTheDocument();
    expect(screen.getByText(github.device.waiting)).toBeInTheDocument();
    expect(mocks.open).toHaveBeenCalledWith(deviceCode.verification_uri);

    await user.click(screen.getByRole("button", { name: enCommon.actions.copy }));
    expect(writeText).toHaveBeenCalledWith(deviceCode.user_code);
    expect(
      await screen.findByRole("button", { name: enCommon.actions.copied }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: github.device.openGithub }));
    expect(mocks.open).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(
      await screen.findByRole("button", { name: github.connect }),
    ).toBeInTheDocument();
  });

  it("connects once GitHub hands back a token", async () => {
    vi.useFakeTimers();
    mocks.requestDeviceCode.mockResolvedValue(deviceCode);
    mocks.checkDeviceToken
      .mockResolvedValueOnce({ status: "slow_down", interval: 1 })
      .mockResolvedValue({ status: "token", token: "gho_token" });
    mocks.github.connectWithToken.mockImplementation(async () => {
      mocks.github.user = { login: "octocat" };
    });
    try {
      render(<GitHubSection />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByRole("button", { name: github.connect }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(github.device.title)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(mocks.github.connectWithToken).toHaveBeenCalledWith("gho_token");
      expect(
        screen.getByText(github.notice.connected.replace("{{login}}", "octocat")),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a device flow that never starts", async () => {
    const user = userEvent.setup();
    mocks.requestDeviceCode.mockRejectedValue(new Error("network down"));
    render(<GitHubSection />);

    await user.click(await screen.findByRole("button", { name: github.connect }));
    expect(await screen.findByText("network down")).toBeInTheDocument();
  });
});
