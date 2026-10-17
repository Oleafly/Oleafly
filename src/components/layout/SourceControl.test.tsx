// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitWorkspaceSnapshot } from "@oleafly/backend-port";
import { SOURCE_CONTROL_SHOW_GRAPH_EVENT } from "@/lib/source-control-events";
import { open } from "@tauri-apps/plugin-shell";
import { GitMissingGuide, SourceControl } from "./SourceControl";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFolderAccessStore } from "@/store/folder-access";

const mocks = vi.hoisted(() => ({
  gitWorkspaceSnapshot: vi.fn(),
  gitStagePaths: vi.fn(),
  gitUnstagePaths: vi.fn(),
  gitDiscardPaths: vi.fn(),
  gitCommit: vi.fn(),
  gitCommitAmend: vi.fn(),
  gitPush: vi.fn(),
  gitFetch: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitCheckoutBranch: vi.fn(),
  gitInitialize: vi.fn(),
  gitRemoveRemote: vi.fn(),
  gitCleanRemoteCredentials: vi.fn(),
  gitRemoteCredentialsNeedCleanup: vi.fn(),
  gitResolveConflict: vi.fn(),
    gitContinueMerge: vi.fn(),
    gitAbortMerge: vi.fn(),
    gitStashPush: vi.fn(),
    gitStashPop: vi.fn(),
  refreshGit: vi.fn(),
  applyGit: vi.fn(),
  openDiff: vi.fn(),
  clearActiveDiff: vi.fn(),
  publishDialog: vi.fn(),
}));

const projectState = { generation: 1, changed_paths: [], deleted_paths: [] };
const fileState = {
  projectId: "project-1" as string | null,
  projectName: "Research notes",
  refreshTree: vi.fn(),
  openFile: vi.fn(),
  pullFromGit: vi.fn(),
  restoreFromGit: vi.fn(),
  runExternalProjectMutation: vi.fn(),
};

function snapshot(
  overrides: Partial<GitWorkspaceSnapshot> = {},
): GitWorkspaceSnapshot {
  return {
    initialized: true,
    branch: "main",
    remote: "https://github.com/oleafly/research.git",
    aheadBehind: { ahead: 1, behind: 2, has_upstream: true },
    operation: "idle",
    changes: [
      { path: "paper/main.tex", status: "M", staged: false, conflict: false },
      { path: "refs/library.bib", status: "A", staged: true, conflict: false },
    ],
    conflicts: [],
    branches: ["main", "revision"],
    commits: [
      {
        oid: "abc123",
        short: "abc123",
        time: 1,
        message: "Add methods",
        author: "Researcher",
        parents: [],
        refs: ["main"],
      },
    ],
    ...overrides,
  };
}

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
  useDiffStore: (
    selector: (state: {
      openDiff: typeof mocks.openDiff;
      clearActiveDiff: typeof mocks.clearActiveDiff;
    }) => unknown,
  ) =>
    selector({
      openDiff: mocks.openDiff,
      clearActiveDiff: mocks.clearActiveDiff,
    }),
}));

vi.mock("@/store/git-status", () => ({
  useGitStatusStore: {
    getState: () => ({ refresh: mocks.refreshGit, apply: mocks.applyGit }),
  },
}));

vi.mock("@/components/integrations/PublishToGitHubDialog", () => ({
  PublishToGitHubDialog: (props: unknown) => {
    mocks.publishDialog(props);
    return null;
  },
}));

