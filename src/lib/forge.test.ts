import { beforeEach, describe, expect, it, vi } from "vitest";
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
