import { invoke } from "@tauri-apps/api/core";
import {
  ghCurrentUser,
  ghSetToken,
  ghClearToken,
  ghListRepos,
  ghCreateRepo,
  type GitHubUser,
  type GitHubRepo,
} from "@/lib/tauri";

export type { GitHubUser, GitHubRepo };

// The GitHub token lives only in the Rust core. Every authenticated call below
// delegates to a Tauri command that reads the token server-side, so the webview
// never holds the secret (an XSS can't read or exfiltrate it).

export function githubGetUser(): Promise<GitHubUser> {
  return ghCurrentUser();
}

export function githubCreateRepo(name: string, isPrivate: boolean): Promise<GitHubRepo> {
  return ghCreateRepo(name, isPrivate);
}

// Most recently updated first.
export function githubListRepos(): Promise<GitHubRepo[]> {
  return ghListRepos();
}

export function saveGithubToken(token: string): Promise<GitHubUser> {
  return ghSetToken(token);
}

export function clearGithubToken(): Promise<void> {
  return ghClearToken();
}

// --- OAuth device flow ---
//
// The Client ID is public and safe to ship in the binary. Device flow needs no
// client secret, which makes it the right choice for a desktop app. Forks can
// override at build time with VITE_GITHUB_CLIENT_ID.
export const GITHUB_OAUTH_CLIENT_ID =
  import.meta.env.VITE_GITHUB_CLIENT_ID ?? "Ov23li4f2jpz7iBljiYT";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

// NOTE: the device-flow endpoints (`github.com/login/device/code` and
// `/login/oauth/access_token`) are not CORS-enabled, so the requests run on the
// Rust side (src-tauri/src/github.rs) and are invoked here. The `scope`
// (`repo read:user`) is set in Rust.

export async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  return invoke<DeviceCode>("gh_request_device_code", { clientId });
}

// The frontend loops, calling `checkDeviceToken`.
export type TokenPoll =
  | { status: "token"; token: string }
  | { status: "pending" }
  | { status: "slow_down"; interval: number };

// A SINGLE token check (the Rust command is async + short so it never blocks
// the webview). The frontend runs the poll loop so it stays cancellable.
export async function checkDeviceToken(
  clientId: string,
  deviceCode: string
): Promise<TokenPoll> {
  const r = await invoke<{
    status: string;
    token: string | null;
    interval: number | null;
  }>("gh_check_device_token", { clientId, deviceCode });
  if (r.status === "token" && r.token) return { status: "token", token: r.token };
  if (r.status === "slow_down" && r.interval) return { status: "slow_down", interval: r.interval };
  return { status: "pending" };
}
