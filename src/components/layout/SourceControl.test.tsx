// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitWorkspaceSnapshot } from "@oleafly/backend-port";
import { SOURCE_CONTROL_SHOW_GRAPH_EVENT } from "@/lib/source-control-events";
import { SourceControl } from "./SourceControl";

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
	refreshGit: vi.fn(),
	openDiff: vi.fn(),
	clearActiveDiff: vi.fn(),
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
	useGitStatusStore: { getState: () => ({ refresh: mocks.refreshGit }) },
}));

vi.mock("@/components/integrations/PublishToGitHubDialog", () => ({
	PublishToGitHubDialog: () => null,
}));

vi.mock("@/components/layout/GithubMenu", () => ({
	GithubMenu: () => null,
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
	gitStashPush: vi.fn(),
	gitStashPop: vi.fn(),
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
});

describe("SourceControl", () => {
	it("renders separate staged, working, and graph accordions from one snapshot", async () => {
		render(<SourceControl />);

		expect(await screen.findByText("library.bib")).toBeInTheDocument();
		expect(screen.getByText("main.tex")).toBeInTheDocument();
		expect(screen.getByText("Add methods")).toBeInTheDocument();
		expect(screen.getByText("↑1 ↓2")).toBeInTheDocument();
		expect(screen.getByTestId("source-control-actions")).toBeInTheDocument();
	});

	it("stages exact working paths from the Changes section menu", async () => {
		const user = userEvent.setup();
		render(<SourceControl />);

		const changes = await screen.findByTestId("source-control-changes");
		await user.click(
			within(changes).getByRole("button", {
				name: "More actions for Changes",
			}),
		);
		await user.click(screen.getByRole("menuitem", { name: "Stage all" }));

		await waitFor(() =>
			expect(mocks.gitStagePaths).toHaveBeenCalledWith("project-1", [
				"paper/main.tex",
			]),
		);
	});

	it("opens a working diff or source file and stages only that row", async () => {
		const user = userEvent.setup();
		render(<SourceControl />);

		const changes = await screen.findByTestId("source-control-changes");
		await user.click(within(changes).getByTestId("git-change-paper/main.tex"));
		expect(mocks.openDiff).toHaveBeenCalledWith("paper/main.tex", "working");

		await user.click(within(changes).getByRole("button", { name: "Open file" }));
		await waitFor(() =>
			expect(fileState.openFile).toHaveBeenCalledWith("paper/main.tex"),
		);
		expect(mocks.clearActiveDiff).toHaveBeenCalled();

		await user.click(within(changes).getByRole("button", { name: "Stage" }));
		await waitFor(() =>
			expect(mocks.gitStagePaths).toHaveBeenCalledWith("project-1", [
				"paper/main.tex",
			]),
		);
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
		await user.click(screen.getByRole("button", { name: "Discard changes" }));
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

	it("allows a message-only amend when there are no staged files", async () => {
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
		expect(screen.getByTestId("commit-button")).toBeDisabled();
		await user.click(
			screen.getByRole("button", { name: "More commit actions" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Amend last commit" }));

		await waitFor(() =>
			expect(mocks.gitCommitAmend).toHaveBeenCalledWith(
				"project-1",
				"Clarify methods",
			),
		);
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
