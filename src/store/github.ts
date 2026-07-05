import { create } from "zustand";
import {
  clearGithubToken,
  githubGetUser,
  saveGithubToken,
  type GitHubUser,
} from "@/lib/github";
import { getConfig } from "@/lib/tauri";
import { logError } from "@/lib/log";

/**
 * App-wide GitHub connection state. Per-machine single sign-on: one token,
 * reused by every project. The device-flow orchestration (showing the user
 * code, opening the browser, polling) lives in the UI; once a token is in
 * hand the UI calls `connectWithToken`.
 */
interface GithubState {
  status: "unknown" | "connected" | "disconnected";
  user: GitHubUser | null;
  loading: boolean;
  error: string | null;
  /** Read config; if a token is present, validate it and load the user. */
  refresh: () => Promise<void>;
  /** Validate + persist a token (OAuth or PAT) and mark connected. */
  connectWithToken: (token: string) => Promise<void>;
  /** Clear the token and mark disconnected. */
  disconnect: () => Promise<void>;
}

export const useGithubStore = create<GithubState>((set) => ({
  status: "unknown",
  user: null,
  loading: false,
  error: null,

  refresh: async () => {
    try {
      const cfg = await getConfig();
      if (!cfg.github_connected) {
        set({ status: "disconnected", user: null });
        return;
      }
      // Cached user is shown immediately; validate in the background.
      const cachedUser = cfg.github_user
        ? {
            login: cfg.github_user,
            name: null,
            avatar_url: "",
            html_url: `https://github.com/${cfg.github_user}`,
          }
        : null;
      set({ status: "connected", user: cachedUser });
      try {
        const user = await githubGetUser();
        set({ user });
      } catch {
        // Token present but invalid - treat as disconnected.
        set({ status: "disconnected", user: null });
      }
    } catch (e) {
      void logError("github refresh", e);
      set({ status: "disconnected", user: null });
    }
  },

  connectWithToken: async (token) => {
    set({ loading: true, error: null });
    try {
      // Validates + persists the token Rust-side and returns the resolved user.
      const user = await saveGithubToken(token);
      set({ status: "connected", user, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  disconnect: async () => {
    set({ loading: true });
    try {
      await clearGithubToken();
    } finally {
      set({ status: "disconnected", user: null, loading: false });
    }
  },
}));
