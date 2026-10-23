import { beforeEach, describe, expect, it, vi } from "vitest";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import { describeError } from "@/lib/app-error";
import type { ForgeAccount, ForgeDevicePoll, ForgeDeviceStart } from "@/lib/tauri";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true, Channel: class {} }));

import {
  FORGE_PRESETS,
  accountKey,
  githubGetPublicRepoStats,
  hasRemotePassword,
  hostLabel,
  isAllowedRemoteUrl,
  kindLabel,
  matchAccount,
  parseRemoteUrl,
  remoteWebUrl,
  TOKEN_PLACEHOLDER,
  tokenPageUrl,
  waitForDeviceSignIn,
} from "./forge";

function account(base: string, overrides: Partial<ForgeAccount> = {}): ForgeAccount {
  return { base, kind: "gitlab", login: "octo", auth: "token", addedAt: 1, ...overrides };
}

// The same rows as crates/oleafly-forge/src/address.rs. "credential" is the
// Rust rule that decides who gets a token; "ui" is the avatar and host shown.
const MATCH_TABLE: [string, string, boolean, boolean][] = [
  ["https://gitlab.com", "https://gitlab.com/group/sub/paper.git", true, true],
  ["https://gitlab.com", "https://GITLAB.com:443/group/paper.git", true, true],
  ["https://gitlab.com", "https://user:pw@gitlab.com/g/p.git", true, true],
  ["https://gitlab.com", "http://gitlab.com/g/p.git", false, false],
  ["https://gitlab.com", "https://gitlab.com.evil.org/g/p.git", false, false],
  ["https://gitlab.com", "https://evil.org/gitlab.com/g/p.git", false, false],
  ["https://example.org/gitlab", "https://example.org/gitlab/g/p.git", true, true],
  ["https://example.org/gitlab", "https://example.org/gitlab-old/g/p.git", false, false],
  ["https://example.org/gitlab", "https://example.org/g/p.git", false, false],
  ["http://192.168.1.10:3000", "http://192.168.1.10:3000/o/r.git", true, true],
  ["http://192.168.1.10:3000", "http://192.168.1.10/o/r.git", false, false],
  ["https://gitlab.com", "git@gitlab.com:g/p.git", false, true],
  ["https://example.org/gitlab", "ssh://git@example.org:2222/g/p.git", false, true],
];

beforeEach(() => {
  invoke.mockReset();
});

describe("matchAccount", () => {
  it.each(MATCH_TABLE)("matches %s against %s", (base, remote, _credential, ui) => {
    expect(matchAccount(remote, [account(base)])?.base ?? null).toBe(ui ? base : null);
  });

  it("prefers the account with the longest base path", () => {
    const accounts = [account("https://example.org"), account("https://example.org/gitlab")];
    expect(matchAccount("https://example.org/gitlab/g/p.git", accounts)?.base).toBe(
      "https://example.org/gitlab",
    );
    expect(matchAccount("https://example.org/other/p.git", accounts)?.base).toBe(
      "https://example.org",
    );
  });

  it("matches nothing without a remote or accounts", () => {
    expect(matchAccount(null, [account("https://gitlab.com")])).toBeNull();
    expect(matchAccount("https://gitlab.com/g/p.git", [])).toBeNull();
  });
});

describe("parseRemoteUrl", () => {
  it("parses https, scp, ssh and git remotes and refuses Windows paths", () => {
    expect(parseRemoteUrl("git@gitlab.com:group/sub/paper.git")).toEqual({
      protocol: "ssh",
      host: "gitlab.com",
      port: null,
      path: "group/sub/paper",
    });
    expect(parseRemoteUrl("ssh://git@host.org:2222/o/r.git")?.port).toBe(2222);
    expect(parseRemoteUrl("https://user:pw@GitLab.com/g/p.git")).toEqual({
      protocol: "https",
      host: "gitlab.com",
      port: null,
      path: "g/p",
    });
    expect(parseRemoteUrl("git://host.org/o/r")?.protocol).toBe("git");
    for (const path of ["C:\\Users\\a@b\\repo", "C:/Users/a@b/repo", "\\\\srv\\share@x:y", "relative/path", ""]) {
      expect(parseRemoteUrl(path)).toBeNull();
    }
  });
});

