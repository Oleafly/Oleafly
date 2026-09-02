// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceControl } from "./SourceControl";

const mocks = vi.hoisted(() => ({
  gitAheadBehind: vi.fn(),
  gitCurrentBranch: vi.fn(),
  gitGetRemote: vi.fn(),
  gitCleanRemoteCredentials: vi.fn(),
  gitInitialize: vi.fn(),
  gitIsInitialized: vi.fn(),
  gitStatus: vi.fn(),
  gitRemoteCredentialsNeedCleanup: vi.fn(),
  refreshGitCount: vi.fn(),
}));

const fileState = {
  projectId: "project-1",
  projectName: "Research notes",
  refreshTree: vi.fn(),
  openFile: vi.fn(),
  pullFromGit: vi.fn(),
  discardFromGit: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign(
    (selector: (state: typeof fileState) => unknown) => selector(fileState),
    { getState: () => fileState },
  ),
}));

vi.mock("@/store/diff", () => ({
  useDiffStore: (selector: (state: { openDiff: () => void; clearActiveDiff: () => void }) => unknown) =>
    selector({ openDiff: vi.fn(), clearActiveDiff: vi.fn() }),
}));

vi.mock("@/store/git-status", () => ({
  useGitStatusStore: { getState: () => ({ refresh: mocks.refreshGitCount }) },
}));

vi.mock("@/store/github", () => ({
  useGithubStore: (selector: (state: { status: string; user: null }) => unknown) =>
    selector({ status: "disconnected", user: null }),
}));

