// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig, ForgeAccount, ForgeDeviceStart, ForgeServerInfo } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  forgeAccountsList: vi.fn(),
  forgeValidate: vi.fn(),
  forgeDetect: vi.fn(),
  forgeSignInToken: vi.fn(),
  forgeDeviceStart: vi.fn(),
  forgeDevicePoll: vi.fn(),
  forgeDeviceCancel: vi.fn(),
  forgeSignOut: vi.fn(),
  forgeSetCaFile: vi.fn(),
  onForgeAccountsChanged: vi.fn(),
  open: vi.fn(),
  pickOpenPath: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  forgeAccountsList: mocks.forgeAccountsList,
  forgeValidate: mocks.forgeValidate,
  forgeDetect: mocks.forgeDetect,
  forgeSignInToken: mocks.forgeSignInToken,
  forgeDeviceStart: mocks.forgeDeviceStart,
  forgeDevicePoll: mocks.forgeDevicePoll,
  forgeDeviceCancel: mocks.forgeDeviceCancel,
  forgeSignOut: mocks.forgeSignOut,
  forgeSetCaFile: mocks.forgeSetCaFile,
  onForgeAccountsChanged: mocks.onForgeAccountsChanged,
}));
vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: mocks.open }));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: mocks.pickOpenPath }));

import { useForgeAccountsStore } from "@/store/forge-accounts";
import { GitHostingSection } from "./GitHostingSection";

const copy = enSettings.gitHosting;

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

function account(base: string, overrides: Partial<ForgeAccount> = {}): ForgeAccount {
  return { base, kind: "gitlab", login: "zoe", auth: "token", addedAt: 1, ...overrides };
}

function server(base: string, overrides: Partial<ForgeServerInfo> = {}): ForgeServerInfo {
  return { base, kind: "gitlab", flavor: null, deviceFlow: false, ...overrides };
}

const githubStart: ForgeDeviceStart = {
  flowId: "flow-1",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  verificationUriComplete: null,
  expiresIn: 900,
  interval: 5,
};

