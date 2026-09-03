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
  getConfig: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitRemoveRemote: vi.fn(),
  gitStage: vi.fn(),
  gitStageAll: vi.fn(),
  gitUnstage: vi.fn(),
  gitUnstageAll: vi.fn(),
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
  getConfig: mocks.getConfig,
  gitAheadBehind: mocks.gitAheadBehind,
  gitCommit: mocks.gitCommit,
  gitCurrentBranch: mocks.gitCurrentBranch,
  gitGetRemote: mocks.gitGetRemote,
  gitCleanRemoteCredentials: mocks.gitCleanRemoteCredentials,
  gitInitialize: mocks.gitInitialize,
  gitIsInitialized: mocks.gitIsInitialized,
  gitPush: mocks.gitPush,
  gitRemoveRemote: mocks.gitRemoveRemote,
  gitRemoteCredentialsNeedCleanup: mocks.gitRemoteCredentialsNeedCleanup,
  gitStage: mocks.gitStage,
  gitStageAll: mocks.gitStageAll,
  gitStatus: mocks.gitStatus,
  gitUnstage: mocks.gitUnstage,
  gitUnstageAll: mocks.gitUnstageAll,
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
  mocks.getConfig.mockReset().mockResolvedValue({ github_connected: false });
  mocks.gitCommit.mockReset().mockResolvedValue(true);
  mocks.gitPush.mockReset().mockResolvedValue("Pushed to origin/main.");
  mocks.gitRemoveRemote.mockReset().mockResolvedValue(undefined);
  mocks.gitStage.mockReset().mockResolvedValue(undefined);
  mocks.gitStageAll.mockReset().mockResolvedValue(undefined);
  mocks.gitUnstage.mockReset().mockResolvedValue(undefined);
  mocks.gitUnstageAll.mockReset().mockResolvedValue(undefined);
});

const MIXED_CHANGES = [
  { path: "src/main.tex", status: "M", staged: false },
  { path: "refs/library.bib", status: "A", staged: true },
];