describe("remote address checks", () => {
  it("allows the same remote addresses as the Rust check", () => {
    for (const allowed of [
      "git@github.com:o/r.git",
      "ssh://git@host:22/o/r.git",
      "https://host.org/o/r.git",
      "http://192.168.1.10:3000/o/r.git",
      "me@nas:paper",
    ]) {
      expect(isAllowedRemoteUrl(allowed), allowed).toBe(true);
    }
    for (const refused of [
      "C:/Users/a@b/repo",
      "C:\\Users\\a@b\\repo",
      "\\\\srv\\share@x:y",
      "ext::sh -c x",
      "fd::17",
      "file:///etc/passwd",
      "host.org:o/r.git",
      "git@h:o/r",
      "",
      "   ",
    ]) {
      expect(isAllowedRemoteUrl(refused), refused).toBe(false);
    }
  });

  it("spots a password in a remote address", () => {
    expect(hasRemotePassword("https://u:pw@h.org/x.git")).toBe(true);
    expect(hasRemotePassword("https://u@h.org/x.git")).toBe(false);
    expect(hasRemotePassword("git@h.org:o/r.git")).toBe(false);
    expect(hasRemotePassword("https://h.org/x.git?a=b:c@d")).toBe(false);
  });

  it("spots an access token in the user name position and keeps ordinary user names", () => {
    // The same rows as `has_remote_password` in git.rs.
    for (const token of [
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "gho_abc",
      "ghu_abc",
      "ghs_abc",
      "github_pat_11AAAA",
      "glpat-AbCd_1234-xyz",
      "gloas-abc",
      "0123456789abcdef0123456789abcdef01234567",
      "abcdefghijklmnopqrst",
    ]) {
      expect(hasRemotePassword(`https://${token}@github.com/o/r.git`), token).toBe(true);
      expect(hasRemotePassword(`http://${token}@h.org/o/r.git`), token).toBe(true);
    }
    for (const user of ["u", "octocat", "zoe-q", "first.last", "me%40corp.example", "abcdefghijklmnopqrs"]) {
      expect(hasRemotePassword(`https://${user}@h.org/o/r.git`), user).toBe(false);
    }
    // SSH user names are not credentials.
    expect(hasRemotePassword("ssh://ghp_abcdefghijklmnopqrstuvwxyz@h.org/o/r.git")).toBe(false);
    expect(hasRemotePassword("ghp_abcdefghijklmnopqrstuvwxyz@h.org:o/r.git")).toBe(false);
  });
});