vi.mock("@/components/layout/GithubMenu", () => ({
  GithubMenu: ({ onCopyLink, onOpenInGithub }: { onCopyLink: () => void; onOpenInGithub: () => void }) => (
    <>
      <button type="button" onClick={onCopyLink}>
        {"github-menu-copy"}
      </button>
      <button type="button" onClick={onOpenInGithub}>
        {"github-menu-open"}
      </button>
    </>
  ),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

vi.mock("@/lib/tauri", () => ({
  gitWorkspaceSnapshot: mocks.gitWorkspaceSnapshot,
  gitStagePaths: mocks.gitStagePaths,
  gitUnstagePaths: mocks.gitUnstagePaths,
  gitDiscardPaths: mocks.gitDiscardPaths,
  gitCommit: mocks.gitCommit,
  gitCommitAmend: mocks.gitCommitAmend,
  gitPush: mocks.gitPush,
  gitFetch: mocks.gitFetch,
  gitInitialize: mocks.gitInitialize,
  gitRemoveRemote: mocks.gitRemoveRemote,
  gitCleanRemoteCredentials: mocks.gitCleanRemoteCredentials,
  gitRemoteCredentialsNeedCleanup: mocks.gitRemoteCredentialsNeedCleanup,
  gitResolveConflict: mocks.gitResolveConflict,
  gitContinueMerge: mocks.gitContinueMerge,
  gitAbortMerge: mocks.gitAbortMerge,
    gitStashPush: mocks.gitStashPush,
    gitStashPop: mocks.gitStashPop,
  gitCheckoutBranch: mocks.gitCheckoutBranch,
  gitCreateBranch: mocks.gitCreateBranch,
}));

beforeEach(() => {
  fileState.projectId = "project-1";
  fileState.projectName = "Research notes";
  fileState.refreshTree.mockReset().mockResolvedValue(undefined);
  fileState.openFile.mockReset().mockResolvedValue(undefined);
  fileState.restoreFromGit.mockReset().mockResolvedValue(undefined);
  fileState.pullFromGit.mockReset().mockResolvedValue({
    message: "Pulled",
    outcome: "pulled",
    conflicts: [],
    state: projectState,
  });
  fileState.runExternalProjectMutation
    .mockReset()
    .mockImplementation(
      async (
        _projectId: string,
        operation: (generation: number) => Promise<unknown>,
      ) => operation(1),
    );
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot());
  mocks.gitRemoteCredentialsNeedCleanup.mockResolvedValue(false);
  mocks.gitStagePaths.mockResolvedValue(undefined);
  mocks.gitUnstagePaths.mockResolvedValue(undefined);
  mocks.gitDiscardPaths.mockResolvedValue(projectState);
  mocks.gitCommit.mockResolvedValue(true);
  mocks.gitCommitAmend.mockResolvedValue(true);
  mocks.gitPush.mockResolvedValue("Pushed");
  mocks.gitFetch.mockResolvedValue("Fetched");
  mocks.gitCreateBranch.mockResolvedValue("analysis/revision");
  mocks.gitCheckoutBranch.mockResolvedValue(projectState);
  mocks.gitInitialize.mockResolvedValue("main");
  mocks.gitRemoveRemote.mockResolvedValue(undefined);
  mocks.gitCleanRemoteCredentials.mockResolvedValue(true);
    mocks.gitResolveConflict.mockResolvedValue(projectState);
    mocks.gitContinueMerge.mockResolvedValue({ projectState });
    mocks.gitAbortMerge.mockResolvedValue({ projectState });
    mocks.gitStashPush.mockResolvedValue(projectState);
    mocks.gitStashPop.mockResolvedValue(projectState);
});

describe("SourceControl refresh", () => {
  it("hands its snapshot to the Explorer badges instead of asking Git a second time", async () => {
    render(<SourceControl />);
    await waitFor(() => expect(mocks.applyGit).toHaveBeenCalledTimes(1));
    expect(mocks.applyGit).toHaveBeenCalledWith("project-1", snapshot().changes);
    expect(mocks.refreshGit).not.toHaveBeenCalled();
    expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe("SourceControl in a folder that is not trusted yet", () => {
  const grant = vi.fn();

  function restrict(trust: Record<string, unknown>) {
    useFolderAccessStore.getState().reset("project-1");
    useFolderAccessStore.setState({
      loaded: true,
      trust: trust as never,
      grant,
    });
  }

  beforeEach(() => {
    grant.mockReset();
  });

  afterEach(() => {
    useFolderAccessStore.getState().reset(null);
  });

  it("says why Git is off, offers trust and runs no git command", async () => {
    restrict({ trusted: false, source: null, parent: null, repository: null });
    render(<SourceControl />);
    expect(screen.getByText(enErrors.trust.git)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: enShell.openedFolder.trust.trustFolder }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {});
    expect(mocks.gitWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it("turns Source Control on as soon as the folder is trusted", async () => {
    restrict({ trusted: false, source: null, parent: null, repository: null });
    grant.mockImplementation(async () => {
      useFolderAccessStore.setState({
        trust: { trusted: true, source: "folder", parent: null, repository: null },
      });
      return true;
    });
    const user = userEvent.setup();
    render(<SourceControl />);
    await user.click(screen.getByRole("button", { name: enShell.openedFolder.trust.trustFolder }));
    expect(grant).toHaveBeenCalledWith("folder");
    expect(await screen.findByText("library.bib")).toBeInTheDocument();
    expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledWith("project-1");
  });

  const untrusted = { trusted: false, source: null, parent: null, repository: null };
  const trusted = { trusted: true, source: "folder", parent: null, repository: null };
  const refusal = '@oleafly/error:{"code":"trust.git","params":{}}';

  it("waits for the folder's trust before asking Git, so trusting it leaves no error behind", async () => {
    useFolderAccessStore.getState().reset("project-1");
    let folderTrusted = false;
    mocks.gitWorkspaceSnapshot.mockReset();
    mocks.gitWorkspaceSnapshot.mockImplementation(async () => {
      if (!folderTrusted) throw refusal;
      return snapshot();
    });
    render(<SourceControl />);
    await act(async () => {});
    expect(mocks.gitWorkspaceSnapshot).not.toHaveBeenCalled();
    act(() => useFolderAccessStore.setState({ loaded: true, trust: untrusted as never }));
    await act(async () => {});
    expect(mocks.gitWorkspaceSnapshot).not.toHaveBeenCalled();
    folderTrusted = true;
    act(() => useFolderAccessStore.setState({ trust: trusted as never }));
    expect(await screen.findByText("library.bib")).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toEqual([]);
  });

  it("loads the repository when trusting the folder also announces a Git change", async () => {
    restrict(untrusted);
    mocks.gitWorkspaceSnapshot.mockReset();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot());
    const stop = useFolderAccessStore.subscribe((state, previous) => {
      if (state.trust?.trusted === true && previous.trust?.trusted === false) {
        window.dispatchEvent(new Event("oleafly:git-changed"));
      }
    });
    try {
      render(<SourceControl />);
      await act(async () => {});
      expect(mocks.gitWorkspaceSnapshot).not.toHaveBeenCalled();
      await act(async () => {
        useFolderAccessStore.setState({ trust: trusted as never });
      });
      expect(await screen.findByText("library.bib")).toBeInTheDocument();
      expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledWith("project-1");
    } finally {
      stop();
    }
  });

  it("drops a refusal that lands after the folder lost trust", async () => {
    restrict(trusted);
    let refuse: (error: unknown) => void = () => {};
    mocks.gitWorkspaceSnapshot.mockReset();
    mocks.gitWorkspaceSnapshot.mockReturnValueOnce(
      new Promise<GitWorkspaceSnapshot>((_resolve, reject) => {
        refuse = reject;
      }),
    );
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot());
    render(<SourceControl />);
    await waitFor(() => expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledTimes(1));
    act(() => useFolderAccessStore.setState({ trust: untrusted as never }));
    await act(async () => refuse(refusal));
    act(() => useFolderAccessStore.setState({ trust: trusted as never }));
    expect(await screen.findByText("library.bib")).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toEqual([]);
  });

  it("does not run a queued refresh after the folder lost trust", async () => {
    restrict(trusted);
    const pending = deferred<GitWorkspaceSnapshot>();
    mocks.gitWorkspaceSnapshot.mockReset();
    mocks.gitWorkspaceSnapshot.mockReturnValueOnce(pending.promise);
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot());
    render(<SourceControl />);
    await waitFor(() => expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("oleafly:git-changed")));
    act(() => useFolderAccessStore.setState({ trust: untrusted as never }));
    await act(async () => pending.resolve(snapshot()));
    await act(async () => {});
    expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("source-control-restricted")).toBeInTheDocument();
  });

  it("asks to trust the enclosing repository once the folder itself is trusted", async () => {
    restrict({
      trusted: true,
      source: "folder",
      parent: null,
      repository: { name: "lab-papers", trusted: false },
    });
    const user = userEvent.setup();
    render(<SourceControl />);
    expect(
      screen.getByText(enErrors.trust.repository.replace("{{name}}", "lab-papers")),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: enShell.openedFolder.trust.trustRepository }),
    );
    expect(grant).toHaveBeenCalledWith("repository");
    expect(mocks.gitWorkspaceSnapshot).not.toHaveBeenCalled();
  });
});

describe("SourceControl", () => {
  it("renders separate staged, working, and graph accordions from one snapshot", async () => {
    render(<SourceControl />);

    expect(await screen.findByText("library.bib")).toBeInTheDocument();
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    expect(screen.getByText("Add methods")).toBeInTheDocument();
    expect(screen.getByText("↑1 ↓2")).toBeInTheDocument();
    const stagedSection = screen.getByTestId("source-control-staged");
    const commitActions = screen.getByTestId("source-control-actions");
    expect(commitActions).toHaveClass("border-t");
    expect(
      stagedSection.compareDocumentPosition(commitActions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("shows direct Changes actions and stages exact working paths", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    const changes = await screen.findByTestId("source-control-changes");
    expect(
      within(changes).getByRole("button", { name: "Open all changes" }),
    ).toBeInTheDocument();
    expect(
      within(changes).getByRole("button", { name: "Discard all changes" }),
    ).toBeInTheDocument();
    const stageAll = within(changes).getByRole("button", { name: "Stage all" });
    expect(within(changes).getByTestId("source-control-changes-actions")).toHaveClass(
      "hidden",
      "group-hover/section:flex",
      "group-focus-within/section:flex",
    );
    expect(
      within(changes).queryByRole("button", {
        name: "More actions for Changes",
      }),
    ).not.toBeInTheDocument();
    await user.click(stageAll);

    await waitFor(() =>
      expect(mocks.gitStagePaths).toHaveBeenCalledWith("project-1", [
        "paper/main.tex",
      ]),
    );
  });

  it("uses compact icons and a GitHub mark in the repository menu", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await screen.findByText("main.tex");
    const refresh = screen.getByRole("button", { name: "Refresh" });
    const moreActions = screen.getByRole("button", {
      name: "More Source Control actions",
    });
    expect(refresh).toHaveClass("size-5", "[&_svg]:size-3");
    expect(moreActions).toHaveClass("size-5", "[&_svg]:size-3");
    await user.click(moreActions);
    const menu = screen.getByRole("menu");
    for (const label of ["Fetch", "Pull", "Push", "Sync", "Stash changes"]) {
      expect(
        within(menu).getByRole("menuitem", { name: label }).querySelector("svg"),
      ).toHaveClass("size-3.5");
    }
    expect(
      within(menu)
        .getByRole("menuitem", { name: "Change repo" })
        .querySelector("svg.lucide-github"),
    ).toBeInTheDocument();
  });

  it("presents the current branch as a badge without a menu divider", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    const branch = await screen.findByRole("button", { name: "main" });
    expect(branch).toHaveClass(
      "rounded-full",
      "border",
      "border-emerald-500/30",
      "bg-emerald-500/10",
      "text-emerald-700",
      "[&_svg]:size-3",
    );
    await user.click(branch);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Branches")).toBeInTheDocument();
    expect(within(menu).queryByRole("separator")).not.toBeInTheDocument();
  });

  it("opens a working diff or source file and stages only that row", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    const changes = await screen.findByTestId("source-control-changes");
    const changeButton = within(changes).getByTestId("git-change-paper/main.tex");
    const changeRow = changeButton.parentElement;
    if (!changeRow) throw new Error("expected a Git file row");
    expect(changeButton.querySelector("svg")).toBeInTheDocument();
    const openAction = within(changeRow).getByRole("button", { name: "Open paper/main.tex" });
    expect(openAction.querySelector("svg")).not.toBeInTheDocument();
    await user.hover(changeButton);
    expect(openAction.querySelector("svg.lucide-file-symlink")).toBeInTheDocument();
    expect(
      within(changeRow)
        .getByRole("button", { name: "Stage paper/main.tex" })
        .querySelector("svg.lucide-plus"),
    ).toBeInTheDocument();
    await user.unhover(changeButton);
    expect(openAction.querySelector("svg")).not.toBeInTheDocument();
    act(() => changeButton.focus());
    expect(openAction.querySelector("svg.lucide-file-symlink")).toBeInTheDocument();
    act(() => changeButton.blur());
    expect(openAction.querySelector("svg")).not.toBeInTheDocument();
    expect(openAction).toHaveAttribute("data-tooltip", "Open file");
    expect(changeRow).toHaveClass("w-full", "pl-4", "hover:bg-accent/60");
    const status = within(changes).getByTestId(
      "git-status-working-paper/main.tex",
    );
    expect(changeRow.lastElementChild).toBe(status);
    expect(changeButton).toHaveAttribute("aria-describedby", status.id);
    expect(changeButton).toHaveAccessibleDescription(enShell.sourceControl.status.modified);
    expect(status).toHaveTextContent(/^M/);
    expect(within(changeRow).getAllByRole("button")).toHaveLength(4);
    for (const label of [
      "Open paper/main.tex",
      "Discard changes to paper/main.tex",
      "Stage paper/main.tex",
    ]) {
      const action = within(changeRow).getByRole("button", { name: label });
      expect(action).toHaveClass("text-transparent", "group-hover:text-muted-foreground");
      expect(action).not.toHaveClass("opacity-0");
    }

    await user.click(changeButton);
    expect(mocks.openDiff).toHaveBeenCalledWith("paper/main.tex", "working");

    await user.click(
      within(changes).getByRole("button", { name: "Open paper/main.tex" }),
    );
    await waitFor(() =>
      expect(fileState.openFile).toHaveBeenCalledWith("paper/main.tex"),
    );
    expect(mocks.clearActiveDiff).toHaveBeenCalled();

    await user.click(
      within(changes).getByRole("button", { name: "Stage paper/main.tex" }),
    );
    await waitFor(() =>
      expect(mocks.gitStagePaths).toHaveBeenCalledWith("project-1", [
        "paper/main.tex",
      ]),
    );
  });

  it("uses the shared accordion contract for every Source Control section", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    for (const [testId, label] of [
      ["source-control-staged", "Staged Changes"],
      ["source-control-changes", "Changes"],
      ["source-control-graph", "Graph"],
    ] as const) {
      const section = await screen.findByTestId(testId);
      const toggle = within(section).getByRole("button", {
        name: label,
        expanded: true,
      });
      const contentId = `${testId}-content`;
      expect(toggle).toHaveAttribute("aria-controls", contentId);
      expect(toggle.querySelector("output")).toBeInTheDocument();
      expect(toggle.parentElement).toHaveClass("hover:bg-sidebar-accent");
      expect(document.getElementById(contentId)).not.toHaveAttribute("hidden");
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(document.getElementById(contentId)).toHaveAttribute("hidden");
    }
  });

  it("keeps counts beside titles and section actions at the far right", async () => {
    render(<SourceControl />);

    const staged = await screen.findByTestId("source-control-staged");
    const toggle = within(staged).getByRole("button", {
      name: "Staged Changes",
    });
    expect(toggle.querySelector("svg.lucide-book-plus")).toBeInTheDocument();
    expect(toggle.querySelector("output")).toHaveTextContent("1");
    expect(toggle.querySelector("output")).toHaveAccessibleName(
      "1 staged change",
    );
    const openAll = within(staged).getByRole("button", {
      name: "Open all changes",
    });
    expect(toggle.parentElement?.lastElementChild).toBe(
      openAll.parentElement?.parentElement,
    );
    expect(within(staged).getByTestId("source-control-staged-actions")).toHaveClass(
      "hidden",
      "group-hover/section:flex",
    );
    const changes = screen.getByTestId("source-control-changes");
    expect(
      within(changes)
        .getByRole("button", { name: "Changes" })
        .querySelector("svg.lucide-diff"),
    ).toBeInTheDocument();
    expect(within(changes).getByText("1", { selector: "output" })).toHaveAccessibleName(
      "1 working change",
    );
    const graph = screen.getByTestId("source-control-graph");
    expect(within(graph).getByText("1", { selector: "output" })).toHaveAccessibleName(
      "1 commit",
    );
  });

  it("renders intentional empty states for staged work and history", async () => {
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({ changes: [], commits: [] }),
    );
    render(<SourceControl />);

    const staged = await screen.findByTestId("source-control-staged");
    expect(within(staged).getByText("No staged changes")).toHaveClass(
      "leading-4",
    );
    const stagedEmpty = within(staged).getByText("No staged changes").parentElement;
    // The icon sits above the text, both centered.
    expect(stagedEmpty).toHaveClass("flex-col", "items-center", "justify-center", "text-center");
    expect(stagedEmpty?.firstElementChild?.querySelector("svg.lucide-book-plus")).toBeInTheDocument();
    expect(within(staged).getByTestId("source-control-staged-actions")).toHaveClass(
      "hidden",
      "group-hover/section:flex",
    );
    const graph = screen.getByTestId("source-control-graph");
    expect(within(graph).getByText("No commits yet")).toHaveClass("leading-4");
    const graphEmpty = within(graph).getByText("No commits yet").parentElement;
    expect(graphEmpty).toHaveClass("flex-col", "items-center", "justify-center", "text-center");
    expect(
      graphEmpty?.firstElementChild?.querySelector("svg.lucide-git-commit-horizontal"),
    ).toBeInTheDocument();
  });

  it("keeps both sides of a partly staged file visible", async () => {
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({
        changes: [
          {
            path: "paper/main.tex",
            status: "M",
            staged: true,
            conflict: false,
          },
          {
            path: "paper/main.tex",
            status: "M",
            staged: false,
            conflict: false,
          },
        ],
      }),
    );
    render(<SourceControl />);

    expect(await screen.findAllByTestId("git-change-paper/main.tex")).toHaveLength(
      2,
    );
  });

  it("confirms discard and wraps direct project-state mutations", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await screen.findByText("main.tex");
    await user.click(
      screen.getByRole("button", {
        name: "Discard changes to paper/main.tex",
      }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard changes",
      }),
    );

    await waitFor(() =>
      expect(mocks.gitDiscardPaths).toHaveBeenCalledWith(
        "project-1",
        ["paper/main.tex"],
        1,
      ),
    );
    expect(fileState.runExternalProjectMutation).toHaveBeenCalledWith(
      "project-1",
      expect.any(Function),
    );
  });

  it("does not push after a sync pull reports merge conflicts", async () => {
    const user = userEvent.setup();
    fileState.pullFromGit.mockResolvedValue({
      message: "Resolve conflicts",
      outcome: "conflicts",
      conflicts: [{ path: "paper/main.tex", status: "UU" }],
      state: projectState,
    });
    render(<SourceControl />);

    await user.type(await screen.findByTestId("commit-title"), "Sync methods");
    await user.click(
      screen.getByRole("button", { name: "More commit actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Commit & Sync" }));

    await waitFor(() =>
      expect(fileState.pullFromGit).toHaveBeenCalledWith("project-1"),
    );
    await waitFor(() =>
      expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledTimes(2),
    );
    expect(mocks.gitPush).not.toHaveBeenCalled();
    expect(screen.getByTestId("commit-title")).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Committed locally. Resolve the pulled conflicts before pushing.",
    );
  });

  it("preserves the typed message when the local commit fails", async () => {
    const user = userEvent.setup();
    mocks.gitCommit.mockRejectedValue(new Error("Set your Git author first."));
    render(<SourceControl />);

    const input = await screen.findByTestId("commit-title");
    await user.type(input, "Explain sampling");
    await user.click(screen.getByTestId("commit-button"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Set your Git author first.",
    );
    expect(input).toHaveValue("Explain sampling");
    expect(fileState.refreshTree).not.toHaveBeenCalled();
  });

  it("clears a committed message but reports a later push failure", async () => {
    const user = userEvent.setup();
    mocks.gitPush.mockRejectedValue(new Error("Remote is unavailable."));
    render(<SourceControl />);

    const input = await screen.findByTestId("commit-title");
    await user.type(input, "Explain sampling");
    await user.click(
      screen.getByRole("button", { name: "More commit actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Commit & Push" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Committed locally, but push failed: Error: Remote is unavailable.",
    );
    expect(input).toHaveValue("");
    expect(fileState.refreshTree).toHaveBeenCalled();
  });

  it("keeps the split commit menu open for amend while commit itself is disabled", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({
        changes: [
          {
            path: "paper/main.tex",
            status: "M",
            staged: false,
            conflict: false,
          },
        ],
      }),
    );
    render(<SourceControl />);

    await user.type(await screen.findByTestId("commit-title"), "Clarify methods");
    const commitButton = screen.getByTestId("commit-button");
    expect(commitButton).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Stage a file to commit.")).not.toBeInTheDocument();
    await user.hover(commitButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Stage a file to commit.",
    );
    await user.unhover(commitButton);
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
    await user.tab();
    await user.tab();
    expect(commitButton).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Stage a file to commit.",
    );
    await user.click(
      screen.getByRole("button", { name: "More commit actions" }),
    );
    expect(screen.getByRole("menuitem", { name: "Commit" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("menuitem", { name: "Amend last commit" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    expect(mocks.gitCommitAmend).not.toHaveBeenCalled();
  });

  it("offers conflict resolution through the project-mutation boundary", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({
        operation: "merge",
        conflicts: [{ path: "paper/main.tex", status: "UU" }],
      }),
    );
    render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", { name: "Use current" }),
    );
    await waitFor(() =>
      expect(mocks.gitResolveConflict).toHaveBeenCalledWith(
        "project-1",
        "paper/main.tex",
        "current",
        1,
      ),
    );
  });

  it("does not offer merge-only controls for stash conflicts", async () => {
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({
        operation: "idle",
        conflicts: [{ path: "paper/main.tex", status: "UU" }],
      }),
    );
    render(<SourceControl />);

    expect(await screen.findByText("Resolve stash conflicts")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Abort merge" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete merge" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a branch name available for correction when creation fails", async () => {
    const user = userEvent.setup();
    mocks.gitCreateBranch.mockRejectedValue(new Error("Choose a valid branch name."));
    render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", { name: "main" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Create branch…" }));
    const input = screen.getByRole("textbox", { name: "Branch name" });
    await user.type(input, "bad..branch");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a valid branch name.",
    );
    expect(input).toHaveValue("bad..branch");
  });

  it("shows a loading state until the first coherent snapshot arrives", async () => {
    const pending = deferred<GitWorkspaceSnapshot>();
    mocks.gitWorkspaceSnapshot.mockReturnValue(pending.promise);
    render(<SourceControl />);

    expect(await screen.findByText("Checking Source Control…")).toBeInTheDocument();
    await act(async () => pending.resolve(snapshot()));
    expect(await screen.findByText("main.tex")).toBeInTheDocument();
  });

  it("retries a queued refresh after the first snapshot and ignores credential probe failures", async () => {
    const user = userEvent.setup();
    const first = deferred<GitWorkspaceSnapshot>();
    mocks.gitWorkspaceSnapshot
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(snapshot());
    mocks.gitRemoteCredentialsNeedCleanup.mockRejectedValue(new Error("keychain offline"));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Refresh" }));
    await act(async () => first.resolve(snapshot()));
    await waitFor(() => expect(mocks.gitWorkspaceSnapshot).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("main.tex")).toBeInTheDocument();
  });

  it("reports a failed snapshot refresh and recovers when retried", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot
      .mockRejectedValueOnce(new Error("Git is unavailable"))
      .mockResolvedValue(snapshot());
    render(<SourceControl />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Git is unavailable");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("main.tex")).toBeInTheDocument();
  });

  it("explains a refused snapshot instead of printing the error envelope", async () => {
    mocks.gitWorkspaceSnapshot.mockRejectedValue(
      '@oleafly/error:{"code":"trust.git","params":{},"detail":null}',
    );
    render(<SourceControl />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Trust this folder to use Source Control.");
    expect(alert).not.toHaveTextContent("@oleafly/error");
  });

  it("opens and unstages all staged paths", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);
    const staged = await screen.findByTestId("source-control-staged");

    await user.click(within(staged).getByRole("button", { name: "Open all changes" }));
    expect(mocks.openDiff).toHaveBeenCalledWith("refs/library.bib", "staged");
    await user.click(within(staged).getByRole("button", { name: "Unstage all" }));
    await waitFor(() =>
      expect(mocks.gitUnstagePaths).toHaveBeenCalledWith("project-1", [
        "refs/library.bib",
      ]),
    );
  });

  it("keeps a failed commit's complete message available for correction", async () => {
    const user = userEvent.setup();
    mocks.gitCommit.mockResolvedValue(false);
    render(<SourceControl />);
    const title = await screen.findByTestId("commit-title");
    const description = screen.getByTestId("commit-description");
    await user.type(title, "Clarify findings");
    await user.type(description, "Add the replication detail.");
    await user.click(screen.getByTestId("commit-button"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing staged to commit.");
    expect(title).toHaveValue("Clarify findings");
    expect(description).toHaveValue("Add the replication detail.");
  });

  it("amends with the title and description after the user selects it", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);
    await user.type(await screen.findByTestId("commit-title"), "Correct methods");
    await user.type(screen.getByTestId("commit-description"), "Use the final sample.");
    await user.click(screen.getByRole("button", { name: "More commit actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Amend last commit" }));

    await waitFor(() =>
      expect(mocks.gitCommitAmend).toHaveBeenCalledWith(
        "project-1",
        "Correct methods\n\nUse the final sample.",
      ),
    );
    expect(screen.getByTestId("source-control-status")).toHaveTextContent(
      'Committed: "Correct methods"',
    );
  });

  it("can cancel destructive confirmations without applying their mutation", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);
    await user.click(
      await screen.findByRole("button", { name: "Discard changes to paper/main.tex" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Cancel/ }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.gitDiscardPaths).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Restore version" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Cancel/ }),
    );
    expect(fileState.restoreFromGit).not.toHaveBeenCalled();
  });

  it("keeps branch form keyboard controls available for retry and cancellation", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);
    await user.click(await screen.findByRole("button", { name: "main" }));
    await user.click(screen.getByRole("menuitem", { name: "Create branch…" }));
    const input = screen.getByRole("textbox", { name: "Branch name" });
    await user.type(input, "experiment");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Branch name" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "main" }));
    await user.click(screen.getByRole("menuitem", { name: "Create branch…" }));
    const retry = screen.getByRole("textbox", { name: "Branch name" });
    await user.clear(retry);
    await user.type(retry, "experiment");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(mocks.gitCreateBranch).toHaveBeenCalledWith("project-1", "experiment"),
    );
  });

  it("surfaces a conflict-file opening failure instead of clearing the active diff", async () => {
    const user = userEvent.setup();
    fileState.openFile.mockRejectedValue(new Error("File no longer exists"));
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({ conflicts: [{ path: "paper/main.tex", status: "UU" }] }),
    );
    render(<SourceControl />);
    await user.click(await screen.findByRole("button", { name: "paper/main.tex" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("File no longer exists");
    expect(mocks.clearActiveDiff).not.toHaveBeenCalled();
  });

  it("copies commit identifiers and reports a clipboard failure", async () => {
    const user = userEvent.setup();
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      render(<SourceControl />);
      const copy = await screen.findByRole("button", { name: "Copy commit ID" });
      await user.click(copy);
      expect(writeText).toHaveBeenCalledWith("abc123");

      writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
      await user.click(copy);
      expect(await screen.findByRole("alert")).toHaveTextContent("clipboard blocked");
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("initializes a repository from the recovery state", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot({ initialized: false }));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Initialize Repository" }));
    await waitFor(() =>
      expect(mocks.gitInitialize).toHaveBeenCalledWith("project-1"),
    );
  });

  it("explains why Source Control did not start inside another repository", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot({ initialized: false }));
    mocks.gitInitialize.mockRejectedValue(
      '@oleafly/error:{"code":"git.nested_repository","params":{}}',
    );
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "Initialize Repository" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("inside another Git repository");
    expect(alert).not.toHaveTextContent("@oleafly/error");
  });

  it("keeps remote-only actions disabled when no remote is configured", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot({ remote: null }));
    render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", { name: "More Source Control actions" }),
    );
    const menu = screen.getByRole("menu");
    for (const name of ["Fetch", "Pull", "Push", "Sync"]) {
      expect(within(menu).getByRole("menuitem", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    expect(within(menu).getByRole("menuitem", { name: "Publish to GitHub" })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(within(menu).queryByRole("menuitem", { name: "Unlink" })).not.toBeInTheDocument();
  });

  it("runs remote actions with the current project and mutation generation", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);
    const openActions = async () => {
      await user.click(
        screen.getByRole("button", { name: "More Source Control actions" }),
      );
      return screen.getByRole("menu");
    };

    await user.click(within(await openActions()).getByRole("menuitem", { name: "Fetch" }));
    await waitFor(() => expect(mocks.gitFetch).toHaveBeenCalledWith("project-1"));

    await user.click(within(await openActions()).getByRole("menuitem", { name: "Pull" }));
    await waitFor(() => expect(fileState.pullFromGit).toHaveBeenCalledWith("project-1"));

    await user.click(within(await openActions()).getByRole("menuitem", { name: "Push" }));
    await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith("project-1"));

    await user.click(within(await openActions()).getByRole("menuitem", { name: "Stash changes" }));
    await waitFor(() =>
      expect(mocks.gitStashPush).toHaveBeenCalledWith("project-1", 1),
    );

    await user.click(within(await openActions()).getByRole("menuitem", { name: "Apply latest stash" }));
    await waitFor(() =>
      expect(mocks.gitStashPop).toHaveBeenCalledWith("project-1", 1),
    );
  });

  it("checks out a branch through the external mutation boundary", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "main" }));
    await user.click(screen.getByRole("menuitem", { name: "revision" }));
    await waitFor(() =>
      expect(mocks.gitCheckoutBranch).toHaveBeenCalledWith("project-1", "revision", 1),
    );
    expect(fileState.runExternalProjectMutation).toHaveBeenCalledWith(
      "project-1",
      expect.any(Function),
    );
  });

  it("offers incoming and manual conflict recovery, and permits aborting a merge", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({
        operation: "merge",
        conflicts: [{ path: "paper/main.tex", status: "UU" }],
      }),
    );
    render(<SourceControl />);

    expect(
      await screen.findByRole("button", { name: "Complete merge" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use incoming" }));
    await waitFor(() =>
      expect(mocks.gitResolveConflict).toHaveBeenCalledWith(
        "project-1",
        "paper/main.tex",
        "incoming",
        1,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    await waitFor(() =>
      expect(mocks.gitResolveConflict).toHaveBeenCalledWith(
        "project-1",
        "paper/main.tex",
        "mark",
        1,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Abort merge" }));
    expect(mocks.gitAbortMerge).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Abort this merge?");
    await user.click(
      within(dialog).getByRole("button", { name: "Abort merge" }),
    );
    await waitFor(() =>
      expect(mocks.gitAbortMerge).toHaveBeenCalledWith("project-1", 1),
    );
  });

  it("reports a failed external action and recovers for the next action", async () => {
    const user = userEvent.setup();
    mocks.gitStashPush.mockRejectedValueOnce(new Error("stash failed"));
    render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", { name: "More Source Control actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Stash changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("stash failed");

    await user.click(screen.getByRole("button", { name: "More Source Control actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Fetch" }));
    await waitFor(() => expect(mocks.gitFetch).toHaveBeenCalledWith("project-1"));
  });

  it("surfaces what fetch and stash actually did", async () => {
    const user = userEvent.setup();
    mocks.gitStashPush.mockResolvedValue({
      message: "Nothing to stash.",
      outcome: "unchanged",
      conflicts: [],
      projectState,
    });
    render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", { name: "More Source Control actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Fetch" }));
    expect(await screen.findByText("Fetched")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More Source Control actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Stash changes" }));
    expect(await screen.findByText("Nothing to stash.")).toBeInTheDocument();
    expect(mocks.gitStashPush).toHaveBeenCalledWith("project-1", 1);
  });

  it("reports a partial stash failure while reconciling its changed files", async () => {
    const user = userEvent.setup();
    mocks.gitStashPop.mockResolvedValue({
      message: "could not restore untracked files from stash",
      outcome: "failed",
      conflicts: [],
      projectState,
    });
    render(<SourceControl />);
    await user.click(await screen.findByRole("button", { name: "More Source Control actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Apply latest stash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not restore untracked files from stash");
    await expect(fileState.runExternalProjectMutation.mock.results[0].value).resolves.toMatchObject({ projectState });
  });

  it("opens Graph when another surface requests it", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    const graph = await screen.findByTestId("source-control-graph");
    await user.click(within(graph).getByRole("button", { name: /Graph/ }));
    expect(screen.queryByText("Add methods")).not.toBeInTheDocument();
    act(() =>
      window.dispatchEvent(new CustomEvent(SOURCE_CONTROL_SHOW_GRAPH_EVENT)),
    );
    expect(await screen.findByText("Add methods")).toBeInTheDocument();
  });

  it("restores a Graph version only after confirmation", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", { name: "Restore version" }),
    );
    const confirmation = screen.getByRole("alertdialog");
    await user.click(
      within(confirmation).getByRole("button", { name: "Restore version" }),
    );

    await waitFor(() =>
      expect(fileState.restoreFromGit).toHaveBeenCalledWith(
        "project-1",
        "abc123",
      ),
    );
    expect(fileState.refreshTree).toHaveBeenCalled();
  });

  it("blocks Graph restore while a merge is unresolved", async () => {
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({
        operation: "merge",
        conflicts: [{ path: "paper/main.tex", status: "UU" }],
      }),
    );
    render(<SourceControl />);

    expect(
      await screen.findByRole("button", { name: "Restore version" }),
    ).toBeDisabled();
  });

  it("drops an older project snapshot when the project changes", async () => {
    const slowProjectA = deferred<GitWorkspaceSnapshot>();
    mocks.gitWorkspaceSnapshot.mockImplementation((projectId: string) =>
      projectId === "project-a"
        ? slowProjectA.promise
        : Promise.resolve(
            snapshot({
              changes: [
                {
                  path: "project-b.tex",
                  status: "M",
                  staged: false,
                  conflict: false,
                },
              ],
            }),
          ),
    );
    fileState.projectId = "project-a";
    const view = render(<SourceControl />);

    fileState.projectId = "project-b";
    view.rerender(<SourceControl />);
    expect(await screen.findByText("project-b.tex")).toBeInTheDocument();

    await act(async () =>
      slowProjectA.resolve(
        snapshot({
          changes: [
            {
              path: "project-a.tex",
              status: "M",
              staged: false,
              conflict: false,
            },
          ],
        }),
      ),
    );
    expect(screen.queryByText("project-a.tex")).not.toBeInTheDocument();
  });

  it("closes the publish dialog when the project changes", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot({ remote: null }));
    const view = render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", { name: "More Source Control actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Publish to GitHub" }),
    );
    await waitFor(() =>
      expect(mocks.publishDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({ open: true, projectId: "project-1" }),
      ),
    );

    fileState.projectId = "project-2";
    fileState.projectName = "Next project";
    view.rerender(<SourceControl />);

    await waitFor(() =>
      expect(mocks.publishDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({ open: false, projectId: "project-2" }),
      ),
    );
  });

  it("tells the publish dialog which repository the project already pushes to", async () => {
    render(<SourceControl />);

    await screen.findByText("library.bib");

    expect(mocks.publishDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentRemote: "https://github.com/oleafly/research.git" }),
    );
  });

  it("only removes a legacy credential after the user chooses the repair action", async () => {
    const user = userEvent.setup();
    mocks.gitRemoteCredentialsNeedCleanup.mockResolvedValue(true);
    render(<SourceControl />);

    const repair = await screen.findByRole("button", {
      name: "Remove saved credential",
    });
    expect(mocks.gitCleanRemoteCredentials).not.toHaveBeenCalled();
    await user.click(repair);
    await waitFor(() =>
      expect(mocks.gitCleanRemoteCredentials).toHaveBeenCalledWith("project-1"),
    );
  });

  it("keeps remote unlink available from the more-actions menu", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await user.click(
      await screen.findByRole("button", {
        name: "More Source Control actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Unlink" }));
    await waitFor(() =>
      expect(mocks.gitRemoveRemote).toHaveBeenCalledWith("project-1"),
    );
    expect(screen.getByTestId("source-control-status")).toHaveTextContent(
      "Unlinked from GitHub.",
    );
  });
});