function envelope(code: string, params: Record<string, string> = {}): string {
  return `@oleafly/error:${JSON.stringify({ code, params })}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue(config);
  mocks.setConfig.mockResolvedValue(undefined);
  mocks.forgeAccountsList.mockResolvedValue([]);
  mocks.forgeValidate.mockImplementation(async (base: string) => ({ base, state: "ok", account: null }));
  mocks.onForgeAccountsChanged.mockResolvedValue(() => {});
  mocks.forgeDeviceCancel.mockResolvedValue(undefined);
  useForgeAccountsStore.setState({ status: "idle", accounts: [], checks: {}, error: null });
});

describe("GitHostingSection accounts", () => {
  it("lists each account with its host and kind and signs out", async () => {
    const user = userEvent.setup();
    const selfHosted = account("https://git.example.org", { name: "Zoë Q" });
    mocks.forgeAccountsList.mockResolvedValue([selfHosted]);
    mocks.forgeSignOut.mockResolvedValue(undefined);
    render(<GitHostingSection />);

    const row = await screen.findByTestId("git-hosting-account-git.example.org");
    expect(row).toHaveTextContent("git.example.org");
    expect(row).toHaveTextContent("GitLab");
    expect(row).toHaveTextContent(copy.account.signedInAs.replace("{{login}}", "zoe"));
    await waitFor(() => expect(mocks.forgeValidate).toHaveBeenCalledWith("https://git.example.org"));

    await user.click(screen.getByTestId("git-hosting-sign-out-git.example.org"));
    expect(mocks.forgeSignOut).toHaveBeenCalledWith("https://git.example.org");
    expect(await screen.findByTestId("git-hosting-notice")).toHaveTextContent(
      copy.notice.signedOut.replace("{{host}}", "git.example.org"),
    );
    expect(screen.queryByTestId("git-hosting-account-git.example.org")).not.toBeInTheDocument();
  });

  it("adds a GitHub account with a pasted token", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect.mockResolvedValue(server("https://github.com", { kind: "github", deviceFlow: true }));
    mocks.forgeSignInToken.mockResolvedValue(account("https://github.com", { kind: "github", login: "octocat" }));
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-github"));
    expect(mocks.forgeDetect).toHaveBeenCalledWith("https://github.com", null);
    await user.click(await screen.findByTestId("git-hosting-use-token"));
    await user.type(screen.getByTestId("git-hosting-token"), "ghp_test123");
    await user.click(screen.getByTestId("git-hosting-token-connect"));

    expect(mocks.forgeSignInToken).toHaveBeenCalledWith("https://github.com", "github", "ghp_test123", null);
    expect(await screen.findByTestId("git-hosting-notice")).toHaveTextContent(
      copy.notice.signedIn.replace("{{host}}", "GitHub").replace("{{login}}", "octocat"),
    );
    expect(screen.getByTestId("git-hosting-account-github.com")).toBeInTheDocument();
    expect(JSON.stringify(useForgeAccountsStore.getState())).not.toContain("ghp_test123");
  });

  it("signs in to GitHub in the browser and cancels on request", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect.mockResolvedValue(server("https://github.com", { kind: "github", deviceFlow: true }));
    mocks.forgeDeviceStart.mockResolvedValue(githubStart);
    mocks.forgeDevicePoll.mockResolvedValue({ status: "pending" });
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-github"));
    await user.click(await screen.findByTestId("git-hosting-sign-in-browser"));

    expect(await screen.findByTestId("git-hosting-device-code")).toHaveTextContent("ABCD-1234");
    expect(screen.getByText(copy.device.title.replace("{{host}}", "GitHub"))).toBeInTheDocument();
    expect(mocks.open).toHaveBeenCalledWith(githubStart.verificationUri);

    await user.click(screen.getByTestId("git-hosting-device-cancel"));
    expect(mocks.forgeDeviceCancel).toHaveBeenCalledWith("flow-1");
    expect(screen.queryByTestId("git-hosting-device-code")).not.toBeInTheDocument();
    expect(mocks.forgeSignInToken).not.toHaveBeenCalled();
  });

  it("adds the account once the browser sign-in finishes", async () => {
    vi.useFakeTimers();
    mocks.forgeDetect.mockResolvedValue(server("https://github.com", { kind: "github", deviceFlow: true }));
    mocks.forgeDeviceStart.mockResolvedValue(githubStart);
    const octocat = account("https://github.com", { kind: "github", login: "octocat", auth: "oauth" });
    mocks.forgeDevicePoll
      .mockResolvedValueOnce({ status: "slow_down", interval: 6 })
      .mockResolvedValue({ status: "done", account: octocat });
    try {
      render(<GitHostingSection />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("git-hosting-add"));
      fireEvent.click(screen.getByTestId("git-hosting-preset-github"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("git-hosting-sign-in-browser"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      // slow_down adds five seconds to the interval, whatever smaller
      // number the server names.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(mocks.forgeDevicePoll).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("git-hosting-notice")).toHaveTextContent(
        copy.notice.signedIn.replace("{{host}}", "GitHub").replace("{{login}}", "octocat"),
      );
      expect(useForgeAccountsStore.getState().accounts).toEqual([octocat]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps waiting through a failed poll instead of losing the approval", async () => {
    vi.useFakeTimers();
    mocks.forgeDetect.mockResolvedValue(server("https://github.com", { kind: "github", deviceFlow: true }));
    mocks.forgeDeviceStart.mockResolvedValue(githubStart);
    const octocat = account("https://github.com", { kind: "github", login: "octocat", auth: "oauth" });
    mocks.forgeDevicePoll
      .mockRejectedValueOnce(envelope("git.host_unreachable", { host: "GitHub" }))
      .mockResolvedValue({ status: "done", account: octocat });
    try {
      render(<GitHostingSection />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("git-hosting-add"));
      fireEvent.click(screen.getByTestId("git-hosting-preset-github"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("git-hosting-sign-in-browser"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByTestId("git-hosting-device-code")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(mocks.forgeDevicePoll).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("git-hosting-notice")).toHaveTextContent("octocat");
      expect(mocks.forgeDeviceCancel).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a failure that will not pass and lets the backend drop the flow", async () => {
    vi.useFakeTimers();
    mocks.forgeDetect.mockResolvedValue(server("https://github.com", { kind: "github", deviceFlow: true }));
    mocks.forgeDeviceStart.mockResolvedValue(githubStart);
    mocks.forgeDevicePoll.mockRejectedValue(envelope("git.sign_in_cancelled", { host: "GitHub" }));
    try {
      render(<GitHostingSection />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("git-hosting-add"));
      fireEvent.click(screen.getByTestId("git-hosting-preset-github"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("git-hosting-sign-in-browser"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByRole("alert")).toHaveTextContent(enErrors.git.sign_in_cancelled);
      expect(mocks.forgeDevicePoll).toHaveBeenCalledTimes(1);
      expect(mocks.forgeDeviceCancel).toHaveBeenCalledWith("flow-1");
      expect(screen.queryByTestId("git-hosting-device-code")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says that signing in replaces the account the server already has", async () => {
    const user = userEvent.setup();
    mocks.forgeAccountsList.mockResolvedValue([account("https://github.com", { kind: "github", login: "alice" })]);
    mocks.forgeDetect.mockImplementation(async (base: string) =>
      base === "https://github.com" ? server(base, { kind: "github" }) : server(base),
    );
    render(<GitHostingSection />);
    await screen.findByTestId("git-hosting-account-github.com");

    await user.click(screen.getByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-github"));
    expect(await screen.findByTestId("git-hosting-replaces")).toHaveTextContent(
      copy.add.replaces.replace("{{login}}", "alice").replace("{{host}}", "GitHub"),
    );
  });

  it("does not warn about replacing an account on a server that has none", async () => {
    const user = userEvent.setup();
    mocks.forgeAccountsList.mockResolvedValue([account("https://github.com", { kind: "github", login: "alice" })]);
    mocks.forgeDetect.mockResolvedValue(server("https://gitlab.com"));
    render(<GitHostingSection />);
    await screen.findByTestId("git-hosting-account-github.com");

    await user.click(screen.getByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-gitlab"));
    expect(await screen.findByTestId("git-hosting-token")).toBeInTheDocument();
    expect(screen.queryByTestId("git-hosting-replaces")).not.toBeInTheDocument();
  });

  it("offers GitHub Enterprise Server when detection cannot tell the server type", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect.mockResolvedValue(server("https://ghe.example.edu", { kind: null }));
    mocks.forgeSignInToken.mockResolvedValue(account("https://ghe.example.edu", { kind: "github" }));
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-other"));
    await user.type(screen.getByTestId("git-hosting-server-url"), "ghe.example.edu");
    await user.click(screen.getByTestId("git-hosting-server-continue"));
    expect(await screen.findByTestId("git-hosting-kind-github")).toHaveTextContent(copy.add.kindGithub);

    await user.click(screen.getByTestId("git-hosting-kind-github"));
    await user.type(screen.getByTestId("git-hosting-token"), "ghp_enterprise1");
    await user.click(screen.getByTestId("git-hosting-token-connect"));
    expect(mocks.forgeSignInToken).toHaveBeenCalledWith("https://ghe.example.edu", "github", "ghp_enterprise1", null);
  });

  it("sends the certificate file the account keeps, or an empty one after Remove", async () => {
    const user = userEvent.setup();
    const lab = account("https://example.org/gitlab", { caFile: "/certs/lab.pem" });
    mocks.forgeAccountsList.mockResolvedValue([lab]);
    mocks.forgeValidate.mockResolvedValue({ base: lab.base, state: "signed_out", account: lab });
    mocks.forgeDetect.mockResolvedValue(server(lab.base));
    mocks.forgeSignInToken.mockResolvedValue(lab);
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-sign-in-again-example.org/gitlab"));
    await user.type(await screen.findByTestId("git-hosting-token"), "glpat-first-token");
    await user.click(screen.getByTestId("git-hosting-token-connect"));
    expect(mocks.forgeSignInToken).toHaveBeenLastCalledWith(lab.base, "gitlab", "glpat-first-token", "/certs/lab.pem");

    mocks.forgeValidate.mockResolvedValue({ base: lab.base, state: "signed_out", account: lab });
    await act(async () => {
      await useForgeAccountsStore.getState().validateAll();
    });
    await user.click(await screen.findByTestId("git-hosting-sign-in-again-example.org/gitlab"));
    const panel = await screen.findByTestId("git-hosting-add-panel");
    await user.click(within(panel).getByRole("button", { name: copy.add.caRemove }));
    await user.type(await screen.findByTestId("git-hosting-token"), "glpat-second-token");
    await user.click(screen.getByTestId("git-hosting-token-connect"));
    expect(mocks.forgeSignInToken).toHaveBeenLastCalledWith(lab.base, "gitlab", "glpat-second-token", "");
  });

  it("offers only a token for gitlab.com when this build has no GitLab app", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect.mockResolvedValue(server("https://gitlab.com"));
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-gitlab"));
    expect(await screen.findByTestId("git-hosting-token")).toBeInTheDocument();
    expect(screen.queryByTestId("git-hosting-sign-in-browser")).not.toBeInTheDocument();
    expect(screen.getByText(copy.add.scopesGitlab, { exact: false })).toBeInTheDocument();

    await user.click(screen.getByTestId("git-hosting-token-page"));
    expect(mocks.open).toHaveBeenCalledWith(
      "https://gitlab.com/-/user_settings/personal_access_tokens?name=Oleafly&scopes=api,write_repository",
    );
  });

  it("detects a self-hosted server and links to its token page", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect.mockResolvedValue(server("https://git.example.org"));
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-other"));
    await user.type(screen.getByTestId("git-hosting-server-url"), "git.example.org");
    await user.click(screen.getByTestId("git-hosting-server-continue"));

    expect(mocks.forgeDetect).toHaveBeenCalledWith("git.example.org", null);
    await user.click(await screen.findByTestId("git-hosting-token-page"));
    expect(mocks.open).toHaveBeenCalledWith(
      "https://git.example.org/-/user_settings/personal_access_tokens?name=Oleafly&scopes=api,write_repository",
    );
  });

  it("asks for the server type when detection cannot tell", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect.mockResolvedValue(server("https://git.example.org", { kind: null }));
    mocks.forgeSignInToken.mockResolvedValue(account("https://git.example.org", { kind: "gitea" }));
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-other"));
    await user.type(screen.getByTestId("git-hosting-server-url"), "https://git.example.org");
    await user.click(screen.getByTestId("git-hosting-server-continue"));
    expect(await screen.findByTestId("git-hosting-kind")).toBeInTheDocument();

    await user.click(screen.getByTestId("git-hosting-kind-gitea"));
    await user.type(screen.getByTestId("git-hosting-token"), "gitea-token-1234");
    await user.click(screen.getByTestId("git-hosting-token-connect"));
    expect(mocks.forgeSignInToken).toHaveBeenCalledWith(
      "https://git.example.org",
      "gitea",
      "gitea-token-1234",
      null,
    );
  });

  it("offers a certificate file when the server's certificate is not trusted", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect
      .mockRejectedValueOnce(envelope("git.tls_failed", { host: "git.example.org" }))
      .mockResolvedValue(server("https://git.example.org"));
    mocks.pickOpenPath.mockResolvedValue("/certs/corp ca.pem");
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-other"));
    await user.type(screen.getByTestId("git-hosting-server-url"), "git.example.org");
    await user.click(screen.getByTestId("git-hosting-server-continue"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      enErrors.git.tls_failed.replace("{{host}}", "git.example.org"),
    );
    await user.click(screen.getByTestId("git-hosting-ca-choose"));
    expect(mocks.pickOpenPath).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [expect.objectContaining({ extensions: ["pem", "crt", "cer", "der"] })] }),
    );
    expect(mocks.forgeDetect).toHaveBeenLastCalledWith("git.example.org", "/certs/corp ca.pem");
    expect(await screen.findByTestId("git-hosting-token")).toBeInTheDocument();
  });

  it("checks every account when it opens and offers to sign in again", async () => {
    const user = userEvent.setup();
    const lab = account("https://example.org/gitlab", { caFile: "/certs/lab.pem" });
    mocks.forgeAccountsList.mockResolvedValue([lab]);
    mocks.forgeValidate.mockResolvedValue({ base: lab.base, state: "signed_out", account: lab });
    mocks.forgeDetect.mockResolvedValue(server(lab.base));
    render(<GitHostingSection />);

    expect(await screen.findByTestId("git-hosting-signed-out-example.org/gitlab")).toHaveTextContent(
      copy.account.signedOut,
    );
    await user.click(screen.getByTestId("git-hosting-sign-in-again-example.org/gitlab"));
    await waitFor(() => expect(mocks.forgeDetect).toHaveBeenCalledWith(lab.base, "/certs/lab.pem"));
    expect(await screen.findByTestId("git-hosting-token")).toBeInTheDocument();
  });

  it("shows translated errors, never the raw envelope", async () => {
    const user = userEvent.setup();
    mocks.forgeDetect.mockResolvedValue(server("https://gitlab.com"));
    mocks.forgeSignInToken.mockRejectedValue(envelope("git.forge_token_invalid", { host: "GitLab" }));
    render(<GitHostingSection />);

    await user.click(await screen.findByTestId("git-hosting-add"));
    await user.click(screen.getByTestId("git-hosting-preset-gitlab"));
    await user.type(await screen.findByTestId("git-hosting-token"), "glpat-wrong");
    await user.click(screen.getByTestId("git-hosting-token-connect"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(enErrors.git.forge_token_invalid);
    expect(alert.textContent).not.toContain("@oleafly/error");
  });
});

describe("GitHostingSection Git auto-init", () => {
  it("writes the Git auto-init switch back to the app config", async () => {
    const user = userEvent.setup();
    render(<GitHostingSection />);

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
    render(<GitHostingSection />);

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
    render(<GitHostingSection />);

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
    render(<GitHostingSection />);

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
    render(<GitHostingSection />);

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
    render(<GitHostingSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      enSettings.github.config.loadFailed,
    );
  });
});
