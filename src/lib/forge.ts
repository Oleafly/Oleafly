import {
  ghPublicRepoStats,
  type ForgeAccount,
  type ForgeDevicePoll,
  type ForgeDeviceStart,
  type ForgeKind,
  type GitHubRepoStats,
} from "@/lib/tauri";

export type { GitHubRepoStats };

// Pure helpers for Git hosting accounts and remote addresses. This module sits
// in the entry chunk, so it stays small: no React, no store. The rules mirror
// crates/oleafly-forge (address.rs) and src-tauri/src/git.rs
// (is_allowed_remote_url), so the UI never offers what the backend refuses.

export type ForgePresetId = "github" | "gitlab" | "codeberg";

export const FORGE_PRESETS: readonly {
  id: ForgePresetId;
  base: string;
  kind: ForgeKind;
  label: string;
}[] = [
  { id: "github", base: "https://github.com", kind: "github", label: "GitHub" },
  { id: "gitlab", base: "https://gitlab.com", kind: "gitlab", label: "GitLab" },
  { id: "codeberg", base: "https://codeberg.org", kind: "gitea", label: "Codeberg" },
];

const HOSTED_LABELS: Record<string, string> = {
  "github.com": "GitHub",
  "gitlab.com": "GitLab",
  "codeberg.org": "Codeberg",
};

export interface ParsedRemote {
  protocol: "https" | "http" | "ssh" | "git";
  /** Lowercase. */
  host: string;
  /** Only a port the address names explicitly. */
  port: number | null;
  /** The repository path without leading or trailing slashes or `.git`. */
  path: string;
}

const REMOTE_PROTOCOLS = new Set(["https", "http", "ssh", "git"]);

function cleanPath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed.replace(/\.git$/, "").replace(/\/+$/, "");
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Parse `https://`, `http://`, `ssh://`, `git://` and scp-like
 * `user@host:path` remotes. Local paths, including Windows paths such as
 * `C:/Users/a@b/repo`, are not remotes. */
export function parseRemoteUrl(remote: string): ParsedRemote | null {
  const text = remote.trim();
  if (!text) return null;
  const schemeEnd = text.indexOf("://");
  if (schemeEnd >= 0) {
    const protocol = text.slice(0, schemeEnd).toLowerCase();
    if (!REMOTE_PROTOCOLS.has(protocol)) return null;
    const url = parseUrl(text);
    if (!url?.hostname) return null;
    return {
      protocol: protocol as ParsedRemote["protocol"],
      host: url.hostname.toLowerCase(),
      port: url.port ? Number(url.port) : null,
      path: cleanPath(url.pathname),
    };
  }
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const before = text.slice(0, colon);
  if (!before.includes("@") || before.includes("/") || before.includes("\\")) return null;
  const host = before.slice(before.lastIndexOf("@") + 1);
  if ([...host].length < 2) return null;
  return {
    protocol: "ssh",
    host: host.toLowerCase(),
    port: null,
    path: cleanPath(text.slice(colon + 1)),
  };
}

/** Whether Oleafly may set this address as a remote. Mirrors the Rust
 * `is_allowed_remote_url`: no `ext::`/`fd::` transport helpers, no `file://`,
 * scp-like addresses need a user and a host longer than a drive letter. */
export function isAllowedRemoteUrl(url: string): boolean {
  const text = url.trim();
  if (!text) return false;
  const doubleColon = text.indexOf("::");
  if (doubleColon >= 0 && !text.slice(0, doubleColon).includes("/")) return false;
  const schemeEnd = text.indexOf("://");
  if (schemeEnd >= 0) {
    return REMOTE_PROTOCOLS.has(text.slice(0, schemeEnd).toLowerCase());
  }
  const colon = text.indexOf(":");
  if (colon < 0) return false;
  const before = text.slice(0, colon);
  if (before.includes("/") || before.includes("\\")) return false;
  const at = before.lastIndexOf("@");
  return at >= 0 && [...before.slice(at + 1)].length > 1;
}

/** Whether an `http(s)` address carries a password. */
export function hasRemotePassword(url: string): boolean {
  const text = url.trim();
  const schemeEnd = text.indexOf("://");
  if (schemeEnd < 0) return false;
  const scheme = text.slice(0, schemeEnd).toLowerCase();
  if (scheme !== "http" && scheme !== "https") return false;
  const rest = text.slice(schemeEnd + 3);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf("@");
  return at >= 0 && authority.slice(0, at).includes(":");
}

/** The host and any non-default port of a URL, base or scp-like remote. */
function hostOf(urlOrBase: string): string | null {
  const text = urlOrBase.trim();
  if (text.includes("://")) {
    const url = parseUrl(text);
    if (!url?.hostname) return null;
    const host = url.hostname.toLowerCase();
    return url.port ? `${host}:${url.port}` : host;
  }
  return parseRemoteUrl(text)?.host ?? null;
}

/** GitHub, GitLab or Codeberg for the hosted services, else the host and any
 * non-default port. Matches the Rust `host_label`, so messages agree. */
export function hostLabel(urlOrBase: string): string {
  const host = hostOf(urlOrBase);
  if (!host) return urlOrBase.trim();
  return HOSTED_LABELS[host] ?? host;
}

export function kindLabel(account: Pick<ForgeAccount, "kind" | "flavor">): string {
  if (account.kind === "github") return "GitHub";
  if (account.kind === "gitlab") return "GitLab";
  return account.flavor === "forgejo" ? "Forgejo" : "Gitea";
}