describe("SourceControl when Git is not installed", () => {
  const missing = enShell.sourceControl.gitMissing;

  it("explains that Git is missing instead of offering a setup that fails", async () => {
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({ initialized: false, gitAvailable: false, changes: [], commits: [] }),
    );
    render(<SourceControl />);

    expect(await screen.findByText(missing.title)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enShell.sourceControl.initialize }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enShell.sourceControl.publish }),
    ).not.toBeInTheDocument();
  });

  it("shows the same guidance for a project that already has a repository", async () => {
    mocks.gitWorkspaceSnapshot.mockResolvedValue(
      snapshot({ initialized: true, gitAvailable: false, changes: [], commits: [] }),
    );
    render(<SourceControl />);

    expect(await screen.findByText(missing.title)).toBeInTheDocument();
    expect(screen.queryByText("main.tex")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enShell.sourceControl.commit }),
    ).not.toBeInTheDocument();
  });

  it("checks again from the refresh button", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValueOnce(
      snapshot({ initialized: true, gitAvailable: false, changes: [], commits: [] }),
    );
    render(<SourceControl />);
    await screen.findByText(missing.title);

    await user.click(screen.getByRole("button", { name: enShell.sourceControl.refresh }));

    expect(await screen.findByText("library.bib")).toBeInTheDocument();
    expect(screen.queryByText(missing.title)).not.toBeInTheDocument();
  });
});