describe("remoteWebUrl", () => {
  it("builds the web address of a remote", () => {
    expect(remoteWebUrl("https://x-access-token:tok@github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
    expect(remoteWebUrl("ssh://git@github.com:22/owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(remoteWebUrl("git@example.org:group/repo.git", [account("https://example.org/gitlab")])).toBe(
      "https://example.org/gitlab/group/repo",
    );
    expect(remoteWebUrl("not a url")).toBeNull();
  });

  it("keeps every case of the GitHub-only helper it replaced", () => {
    expect(remoteWebUrl("git@github.com:owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(remoteWebUrl("ssh://git@github.com/owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(remoteWebUrl("ssh://github.com/owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(remoteWebUrl("https://github.com/owner/repo")).toBe("https://github.com/owner/repo");
    expect(remoteWebUrl(null)).toBeNull();
    expect(remoteWebUrl("")).toBeNull();
  });

  it("keeps plain http and non-default ports", () => {
    expect(remoteWebUrl("http://192.168.1.10:3000/o/r.git")).toBe("http://192.168.1.10:3000/o/r");
    expect(remoteWebUrl("https://git.example.org:8443/lab/paper/")).toBe(
      "https://git.example.org:8443/lab/paper",
    );
  });
});

describe("labels", () => {
  it("labels known hosts by name and others by host and port", () => {
    expect(hostLabel("https://github.com")).toBe("GitHub");
    expect(hostLabel("git@gitlab.com:g/p.git")).toBe("GitLab");
    expect(hostLabel("https://codeberg.org/me/paper.git")).toBe("Codeberg");
    expect(hostLabel("https://git.example.org:8443/x")).toBe("git.example.org:8443");
    expect(hostLabel("https://example.org/gitlab")).toBe("example.org");
  });

  it("names each server kind and keys accounts without the scheme", () => {
    expect(kindLabel({ kind: "github" })).toBe("GitHub");
    expect(kindLabel({ kind: "gitlab" })).toBe("GitLab");
    expect(kindLabel({ kind: "gitea" })).toBe("Gitea");
    expect(kindLabel({ kind: "gitea", flavor: "forgejo" })).toBe("Forgejo");
    expect(accountKey("https://github.com")).toBe("github.com");
    expect(accountKey("https://example.org/gitlab")).toBe("example.org/gitlab");
    expect(FORGE_PRESETS.map((preset) => preset.id)).toEqual(["github", "gitlab", "codeberg"]);
    expect(TOKEN_PLACEHOLDER.gitea).toBe("");
  });

  it("links to each server's token page", () => {
    expect(tokenPageUrl("https://github.com", "github")).toBe(
      "https://github.com/settings/tokens/new?description=Oleafly&scopes=repo,read:user",
    );
    expect(tokenPageUrl("https://example.org/gitlab", "gitlab")).toBe(
      "https://example.org/gitlab/-/user_settings/personal_access_tokens?name=Oleafly&scopes=api,write_repository",
    );
    expect(tokenPageUrl("https://codeberg.org", "gitea")).toBe(
      "https://codeberg.org/user/settings/applications",
    );
  });
});

describe("waitForDeviceSignIn", () => {
  const start: ForgeDeviceStart = {
    flowId: "flow-1",
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    verificationUriComplete: null,
    expiresIn: 900,
    interval: 5,
  };

  it("polls a device sign-in until it is granted", async () => {
    const replies: ForgeDevicePoll[] = [
      { status: "pending" },
      { status: "slow_down", interval: 10 },
      { status: "done", account: account("https://github.com", { kind: "github" }) },
    ];
    const poll = vi.fn(async () => replies.shift() as ForgeDevicePoll);
    const sleeps: number[] = [];
    const result = await waitForDeviceSignIn(start, poll, {
      cancelled: () => false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
    });
    expect(result?.base).toBe("https://github.com");
    expect(sleeps).toEqual([5000, 5000, 10000]);
    expect(poll).toHaveBeenCalledWith("flow-1");
  });

  it("adds five seconds at every slow_down, even when the server names no interval", async () => {
    const replies: ForgeDevicePoll[] = [
      { status: "slow_down", interval: 5 },
      { status: "slow_down", interval: 5 },
      { status: "done", account: account("https://gitlab.com") },
    ];
    const sleeps: number[] = [];
    await waitForDeviceSignIn(start, async () => replies.shift() as ForgeDevicePoll, {
      cancelled: () => false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
    });
    expect(sleeps).toEqual([5000, 10_000, 15_000]);
  });

  it("tries again after a network or server failure instead of losing the approval", async () => {
    const unreachable = new Error('@oleafly/error:{"code":"git.host_unreachable","params":{"host":"GitHub"}}');
    const server = new Error('@oleafly/error:{"code":"git.forge_server_error","params":{"host":"GitHub","status":"502"}}');
    const replies: (ForgeDevicePoll | Error)[] = [
      unreachable,
      server,
      { status: "pending" },
      unreachable,
      { status: "done", account: account("https://github.com", { kind: "github" }) },
    ];
    const poll = vi.fn(async () => {
      const reply = replies.shift() as ForgeDevicePoll | Error;
      if (reply instanceof Error) throw reply;
      return reply;
    });
    const result = await waitForDeviceSignIn(start, poll, {
      cancelled: () => false,
      sleep: async () => {},
      now: () => 0,
    });
    expect(result?.base).toBe("https://github.com");
    expect(poll).toHaveBeenCalledTimes(5);
  });

  it("gives up after too many failures in a row, and at once for any other failure", async () => {
    const unreachable = new Error('@oleafly/error:{"code":"git.host_unreachable","params":{}}');
    const always = vi.fn(async (): Promise<ForgeDevicePoll> => {
      throw unreachable;
    });
    await expect(
      waitForDeviceSignIn(start, always, { cancelled: () => false, sleep: async () => {}, now: () => 0 }),
    ).rejects.toBe(unreachable);
    expect(always).toHaveBeenCalledTimes(6);

    const denied = new Error('@oleafly/error:{"code":"git.sign_in_cancelled","params":{}}');
    const once = vi.fn(async (): Promise<ForgeDevicePoll> => {
      throw denied;
    });
    await expect(
      waitForDeviceSignIn(start, once, { cancelled: () => false, sleep: async () => {}, now: () => 0 }),
    ).rejects.toBe(denied);
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("stops polling when cancelled or past the deadline", async () => {
    let cancelled = false;
    const poll = vi.fn(async (): Promise<ForgeDevicePoll> => {
      cancelled = true;
      return { status: "pending" };
    });
    await expect(
      waitForDeviceSignIn(start, poll, { cancelled: () => cancelled, sleep: async () => {}, now: () => 0 }),
    ).resolves.toBeNull();
    expect(poll).toHaveBeenCalledTimes(1);

    let clock = 0;
    const late = vi.fn(async (): Promise<ForgeDevicePoll> => ({ status: "pending" }));
    await expect(
      waitForDeviceSignIn(start, late, {
        cancelled: () => false,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).resolves.toBeNull();
    expect(clock).toBeGreaterThanOrEqual(900 * 1000 + 30_000);
  });
});

describe("Git errors that name the account", () => {
  const envelope = (code: string, params: Record<string, string>) =>
    `@oleafly/error:${JSON.stringify({ code, params })}`;

  it("names the account in a refusal when the backend knows which sign-in it used", () => {
    const params = { host: "GitHub", account: "octocat@github.com" };
    const denied = describeError(envelope("git.access_denied", { ...params, context: "account" }));
    expect(denied).toBe(
      enErrors.git.access_denied_account.replace("{{host}}", "GitHub").replace("{{account}}", "octocat@github.com"),
    );
    expect(denied).toContain("octocat@github.com");
    expect(denied).not.toContain("{{");

    const rejected = describeError(envelope("git.auth_rejected", params));
    expect(rejected).toContain("octocat@github.com");
    expect(rejected).not.toContain("{{");
  });

  it("keeps the plain refusal when Git used its own sign-in", () => {
    const denied = describeError(envelope("git.access_denied", { host: "GitHub" }));
    expect(denied).toBe(enErrors.git.access_denied.replace("{{host}}", "GitHub"));
  });
});

describe("public repository stats cache", () => {
  it("reuses one request per repository and retries after a failure", async () => {
    invoke.mockRejectedValueOnce(new Error("rate limited"));
    await expect(githubGetPublicRepoStats("acme/flaky")).rejects.toThrow("rate limited");
    invoke.mockResolvedValue({ stars: 1, forks: 2 });
    const first = githubGetPublicRepoStats("acme/flaky");
    const second = githubGetPublicRepoStats("acme/flaky");
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ stars: 1, forks: 2 });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("gh_public_repo_stats", { fullName: "acme/flaky" });
  });
});