/** The base without its scheme, for test ids and React keys. */
export function accountKey(base: string): string {
  return base.replace(/^[a-z]+:\/\//i, "");
}

function basePath(base: string): string {
  const url = parseUrl(base);
  return url ? url.pathname.replace(/\/+$/, "") : "";
}

function defaultPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "";
}

/** Whether an `http(s)` remote lies under a base: same scheme, host and
 * port, and the base path is a prefix segment by segment. */
function baseMatchesHttpRemote(base: string, remote: URL): boolean {
  const parsedBase = parseUrl(base);
  if (!parsedBase) return false;
  if (parsedBase.protocol !== remote.protocol) return false;
  if (parsedBase.hostname.toLowerCase() !== remote.hostname.toLowerCase()) return false;
  if (defaultPort(parsedBase) !== defaultPort(remote)) return false;
  const path = basePath(base);
  return !path || remote.pathname === path || remote.pathname.startsWith(`${path}/`);
}

/** The account a remote belongs to, for showing its avatar and host. HTTPS
 * remotes match like Git's credential scope (the longest base path wins);
 * SSH and git:// remotes match by host, since their paths never carry the
 * server's web path. */
export function matchAccount(
  remote: string | null | undefined,
  accounts: readonly ForgeAccount[],
): ForgeAccount | null {
  const text = (remote ?? "").trim();
  const parsed = parseRemoteUrl(text);
  if (!parsed || accounts.length === 0) return null;
  if (parsed.protocol === "https" || parsed.protocol === "http") {
    const url = parseUrl(text);
    if (!url) return null;
    let best: ForgeAccount | null = null;
    for (const account of accounts) {
      if (!baseMatchesHttpRemote(account.base, url)) continue;
      if (!best || basePath(account.base).length > basePath(best.base).length) best = account;
    }
    return best;
  }
  const sameHost = accounts.filter((account) => parseUrl(account.base)?.hostname.toLowerCase() === parsed.host);
  const underPath = sameHost.find((account) => {
    const path = basePath(account.base).replace(/^\//, "");
    return path && (parsed.path === path || parsed.path.startsWith(`${path}/`));
  });
  return underPath ?? sameHost[0] ?? null;
}

/** The repository's web page: HTTPS remotes lose any user name, password and
 * `.git`; SSH and git:// remotes use the matching account's base (keeping a
 * GitLab path prefix) or `https://host`. `null` when there is no path. */
export function remoteWebUrl(
  remote: string | null | undefined,
  accounts: readonly ForgeAccount[] = [],
): string | null {
  const text = (remote ?? "").trim();
  const parsed = parseRemoteUrl(text);
  if (!parsed?.path) return null;
  if (parsed.protocol === "https" || parsed.protocol === "http") {
    const url = parseUrl(text);
    if (!url) return null;
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}/${parsed.path}`;
  }
  const account = matchAccount(text, accounts);
  if (account) {
    const prefix = basePath(account.base).replace(/^\//, "");
    const path = prefix && parsed.path.startsWith(`${prefix}/`) ? parsed.path.slice(prefix.length + 1) : parsed.path;
    return `${account.base}/${path}`;
  }
  return `https://${parsed.host}/${parsed.path}`;
}

/** Each server's page for creating an access token. GitLab's newer form may
 * ignore the prefilled values, so the UI always names the scopes too. */
export function tokenPageUrl(base: string, kind: ForgeKind): string {
  if (kind === "github") {
    return `${base}/settings/tokens/new?description=Oleafly&scopes=repo,read:user`;
  }
  if (kind === "gitlab") {
    return `${base}/-/user_settings/personal_access_tokens?name=Oleafly&scopes=api,write_repository`;
  }
  return `${base}/user/settings/applications`;
}

export const TOKEN_PLACEHOLDER: Record<ForgeKind, string> = {
  github: "ghp_\u2026",
  gitlab: "glpat-\u2026",
  gitea: "",
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll a browser sign-in until it is granted, cancelled or past its
 * deadline. Returns the signed-in account, or null. */
export async function waitForDeviceSignIn(
  start: ForgeDeviceStart,
  poll: (flowId: string) => Promise<ForgeDevicePoll>,
  options: {
    cancelled: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<ForgeAccount | null> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  let wait = Math.max(start.interval, 5) * 1000;
  const deadline = now() + start.expiresIn * 1000 + 30_000;
  while (!options.cancelled() && now() < deadline) {
    await sleep(wait);
    if (options.cancelled()) return null;
    const result = await poll(start.flowId);
    if (options.cancelled()) return null;
    if (result.status === "done") return result.account;
    if (result.status === "slow_down") wait = Math.max(result.interval, 1) * 1000;
  }
  return null;
}

const publicRepoStatsCache = new Map<string, Promise<GitHubRepoStats>>();

/** Public star and fork counts for the About page, one request per
 * repository (retried after a failure). */
export function githubGetPublicRepoStats(fullName: string): Promise<GitHubRepoStats> {
  const cached = publicRepoStatsCache.get(fullName);
  if (cached) return cached;
  const request = ghPublicRepoStats(fullName).catch((error) => {
    publicRepoStatsCache.delete(fullName);
    throw error;
  });
  publicRepoStatsCache.set(fullName, request);
  return request;
}