describe("GitMissingGuide", () => {
  it("sends Windows users to Git for Windows", async () => {
    const user = userEvent.setup();
    render(<GitMissingGuide os="windows" />);

    expect(screen.getByText(missing().windows)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: missing().download }));
    expect(vi.mocked(open)).toHaveBeenCalledWith("https://git-scm.com/downloads/win");
  });

  it("gives macOS users the command that installs Apple's tools", async () => {
    const user = userEvent.setup();
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      render(<GitMissingGuide os="mac" />);

      expect(screen.getByText(missing().mac)).toBeInTheDocument();
      expect(screen.getByText("xcode-select --install")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: missing().copyCommand }));
      expect(writeText).toHaveBeenCalledWith("xcode-select --install");
      expect(await screen.findByRole("button", { name: missing().copied })).toBeInTheDocument();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("points Linux users to their package manager with no extra button", () => {
    render(<GitMissingGuide os="linux" />);

    expect(screen.getByText(missing().linux)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  function missing() {
    return enShell.sourceControl.gitMissing;
  }
});

describe("SourceControl commit, sync and publish flows", () => {
  const sourceControl = enShell.sourceControl;

  it("commits with Enter in the title", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await user.type(await screen.findByTestId("commit-title"), "Add results{Enter}");

    await waitFor(() => expect(mocks.gitCommit).toHaveBeenCalledWith("project-1", "Add results"));
    expect(await screen.findByText(sourceControl.committed.replace("{{subject}}", "Add results"))).toBeInTheDocument();
  });

  it("pushes after a clean Commit & Sync", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await user.type(await screen.findByTestId("commit-title"), "Sync results");
    await user.click(screen.getByRole("button", { name: sourceControl.commitActions }));
    await user.click(screen.getByRole("menuitem", { name: sourceControl.commitAndSync }));

    await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith("project-1"));
    expect(fileState.pullFromGit).toHaveBeenCalledWith("project-1");
  });

  it("names the sync step when the push after a commit fails", async () => {
    const user = userEvent.setup();
    mocks.gitPush.mockRejectedValue("offline");
    render(<SourceControl />);

    await user.type(await screen.findByTestId("commit-title"), "Sync results");
    await user.click(screen.getByRole("button", { name: sourceControl.commitActions }));
    await user.click(screen.getByRole("menuitem", { name: sourceControl.commitAndSync }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      sourceControl.committedRemoteFailed
        .replace("{{step}}", sourceControl.sync.toLocaleLowerCase())
        .replace("{{reason}}", "offline"),
    );
  });

  it("syncs from the actions menu and stops before pushing into conflicts", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);
    const openActions = async () => {
      await user.click(await screen.findByRole("button", { name: "More Source Control actions" }));
      return screen.getByRole("menu");
    };

    await user.click(within(await openActions()).getByRole("menuitem", { name: sourceControl.sync }));
    await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith("project-1"));

    mocks.gitPush.mockClear();
    fileState.pullFromGit.mockResolvedValue({
      message: "Resolve conflicts",
      outcome: "conflicts",
      conflicts: [{ path: "paper/main.tex", status: "UU" }],
      state: projectState,
    });
    await user.click(within(await openActions()).getByRole("menuitem", { name: sourceControl.sync }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Resolve conflicts");
    expect(mocks.gitPush).not.toHaveBeenCalled();
  });

  it("discards every working change after confirmation", async () => {
    const user = userEvent.setup();
    render(<SourceControl />);

    await screen.findByText("main.tex");
    await user.click(screen.getByRole("button", { name: sourceControl.discardAll }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: sourceControl.discard }));

    await waitFor(() => expect(mocks.gitDiscardPaths).toHaveBeenCalledWith("project-1", ["paper/main.tex"], 1));
  });

  it("copies the GitHub link and reports a clipboard failure", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: "github-menu-copy" }));
    expect(await screen.findByText(sourceControl.linkCopied)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://github.com/oleafly/research");

    await user.click(screen.getByRole("button", { name: "github-menu-copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("denied");

    await user.click(screen.getByRole("button", { name: "github-menu-open" }));
    expect(open).toHaveBeenCalledWith("https://github.com/oleafly/research");
  });

  it("publishes a project without a repository and refreshes after publishing", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot({ initialized: false }));
    render(<SourceControl />);

    await user.click(await screen.findByRole("button", { name: sourceControl.publish }));
    const props = () => mocks.publishDialog.mock.calls.at(-1)?.[0] as { open: boolean; onClose: () => void; onPublished: () => void };
    await waitFor(() => expect(props().open).toBe(true));

    const loads = mocks.gitWorkspaceSnapshot.mock.calls.length;
    act(() => props().onPublished());
    await waitFor(() => expect(mocks.gitWorkspaceSnapshot.mock.calls.length).toBeGreaterThan(loads));

    act(() => props().onClose());
    await waitFor(() => expect(props().open).toBe(false));
  });

  it("completes a merge once its conflicts are resolved", async () => {
    const user = userEvent.setup();
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot({ operation: "merge", conflicts: [] }));
    render(<SourceControl />);

    const complete = await screen.findByRole("button", { name: sourceControl.continueMerge });
    expect(complete).toBeEnabled();
    await user.click(complete);

    await waitFor(() => expect(mocks.gitContinueMerge).toHaveBeenCalledWith("project-1", 1));
  });
});
