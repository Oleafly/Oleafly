import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfigCached: vi.fn(),
  githubGetUser: vi.fn(),
  saveGithubToken: vi.fn(),
  clearGithubToken: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/config-cache", () => ({ getConfigCached: mocks.getConfigCached }));
vi.mock("@/lib/github", () => ({
  githubGetUser: mocks.githubGetUser,
  saveGithubToken: mocks.saveGithubToken,
  clearGithubToken: mocks.clearGithubToken,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useGithubStore } from "./github";

const octocat = {
  login: "octocat",
  name: "The Octocat",
  avatar_url: "https://avatars.example/octocat.png",
  html_url: "https://github.com/octocat",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.logError.mockResolvedValue(undefined);
  useGithubStore.setState({ status: "unknown", user: null, loading: false, error: null });
});

describe("GitHub connection store", () => {
  it("is disconnected when no token is stored", async () => {
    mocks.getConfigCached.mockResolvedValue({ github_connected: false });

    await useGithubStore.getState().refresh();

    expect(useGithubStore.getState()).toMatchObject({ status: "disconnected", user: null });
    expect(mocks.githubGetUser).not.toHaveBeenCalled();
  });

  it("shows the cached login first and then the validated user", async () => {
    mocks.getConfigCached.mockResolvedValue({ github_connected: true, github_user: "octocat" });
    let resolveUser: (user: typeof octocat) => void = () => {};
    mocks.githubGetUser.mockReturnValue(new Promise((resolve) => (resolveUser = resolve)));

    const pending = useGithubStore.getState().refresh();
    await vi.waitFor(() => expect(mocks.githubGetUser).toHaveBeenCalled());

    expect(useGithubStore.getState()).toMatchObject({
      status: "connected",
      user: { login: "octocat", name: null, avatar_url: "", html_url: "https://github.com/octocat" },
    });

    resolveUser(octocat);
    await pending;
    expect(useGithubStore.getState().user).toEqual(octocat);
  });

  it("connects without a cached login and falls back to disconnected when the token is rejected", async () => {
    mocks.getConfigCached.mockResolvedValue({ github_connected: true, github_user: null });
    mocks.githubGetUser.mockRejectedValue(new Error("401"));

    await useGithubStore.getState().refresh();

    expect(useGithubStore.getState()).toMatchObject({ status: "disconnected", user: null });
  });

  it("logs a config read failure and reports disconnected", async () => {
    const failure = new Error("config unavailable");
    mocks.getConfigCached.mockRejectedValue(failure);

    await useGithubStore.getState().refresh();

    expect(useGithubStore.getState().status).toBe("disconnected");
    expect(mocks.logError).toHaveBeenCalledWith("github refresh", failure);
  });

  it("stores the user returned for a valid token", async () => {
    mocks.saveGithubToken.mockResolvedValue(octocat);

    await useGithubStore.getState().connectWithToken("ghp_test");

    expect(mocks.saveGithubToken).toHaveBeenCalledWith("ghp_test");
    expect(useGithubStore.getState()).toMatchObject({
      status: "connected",
      user: octocat,
      loading: false,
      error: null,
    });
  });

  it("shows the error and rethrows when a token is refused", async () => {
    mocks.saveGithubToken.mockRejectedValue(new Error("Bad credentials"));

    await expect(useGithubStore.getState().connectWithToken("ghp_bad")).rejects.toThrow("Bad credentials");

    expect(useGithubStore.getState()).toMatchObject({
      status: "unknown",
      loading: false,
      error: "Bad credentials",
    });
  });

  it("disconnects even when clearing the token fails", async () => {
    useGithubStore.setState({ status: "connected", user: octocat });
    mocks.clearGithubToken.mockRejectedValue(new Error("keychain locked"));

    await expect(useGithubStore.getState().disconnect()).rejects.toThrow("keychain locked");

    expect(useGithubStore.getState()).toMatchObject({ status: "disconnected", user: null, loading: false });
  });

  it("clears the stored token on disconnect", async () => {
    useGithubStore.setState({ status: "connected", user: octocat });
    mocks.clearGithubToken.mockResolvedValue(undefined);

    await useGithubStore.getState().disconnect();

    expect(mocks.clearGithubToken).toHaveBeenCalledTimes(1);
    expect(useGithubStore.getState().status).toBe("disconnected");
  });
});
