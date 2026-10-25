// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import type { ForgeAccount, ForgeRepo, ForgeRepoPage } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({ forgeListRepos: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/tauri", () => ({ forgeListRepos: mocks.forgeListRepos }));

import { ForgeRepoList } from "./ForgeRepoList";

const github: ForgeAccount = { base: "https://github.com", kind: "github", login: "octo", auth: "oauth", addedAt: 1 };

function repo(fullName: string): ForgeRepo {
  return {
    id: fullName,
    fullName,
    name: fullName.split("/").pop() ?? fullName,
    webUrl: `https://github.com/${fullName}`,
    cloneUrl: `https://github.com/${fullName}.git`,
    private: false,
    defaultBranch: "main",
  };
}

function page(repos: ForgeRepo[], nextPage: number | null = null): ForgeRepoPage {
  return { repos, nextPage, searched: false };
}

const copy = enLibrary.import;
const search = () => screen.getByRole("textbox", { name: enLibrary.github.searchRepositories });

beforeEach(() => {
  mocks.forgeListRepos.mockReset().mockResolvedValue(page([]));
  mocks.logError.mockReset().mockResolvedValue(undefined);
});

describe("ForgeRepoList", () => {
  it("says the search only covered the loaded pages, and finds a repository once more are loaded", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos
      .mockResolvedValueOnce(page([repo("octo/paper")], 2))
      .mockResolvedValueOnce(page([repo("octo/thesis")]));
    render(<ForgeRepoList account={github} onSelect={vi.fn()} />);
    await screen.findByText("octo/paper");

    await user.type(search(), "thesis");

    expect(screen.getByText(copy.noMatchLoaded)).toBeInTheDocument();
    expect(screen.queryByText(enLibrary.github.noRepositories)).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.loadMore }));

    expect(await screen.findByText("octo/thesis")).toBeInTheDocument();
    expect(screen.queryByText(copy.noMatchLoaded)).toBeNull();
    expect(mocks.forgeListRepos).toHaveBeenLastCalledWith(github.base, 2, null);
  });

  it("says no repository matches when every page is loaded", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([repo("octo/paper")]));
    render(<ForgeRepoList account={github} onSelect={vi.fn()} />);
    await screen.findByText("octo/paper");

    await user.type(search(), "zzz");

    expect(screen.getByText(enLibrary.github.noRepositories)).toBeInTheDocument();
    expect(screen.queryByText(copy.noMatchLoaded)).toBeNull();
  });

  it("keeps the loaded repositories when a later page fails and retries that page", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos
      .mockResolvedValueOnce(page([repo("octo/paper")], 2))
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce(page([repo("octo/notes")]));
    render(<ForgeRepoList account={github} onSelect={vi.fn()} />);
    await screen.findByText("octo/paper");

    await user.click(screen.getByRole("button", { name: copy.loadMore }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.repositoriesFailed);
    expect(screen.getByText("octo/paper")).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalledWith("forge list repos", expect.any(Error));

    await user.click(screen.getByRole("button", { name: copy.tryAgain }));

    expect(await screen.findByText("octo/notes")).toBeInTheDocument();
    expect(screen.getByText("octo/paper")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // The retry asked for the page that failed, not the first one again.
    expect(mocks.forgeListRepos.mock.calls.map(([, requested]) => requested)).toEqual([1, 2, 2]);
  });

  it("restarts from the first page when the list could not start", async () => {
    mocks.forgeListRepos.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(page([repo("octo/paper")]));
    render(<ForgeRepoList account={github} onSelect={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.repositoriesFailed);
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.tryAgain }));

    expect(await screen.findByText("octo/paper")).toBeInTheDocument();
    await waitFor(() => expect(mocks.forgeListRepos).toHaveBeenCalledTimes(2));
  });

  it("searches GitLab on the server after a short pause", async () => {
    const user = userEvent.setup();
    const gitlab: ForgeAccount = { base: "https://gitlab.com", kind: "gitlab", login: "zoe", auth: "token", addedAt: 2 };
    mocks.forgeListRepos.mockResolvedValue({ repos: [], nextPage: null, searched: true });
    render(<ForgeRepoList account={gitlab} onSelect={vi.fn()} />);

    await user.type(search(), "thesis");

    await waitFor(() => expect(mocks.forgeListRepos).toHaveBeenLastCalledWith(gitlab.base, 1, "thesis"));
  });
});