vi.mock("@/components/integrations/PublishToGitHubDialog", () => ({
  PublishToGitHubDialog: () => null,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

vi.mock("@/lib/tauri", () => ({
  getConfig: vi.fn().mockResolvedValue({ github_connected: false }),
  gitAheadBehind: mocks.gitAheadBehind,
  gitCommit: vi.fn(),
  gitCurrentBranch: mocks.gitCurrentBranch,
  gitGetRemote: mocks.gitGetRemote,
  gitCleanRemoteCredentials: mocks.gitCleanRemoteCredentials,
  gitInitialize: mocks.gitInitialize,
  gitIsInitialized: mocks.gitIsInitialized,
  gitPush: vi.fn(),
  gitRemoveRemote: vi.fn(),
  gitRemoteCredentialsNeedCleanup: mocks.gitRemoteCredentialsNeedCleanup,
  gitStage: vi.fn(),
  gitStageAll: vi.fn(),
  gitStatus: mocks.gitStatus,
  gitUnstage: vi.fn(),
  gitUnstageAll: vi.fn(),
}));

beforeEach(() => {
  fileState.projectId = "project-1";
  fileState.projectName = "Research notes";
  fileState.refreshTree.mockReset().mockResolvedValue(undefined);
  fileState.openFile.mockReset().mockResolvedValue(undefined);
  fileState.pullFromGit.mockReset().mockResolvedValue("Pulled");
  fileState.discardFromGit.mockReset().mockResolvedValue(undefined);
  mocks.gitAheadBehind.mockReset().mockResolvedValue({
    ahead: 0,
    behind: 0,
    has_upstream: false,
  });
  mocks.gitCurrentBranch.mockReset().mockRejectedValue(new Error("not initialized"));
  mocks.gitGetRemote.mockReset().mockResolvedValue(null);
  mocks.gitCleanRemoteCredentials.mockReset().mockResolvedValue(true);
  mocks.gitInitialize.mockReset().mockResolvedValue("main");
  mocks.gitIsInitialized.mockReset().mockResolvedValue(false);
  mocks.gitStatus.mockReset().mockResolvedValue([]);
  mocks.gitRemoteCredentialsNeedCleanup.mockReset().mockResolvedValue(false);
  mocks.refreshGitCount.mockReset().mockResolvedValue(undefined);
});

describe("SourceControl", () => {
  it("keeps the current project's status when an older project refresh finishes last", async () => {
    const user = userEvent.setup();
    const slowOlderProjectStatus = deferred<
      Array<{ path: string; status: string; staged: boolean }>
    >();
    const slowRefreshStarted = deferred<void>();
    const currentProjectInitialization = deferred<boolean>();
    let projectARefreshes = 0;
    mocks.gitIsInitialized.mockImplementation((projectId: string) =>
      projectId === "project-b"
        ? currentProjectInitialization.promise
        : Promise.resolve(true),
    );
    mocks.gitStatus.mockImplementation((projectId: string) => {
      if (projectId === "project-b") {
        return Promise.resolve([
          { path: "project-b.tex", status: "M", staged: false },
        ]);
      }
      projectARefreshes += 1;
      if (projectARefreshes === 1) {
        return Promise.resolve([
          { path: "project-a.tex", status: "M", staged: false },
        ]);
      }
      slowRefreshStarted.resolve();
      return slowOlderProjectStatus.promise;
    });
    fileState.projectId = "project-a";
    const view = render(<SourceControl />);
    expect(await screen.findByText("project-a.tex")).toBeInTheDocument();
    expect(screen.getByTestId("source-control-actions")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await slowRefreshStarted.promise;

    fileState.projectId = "project-b";
    view.rerender(<SourceControl />);

    expect(screen.queryByText("project-a.tex")).not.toBeInTheDocument();
    expect(screen.queryByTestId("source-control-actions")).not.toBeInTheDocument();

    await act(async () => {
      currentProjectInitialization.resolve(true);
      await currentProjectInitialization.promise;
    });
    expect(await screen.findByText("project-b.tex")).toBeInTheDocument();

    await act(async () => {
      slowOlderProjectStatus.resolve([
        { path: "project-a.tex", status: "M", staged: false },
      ]);
      await slowOlderProjectStatus.promise;
    });

    expect(screen.getByText("project-b.tex")).toBeInTheDocument();
    expect(screen.queryByText("project-a.tex")).not.toBeInTheDocument();
  });

  it("binds pulls to the clicked project and ignores stale action completion", async () => {
    const user = userEvent.setup();
    const projectAPull = deferred<string>();
    const projectBPull = deferred<string>();
    mocks.gitIsInitialized.mockResolvedValue(true);
    mocks.gitCurrentBranch.mockResolvedValue("main");
    mocks.gitGetRemote.mockResolvedValue("https://github.com/oleafly/project.git");
    fileState.pullFromGit.mockImplementation((expectedProjectId: string) =>
      expectedProjectId === "project-a" ? projectAPull.promise : projectBPull.promise,
    );
    fileState.projectId = "project-a";
    const view = render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Pull from origin" }));
    expect(fileState.pullFromGit).toHaveBeenCalledWith("project-a");

    fileState.projectId = "project-b";
    view.rerender(<SourceControl />);
    const projectBPullButton = await screen.findByRole("button", {
      name: "Pull from origin",
    });
    expect(projectBPullButton).toBeEnabled();
    await user.click(projectBPullButton);
    expect(fileState.pullFromGit).toHaveBeenLastCalledWith("project-b");

    await act(async () => {
      projectAPull.resolve("Pulled project A");
      await projectAPull.promise;
    });

    expect(projectBPullButton).toBeDisabled();
    expect(screen.queryByText("Pulled project A")).not.toBeInTheDocument();

    await act(async () => {
      projectBPull.resolve("Pulled project B");
      await projectBPull.promise;
    });
    expect(await screen.findByText("Pulled project B")).toBeInTheDocument();
  });

  it("binds discard to the project whose row was confirmed", async () => {
    const user = userEvent.setup();
    mocks.gitIsInitialized.mockResolvedValue(true);
    mocks.gitCurrentBranch.mockResolvedValue("main");
    mocks.gitStatus.mockResolvedValue([
      { path: "main.tex", status: "M", staged: false },
    ]);
    render(<SourceControl />);

    await screen.findByText("main.tex");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("button", { name: "Confirm discard" }));

    await waitFor(() =>
      expect(fileState.discardFromGit).toHaveBeenCalledWith("project-1", "main.tex"),
    );
  });

  it("initializes Git only after the user chooses Initialize Repository", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    const initialize = await screen.findByRole("button", { name: "Initialize Repository" });
    expect(mocks.gitInitialize).not.toHaveBeenCalled();
    expect(mocks.gitStatus).not.toHaveBeenCalled();
    expect(mocks.gitCurrentBranch).not.toHaveBeenCalled();
    expect(mocks.gitAheadBehind).not.toHaveBeenCalled();
    expect(screen.queryByTestId("source-control-actions")).not.toBeInTheDocument();

    await user.click(initialize);

    await waitFor(() => expect(mocks.gitInitialize).toHaveBeenCalledWith("project-1"));
  });

  it("repairs a legacy credential only after the user chooses the repair action", async () => {
    const user = userEvent.setup();
    mocks.gitIsInitialized.mockResolvedValue(true);
    mocks.gitCurrentBranch.mockResolvedValue("main");
    mocks.gitRemoteCredentialsNeedCleanup.mockResolvedValue(true);
    render(<SourceControl />);

    const repair = await screen.findByRole("button", { name: "Remove saved credential" });
    expect(mocks.gitCleanRemoteCredentials).not.toHaveBeenCalled();

    await user.click(repair);

    await waitFor(() =>
      expect(mocks.gitCleanRemoteCredentials).toHaveBeenCalledWith("project-1"),
    );
  });
});
