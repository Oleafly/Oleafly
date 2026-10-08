// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitWorkspaceSnapshot } from "@oleafly/backend-port";
import { SourceControl } from "./SourceControl";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { installScrollGeometry, paddedListHeight, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import { readSidebarView, writeSidebarView } from "@/store/sidebar-view-state";

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


const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 360;

function manyChanges(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    path: `docs/part-${String(index).padStart(3, "0")}.tex`,
    status: "M" as const,
    staged: false,
    conflict: false,
  }));
}

function openProject(projectId: string) {
  fileState.projectId = projectId;
}

const SECTION_IDS = {
  Graph: "source-control-graph",
  "Staged Changes": "source-control-staged",
  Changes: "source-control-changes",
} as const;

function section(name: keyof typeof SECTION_IDS) {
  return within(screen.getByTestId(SECTION_IDS[name])).getByRole("button", { name });
}

describe("SourceControl view memory", () => {
  it("keeps collapsed sections, the commit draft and the branch draft after the panel is closed", async () => {
    const user = userEvent.setup();
    const first = render(<SourceControl />);
    await screen.findByText("library.bib");
    await user.click(section("Graph"));
    await user.click(section("Staged Changes"));
    await user.type(screen.getByTestId("commit-title"), "Tighten the abstract");
    await user.type(screen.getByTestId("commit-description"), "Cut two paragraphs");
    await user.click(await screen.findByRole("button", { name: "main" }));
    await user.click(screen.getByRole("menuitem", { name: "Create branch…" }));
    await user.type(screen.getByRole("textbox", { name: "Branch name" }), "analysis/abstract");
    first.unmount();

    render(<SourceControl />);

    expect(section("Graph")).toHaveAttribute("aria-expanded", "false");
    expect(section("Staged Changes")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(section("Changes")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("commit-title")).toHaveValue("Tighten the abstract");
    expect(screen.getByTestId("commit-description")).toHaveValue("Cut two paragraphs");
    expect(screen.getByRole("textbox", { name: "Branch name" })).toHaveValue("analysis/abstract");
    expect(screen.queryByText(enShell.sourceControl.checking)).not.toBeInTheDocument();
    expect(await screen.findByText("main.tex")).toBeInTheDocument();
  });

  it("shows the remembered changes at once and refreshes them in the background", async () => {
    const first = render(<SourceControl />);
    await screen.findByText("library.bib");
    first.unmount();
    mocks.gitWorkspaceSnapshot.mockReset();
    const refreshed = deferred<GitWorkspaceSnapshot>();
    mocks.gitWorkspaceSnapshot.mockReturnValue(refreshed.promise);

    render(<SourceControl />);

    expect(screen.getByText("library.bib")).toBeInTheDocument();
    expect(screen.queryByText(enShell.sourceControl.checking)).not.toBeInTheDocument();
    await act(async () =>
      refreshed.resolve(
        snapshot({
          changes: [{ path: "refs/new.bib", status: "A", staged: true, conflict: false }],
        }),
      ),
    );
    expect(await screen.findByText("new.bib")).toBeInTheDocument();
    expect(screen.queryByText("library.bib")).not.toBeInTheDocument();
  });

  it("starts another project from its own state and restores the first on return", async () => {
    const user = userEvent.setup();
    const first = render(<SourceControl />);
    await screen.findByText("library.bib");
    await user.click(section("Graph"));
    await user.type(screen.getByTestId("commit-title"), "First project draft");
    first.unmount();

    openProject("project-2");
    const second = render(<SourceControl />);
    await screen.findByText("library.bib");
    expect(section("Graph")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("commit-title")).toHaveValue("");
    await user.type(screen.getByTestId("commit-title"), "Second project draft");
    second.unmount();

    openProject("project-1");
    const third = render(<SourceControl />);
    expect(section("Graph")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("commit-title")).toHaveValue("First project draft");
    third.unmount();

    openProject("project-2");
    render(<SourceControl />);
    expect(screen.getByTestId("commit-title")).toHaveValue("Second project draft");
  });

  it("swaps in the remembered state of a project opened while the panel stays mounted", async () => {
    const user = userEvent.setup();
    const view = render(<SourceControl />);
    await screen.findByText("library.bib");
    await user.click(section("Graph"));
    await user.type(screen.getByTestId("commit-title"), "Draft for one");

    openProject("project-2");
    view.rerender(<SourceControl />);
    await screen.findByText("library.bib");
    expect(screen.getByTestId("commit-title")).toHaveValue("");
    expect(section("Graph")).toHaveAttribute("aria-expanded", "true");
    await user.type(screen.getByTestId("commit-title"), "Draft for two");

    openProject("project-1");
    view.rerender(<SourceControl />);
    expect(screen.getByTestId("commit-title")).toHaveValue("Draft for one");
    expect(section("Graph")).toHaveAttribute("aria-expanded", "false");

    openProject("project-2");
    view.rerender(<SourceControl />);
    expect(screen.getByTestId("commit-title")).toHaveValue("Draft for two");
  });
});

describe("SourceControl scroll memory", () => {
  let geometry: ScrollGeometry;

  beforeEach(() => {
    mocks.gitWorkspaceSnapshot.mockResolvedValue(snapshot({ changes: manyChanges(400) }));
    geometry = installScrollGeometry({
      isScroller: (element) => element.classList.contains("overflow-auto"),
      contentHeight: (scroller) => {
        const lists = new Set(
          [...scroller.querySelectorAll("[data-row-window-item]")].map((row) => row.parentElement),
        );
        return 3 * 40 + [...lists].reduce((sum, list) => sum + paddedListHeight(list, ROW_HEIGHT), 0);
      },
      viewportHeight: VIEWPORT_HEIGHT,
      rowHeight: ROW_HEIGHT,
    });
  });

  afterEach(() => {
    geometry.restore();
  });

  const scroller = () => {
    const element = document.querySelector<HTMLElement>(".overflow-auto");
    if (!element) throw new Error("missing scroller");
    return element;
  };

  it("lands exactly where the list was left, with the matching rows already rendered", async () => {
    const first = render(<SourceControl />);
    await screen.findByText("part-000.tex");
    geometry.scrollTo(scroller(), 7_200);
    expect(scroller().scrollTop).toBe(7_200);
    expect(screen.getByText("part-210.tex")).toBeInTheDocument();
    first.unmount();

    render(<SourceControl />);

    expect(scroller().scrollTop).toBe(7_200);
    expect(screen.getByText("part-210.tex")).toBeInTheDocument();
    expect(screen.queryByText("part-000.tex")).not.toBeInTheDocument();
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("waits for the first snapshot when none was remembered, then restores the position", async () => {
    const first = render(<SourceControl />);
    await screen.findByText("part-000.tex");
    geometry.scrollTo(scroller(), 7_200);
    first.unmount();
    const remembered = readSidebarView("project-1", "sourceControl");
    if (!remembered) throw new Error("nothing was remembered");
    writeSidebarView("project-1", "sourceControl", { ...remembered, snapshot: null });
    const pending = deferred<GitWorkspaceSnapshot>();
    mocks.gitWorkspaceSnapshot.mockReset();
    mocks.gitWorkspaceSnapshot.mockReturnValue(pending.promise);

    render(<SourceControl />);
    expect(screen.getByText(enShell.sourceControl.checking)).toBeInTheDocument();
    await act(async () => pending.resolve(snapshot({ changes: manyChanges(400) })));

    await waitFor(() => expect(scroller().scrollTop).toBe(7_200));
    expect(screen.getByText("part-210.tex")).toBeInTheDocument();
  });

  it("keeps a separate position for each project", async () => {
    const first = render(<SourceControl />);
    await screen.findByText("part-000.tex");
    geometry.scrollTo(scroller(), 7_200);
    first.unmount();

    openProject("project-2");
    const second = render(<SourceControl />);
    await screen.findByText("part-000.tex");
    expect(scroller().scrollTop).toBe(0);
    geometry.scrollTo(scroller(), 1_800);
    second.unmount();

    openProject("project-1");
    const third = render(<SourceControl />);
    expect(scroller().scrollTop).toBe(7_200);
    third.unmount();

    openProject("project-2");
    render(<SourceControl />);
    expect(scroller().scrollTop).toBe(1_800);
  });
});
