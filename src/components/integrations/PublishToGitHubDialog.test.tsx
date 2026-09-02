// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGithubStore } from "@/store/github";
import { PublishToGitHubDialog } from "./PublishToGitHubDialog";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const createdRepo = {
  id: 1,
  name: "research-notes",
  full_name: "prajwal/research-notes",
  private: true,
  html_url: "https://github.com/prajwal/research-notes",
  clone_url: "https://github.com/prajwal/research-notes.git",
  default_branch: "main",
  updated_at: "2026-09-01T00:00:00Z",
};

const mocks = vi.hoisted(() => ({
  gitPreparePublish: vi.fn(),
  gitPush: vi.fn(),
  gitSetRemote: vi.fn(),
  githubCreateRepo: vi.fn(),
  githubListRepos: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  gitPreparePublish: mocks.gitPreparePublish,
  gitPush: mocks.gitPush,
  gitSetRemote: mocks.gitSetRemote,
}));

vi.mock("@/lib/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github")>()),
  githubCreateRepo: mocks.githubCreateRepo,
  githubListRepos: mocks.githubListRepos,
}));

beforeEach(() => {
  mocks.gitPreparePublish.mockReset().mockResolvedValue(true);
  mocks.gitPush.mockReset().mockResolvedValue("Pushed");
  mocks.gitSetRemote.mockReset().mockResolvedValue(undefined);
  mocks.githubCreateRepo.mockReset().mockResolvedValue(createdRepo);
  mocks.githubListRepos.mockResolvedValue([]);
  useGithubStore.setState({ status: "connected" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PublishToGitHubDialog", () => {
  it("does not let project A's publish completion update project B's dialog", async () => {
    const projectACreation = deferred<typeof createdRepo>();
    mocks.githubCreateRepo.mockReturnValueOnce(projectACreation.promise);
    const onPublished = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <PublishToGitHubDialog
        open
        onClose={onClose}
        projectId="project-a"
        projectName="Project A"
        onPublished={onPublished}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create and push" }));
    expect(screen.getByRole("button", { name: "Create and push" })).toBeDisabled();

    view.rerender(
      <PublishToGitHubDialog
        open
        onClose={onClose}
        projectId="project-b"
        projectName="Project B"
        onPublished={onPublished}
      />,
    );

    expect(screen.getByRole("button", { name: "Create and push" })).toBeEnabled();

    await act(async () => {
      projectACreation.resolve(createdRepo);
      await projectACreation.promise;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-a", "Initial commit");
    expect(mocks.gitSetRemote).toHaveBeenCalledWith(
      "project-a",
      createdRepo.clone_url,
    );
    expect(mocks.gitPush).toHaveBeenCalledWith("project-a");
    expect(onPublished).not.toHaveBeenCalled();
    expect(screen.queryByText(/Published to prajwal\/research-notes/)).toBeNull();
  });

  it("does not run project A's delayed close after project B opens", async () => {
    vi.useFakeTimers();
    const publishFinished = deferred<string>();
    mocks.gitPush.mockReturnValueOnce(publishFinished.promise);
    const onClose = vi.fn();
    const view = render(
      <PublishToGitHubDialog
        open
        onClose={onClose}
        projectId="project-a"
        projectName="Project A"
        onPublished={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create and push" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.gitPush).toHaveBeenCalledWith("project-a");

    await act(async () => {
      publishFinished.resolve("Pushed");
      await publishFinished.promise;
      await Promise.resolve();
    });

    view.rerender(
      <PublishToGitHubDialog
        open
        onClose={onClose}
        projectId="project-b"
        projectName="Project B"
        onPublished={vi.fn()}
      />,
    );
    act(() => vi.advanceTimersByTime(900));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("right-aligns the create action at the bottom of the form", () => {
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    const action = screen.getByRole("button", { name: "Create and push" });
    expect(action).toHaveClass("mt-auto", "ml-auto");
    expect(action).not.toHaveClass("w-full");

    const header = screen.getByRole("heading", { name: "Publish to GitHub" })
      .parentElement?.parentElement;
    expect(header).not.toHaveClass("border-b");
  });

  it("renders the repository search with a single outer border", async () => {
    const user = userEvent.setup();
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    const tabs = screen.getByRole("tablist");
    expect(tabs).toHaveClass("rounded-lg", "bg-muted", "p-1");
    expect(tabs.parentElement).toHaveClass("py-2");

    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    const search = screen.getByRole("textbox", { name: "Search repositories" });
    expect(search).toHaveClass("border-0", "focus-visible:ring-0");
    expect(search.parentElement).toHaveClass("border", "focus-within:ring-1");
  });

  it("prepares Git only after the user chooses Create and push", async () => {
    const user = userEvent.setup();
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-1", "Initial commit");
  });
});