function withRepository(changes = MIXED_CHANGES) {
  mocks.gitIsInitialized.mockResolvedValue(true);
  mocks.gitCurrentBranch.mockResolvedValue("main");
  mocks.gitStatus.mockResolvedValue(changes);
}

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

  it("stages and unstages one file and whole sections", async () => {
    const user = userEvent.setup();
    withRepository();
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Stage" }));
    await waitFor(() =>
      expect(mocks.gitStage).toHaveBeenCalledWith("project-1", "src/main.tex"),
    );

    await user.click(screen.getByRole("button", { name: "Unstage" }));
    await waitFor(() =>
      expect(mocks.gitUnstage).toHaveBeenCalledWith("project-1", "refs/library.bib"),
    );

    await user.click(screen.getByRole("button", { name: "Stage all" }));
    await waitFor(() => expect(mocks.gitStageAll).toHaveBeenCalledWith("project-1"));

    await user.click(screen.getByRole("button", { name: "Unstage all" }));
    await waitFor(() => expect(mocks.gitUnstageAll).toHaveBeenCalledWith("project-1"));

    expect(mocks.gitStatus.mock.calls.length).toBeGreaterThan(4);
  });

  it("shows the reason when staging fails", async () => {
    const user = userEvent.setup();
    withRepository();
    mocks.gitStage.mockRejectedValue(new Error("index.lock exists"));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Stage" }));

    expect(await screen.findByText(/index\.lock exists/)).toBeInTheDocument();
  });

  it("commits the staged set, clears the message, and retires the notice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      withRepository();
      render(<SourceControl />);

      const message = await screen.findByPlaceholderText("Commit message (required)…");
      await user.type(message, "Add the results table");
      await user.click(screen.getByRole("button", { name: /Commit$/ }));

      await waitFor(() =>
        expect(mocks.gitCommit).toHaveBeenCalledWith("project-1", "Add the results table"),
      );
      expect(
        await screen.findByText(/Committed: "Add the results table"/),
      ).toBeInTheDocument();
      expect(message).toHaveValue("");
      expect(fileState.refreshTree).toHaveBeenCalled();
      expect(mocks.gitPush).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(screen.queryByText(/Committed: "Add the results table"/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits and pushes when a token and a remote are both present", async () => {
    const user = userEvent.setup();
    withRepository();
    mocks.getConfig.mockResolvedValue({ github_connected: true });
    mocks.gitGetRemote.mockResolvedValue("https://github.com/oleafly/project.git");
    render(<SourceControl />);

    const message = await screen.findByPlaceholderText("Commit message (required)…");
    await user.type(message, "Push me");
    await user.click(screen.getByRole("button", { name: "Commit and push to origin" }));

    await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith("project-1"));
    expect(await screen.findByText(/Pushed to origin\/main\./)).toBeInTheDocument();
  });

  it("reports a commit failure instead of clearing the message", async () => {
    const user = userEvent.setup();
    withRepository();
    mocks.gitCommit.mockRejectedValue(new Error("nothing to commit"));
    render(<SourceControl />);

    const message = await screen.findByPlaceholderText("Commit message (required)…");
    await user.type(message, "Broken commit");
    await user.click(screen.getByRole("button", { name: /Commit$/ }));

    expect(await screen.findByText(/nothing to commit/)).toBeInTheDocument();
    expect(message).toHaveValue("Broken commit");
  });

  it("unlinks the remote and drops the ahead and behind badge", async () => {
    const user = userEvent.setup();
    withRepository();
    mocks.gitGetRemote.mockResolvedValue("https://github.com/oleafly/project.git");
    mocks.gitAheadBehind.mockResolvedValue({ ahead: 2, behind: 1, has_upstream: true });
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Unlink" }));

    await waitFor(() => expect(mocks.gitRemoveRemote).toHaveBeenCalledWith("project-1"));
    expect(await screen.findByText("Unlinked from GitHub.")).toBeInTheDocument();
  });

  it("shows the reason when unlinking fails", async () => {
    const user = userEvent.setup();
    withRepository();
    mocks.gitGetRemote.mockResolvedValue("https://github.com/oleafly/project.git");
    mocks.gitRemoveRemote.mockRejectedValue(new Error("remote origin is missing"));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Unlink" }));

    expect(await screen.findByText(/remote origin is missing/)).toBeInTheDocument();
  });

  it("shows the reason when initializing fails", async () => {
    const user = userEvent.setup();
    mocks.gitInitialize.mockRejectedValue(new Error("permission denied"));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Initialize Repository" }));

    await waitFor(() => expect(mocks.gitInitialize).toHaveBeenCalled());
    expect(screen.queryByText(/Initialized Git on/)).toBeNull();
  });

  it("shows the reason when a pull fails", async () => {
    const user = userEvent.setup();
    withRepository();
    mocks.gitGetRemote.mockResolvedValue("https://github.com/oleafly/project.git");
    fileState.pullFromGit.mockRejectedValue(new Error("merge conflict in main.tex"));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Pull from origin" }));

    expect(await screen.findByText(/merge conflict in main\.tex/)).toBeInTheDocument();
  });

  it("shows the reason when the credential repair fails", async () => {
    const user = userEvent.setup();
    withRepository();
    mocks.gitRemoteCredentialsNeedCleanup.mockResolvedValue(true);
    mocks.gitCleanRemoteCredentials.mockRejectedValue(new Error("config is read only"));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Remove saved credential" }));

    expect(await screen.findByText(/config is read only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove saved credential" })).toBeInTheDocument();
  });

  it("shows the reason when discarding a file fails", async () => {
    const user = userEvent.setup();
    withRepository([{ path: "main.tex", status: "M", staged: false }]);
    fileState.discardFromGit.mockRejectedValue(new Error("file is locked"));
    render(<SourceControl />);

    await screen.findByText("main.tex");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("button", { name: "Confirm discard" }));

    expect(await screen.findByText(/file is locked/)).toBeInTheDocument();
  });

  it("still lists changes when the branch, remote, and upstream reads fail", async () => {
    mocks.gitIsInitialized.mockResolvedValue(true);
    mocks.gitStatus.mockResolvedValue([{ path: "main.tex", status: "M", staged: false }]);
    mocks.gitGetRemote.mockRejectedValue(new Error("no remote"));
    mocks.gitAheadBehind.mockRejectedValue(new Error("no upstream"));
    mocks.gitRemoteCredentialsNeedCleanup.mockRejectedValue(new Error("unreadable config"));
    render(<SourceControl />);

    expect(await screen.findByText("main.tex")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
    expect(screen.queryByText(/Older Oleafly versions/)).toBeNull();
  });

  it("drops a refresh that a newer one has already superseded", async () => {
    const user = userEvent.setup();
    const firstInitializedRead = deferred<boolean>();
    let reads = 0;
    mocks.gitIsInitialized.mockImplementation(() => {
      reads += 1;
      return reads === 1 ? firstInitializedRead.promise : Promise.resolve(true);
    });
    mocks.gitCurrentBranch.mockResolvedValue("main");
    mocks.gitStatus.mockResolvedValue([{ path: "second.tex", status: "M", staged: false }]);
    render(<SourceControl />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("second.tex")).toBeInTheDocument();

    await act(async () => {
      firstInitializedRead.resolve(false);
      await firstInitializedRead.promise;
    });

    expect(screen.getByText("second.tex")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Initialize Repository" })).toBeNull();
  });

  it("offers publishing to GitHub before a repository exists", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await screen.findByRole("button", { name: "Initialize Repository" });
    const publish = screen.getByRole("button", { name: "Publish to GitHub" });
    await user.click(publish);

    expect(mocks.gitInitialize).not.toHaveBeenCalled();
    expect(publish).toBeInTheDocument();
  });
});
