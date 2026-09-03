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
  logError: vi.fn(),
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

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
  mocks.githubListRepos.mockReset().mockResolvedValue([]);
  mocks.logError.mockReset().mockResolvedValue(undefined);
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

  it("links the selected repository, pushes, and dismisses itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.githubListRepos.mockResolvedValue([createdRepo]);
    const onClose = vi.fn();
    const onPublished = vi.fn();
    render(
      <PublishToGitHubDialog
        open
        onClose={onClose}
        projectId="project-1"
        projectName="Research notes"
        onPublished={onPublished}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/Linked and pushed to/)).toBeInTheDocument();
    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-1", "Initial commit");
    expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.clone_url);
    expect(mocks.gitPush).toHaveBeenCalledWith("project-1");
    expect(onPublished).toHaveBeenCalledWith(createdRepo.clone_url);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("records the remote but asks for a pull when the first push is rejected", async () => {
    const user = userEvent.setup();
    mocks.githubListRepos.mockResolvedValue([createdRepo]);
    mocks.gitPush.mockRejectedValue(new Error("fetch first"));
    const onClose = vi.fn();
    const onPublished = vi.fn();
    render(
      <PublishToGitHubDialog
        open
        onClose={onClose}
        projectId="project-1"
        projectName="Research notes"
        onPublished={onPublished}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/push needs a pull first/)).toBeInTheDocument();
    expect(onPublished).toHaveBeenCalledWith(createdRepo.clone_url);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Link and push" })).toBeEnabled();
  });

  it("reports a remote that could not be set at all", async () => {
    const user = userEvent.setup();
    mocks.githubListRepos.mockResolvedValue([createdRepo]);
    mocks.gitSetRemote.mockRejectedValue(new Error("not a git repository"));
    const onPublished = vi.fn();
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={onPublished}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/not a git repository/)).toBeInTheDocument();
    expect(mocks.gitPush).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
  });

  it("reports a repository that GitHub refused to create", async () => {
    const user = userEvent.setup();
    mocks.githubCreateRepo.mockRejectedValue(new Error("name already exists"));
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText(/name already exists/)).toBeInTheDocument();
    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
  });

  it("keeps the empty list and logs when the repository read fails", async () => {
    const user = userEvent.setup();
    mocks.githubListRepos.mockRejectedValue(new Error("bad credentials"));
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    expect(await screen.findByText("No repositories found.")).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalledWith("github list repos", expect.any(Error));
    expect(screen.getByRole("button", { name: "Link and push" })).toBeDisabled();
  });

  it("mounts the overlay on the document body so it covers the whole window", () => {
    const view = render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    expect(overlay).toHaveClass("fixed", "inset-0", "z-[85]");
    expect(overlay.parentElement).toBe(document.body);
    expect(view.container.contains(overlay)).toBe(false);
  });

  it("leaves the document body untouched while it is closed", () => {
    const view = render(
      <PublishToGitHubDialog
        open={false}
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.container).toBeEmptyDOMElement();
  });

  it("reads no repositories while GitHub is disconnected", async () => {
    useGithubStore.setState({ status: "disconnected" });
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Connect to GitHub" })).toBeInTheDocument();
    expect(mocks.githubListRepos).not.toHaveBeenCalled();
  });
});
