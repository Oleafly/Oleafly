import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the Tauri IPC bridge so we can assert which command each wrapper calls.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import {
  githubCreateRepo,
  githubImportRepo,
  githubGetPublicRepoStats,
  githubListRepos,
  githubGetUser,
  saveGithubToken,
  clearGithubToken,
  requestDeviceCode,
} from "./github";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("github.ts command bindings", () => {
  it("githubCreateRepo maps to gh_create_repo with the private flag", async () => {
    invoke.mockResolvedValue({ full_name: "u/r", clone_url: "c", html_url: "h", private: true });
    await githubCreateRepo("my-repo", true);
    expect(invoke).toHaveBeenCalledWith("gh_create_repo", { name: "my-repo", private: true });
  });

  it("githubListRepos calls gh_list_repos", async () => {
    invoke.mockResolvedValue([]);
    await githubListRepos();
    expect(invoke).toHaveBeenCalledWith("gh_list_repos");
  });

  it("githubImportRepo passes the selected repository name to the native importer", async () => {
    invoke.mockResolvedValue("imported-project");
    await expect(githubImportRepo("oleafly/example-paper")).resolves.toBe(
      "imported-project",
    );
    expect(invoke).toHaveBeenCalledWith("gh_import_repo", {
      fullName: "oleafly/example-paper",
    });
  });

  it("githubGetPublicRepoStats loads public star and fork counts through Rust", async () => {
    invoke.mockResolvedValue({ stars: 42, forks: 7 });

    await expect(
      githubGetPublicRepoStats("Oleafly/Oleafly"),
    ).resolves.toEqual({ stars: 42, forks: 7 });
    expect(invoke).toHaveBeenCalledWith("gh_public_repo_stats", {
      fullName: "Oleafly/Oleafly",
    });
  });

  it("githubGetUser calls gh_current_user and takes NO token argument", async () => {
    invoke.mockResolvedValue({ login: "octocat" });
    await githubGetUser();
    expect(invoke).toHaveBeenCalledWith("gh_current_user");
    // The token must never be passed from the webview.
    expect(invoke.mock.calls[0]).toHaveLength(1);
  });

  it("saveGithubToken validates+stores via gh_set_token (token stays server-side)", async () => {
    invoke.mockResolvedValue({ login: "octocat" });
    await saveGithubToken("ghp_secret");
    expect(invoke).toHaveBeenCalledWith("gh_set_token", { token: "ghp_secret" });
  });

  it("clearGithubToken calls gh_clear_token", async () => {
    await clearGithubToken();
    expect(invoke).toHaveBeenCalledWith("gh_clear_token");
  });

  it("requestDeviceCode forwards the client id to the OAuth command", async () => {
    invoke.mockResolvedValue({ device_code: "d", user_code: "U", verification_uri: "v", expires_in: 900, interval: 5 });
    await requestDeviceCode("client-123");
    expect(invoke).toHaveBeenCalledWith("gh_request_device_code", { clientId: "client-123" });
  });
});
