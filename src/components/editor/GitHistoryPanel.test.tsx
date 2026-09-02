// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  gitLog: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  gitLog: mocks.gitLog,
}));

import { GitHistoryPanel } from "./GitHistoryPanel";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const commits = [
  {
    oid: "6138cce111111111111111111111111111111111",
    short: "6138cce",
    time: 1_776_000_100,
    message: "Update: project.json",
  },
  {
    oid: "5e37911222222222222222222222222222222222",
    short: "5e37911",
    time: 1_776_000_000,
    message: "Add the results section\n\nThe body explains the new table.",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitLog.mockResolvedValue(commits);
  useSettingsStore.setState({ versioningOpen: true, versioningTab: "git" });
  useFilesStore.setState({
    projectId: "project",
    restoreFromGit: vi.fn().mockResolvedValue(undefined),
  });
});

describe("GitHistoryPanel", () => {
  it("hides the previous project's rows while the next project loads", async () => {
    const projectBCommits = deferred<typeof commits>();
    mocks.gitLog.mockImplementation((projectId: string) =>
      projectId === "project-b" ? projectBCommits.promise : Promise.resolve(commits),
    );
    useFilesStore.setState({ projectId: "project-a" });
    render(<GitHistoryPanel />);

    expect(await screen.findByText("Update: project.json")).toBeInTheDocument();

    act(() => useSettingsStore.setState({ versioningOpen: false }));
    act(() => useFilesStore.setState({ projectId: "project-b" }));
    act(() => useSettingsStore.setState({ versioningOpen: true, versioningTab: "git" }));

    expect(screen.queryByText("Update: project.json")).not.toBeInTheDocument();
    expect(screen.getByText(/No Git history yet/)).toBeInTheDocument();

    await act(async () => {
      projectBCommits.resolve([
        {
          ...commits[0],
          oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          short: "bbbbbbb",
          message: "Project B commit",
        },
      ]);
      await projectBCommits.promise;
    });
    expect(await screen.findByText("Project B commit")).toBeInTheDocument();
  });

  it("ignores Git history reads that finish after the project changes", async () => {
    const projectACommits = deferred<typeof commits>();
    const projectBCommit = {
      ...commits[0],
      oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      short: "bbbbbbb",
      message: "Project B commit",
    };
    mocks.gitLog.mockImplementation((projectId: string) =>
      projectId === "project-a"
        ? projectACommits.promise
        : Promise.resolve([projectBCommit]),
    );
    useFilesStore.setState({ projectId: "project-a" });
    render(<GitHistoryPanel />);

    act(() => {
      useFilesStore.setState({ projectId: "project-b" });
    });
    expect(await screen.findByText("Project B commit")).toBeInTheDocument();

    await act(async () => {
      projectACommits.resolve(commits);
      await projectACommits.promise;
    });

    expect(screen.getByText("Project B commit")).toBeInTheDocument();
    expect(screen.queryByText("Update: project.json")).not.toBeInTheDocument();
  });

  it("cannot run an old restore confirmation during the first render of a new project", async () => {
    function ImmediateProjectSwitch({ switchProject }: { switchProject: boolean }) {
      const renderedProjectId = useFilesStore((state) => state.projectId);

      useLayoutEffect(() => {
        if (switchProject && renderedProjectId === "project-a") {
          useFilesStore.setState({ projectId: "project-b" });
        }
      }, [renderedProjectId, switchProject]);

      useLayoutEffect(() => {
        if (switchProject && renderedProjectId === "project-b") {
          screen.queryByRole("button", { name: "Overwrite all" })?.click();
        }
      }, [renderedProjectId, switchProject]);

      return <GitHistoryPanel />;
    }

    useFilesStore.setState({ projectId: "project-a" });
    const restoreFromGit = vi.fn().mockResolvedValue(undefined);
    useFilesStore.setState({ restoreFromGit });
    const user = userEvent.setup();
    const view = render(<ImmediateProjectSwitch switchProject={false} />);

    await user.click((await screen.findAllByRole("button", { name: "Restore" }))[0]);
    expect(screen.getByRole("button", { name: "Overwrite all" })).toBeInTheDocument();

    view.rerender(<ImmediateProjectSwitch switchProject />);

    await waitFor(() => expect(mocks.gitLog).toHaveBeenCalledWith("project-b"));
    expect(restoreFromGit).not.toHaveBeenCalled();
  });

  it("titles every row with the first message line and keeps the id beside it", async () => {
    render(<GitHistoryPanel />);

    const rows = await screen.findAllByTestId("history-commit");
    expect(rows).toHaveLength(2);

    const title = within(rows[0]).getByTestId("history-commit-title");
    expect(title).toHaveTextContent("Update: project.json");
    const titleLine = title.parentElement as HTMLElement;
    expect(
      within(titleLine).getByRole("button", { name: "Copy commit ID 6138cce" }),
    ).toBeInTheDocument();

    const stamp = new Date(commits[0].time * 1000).toLocaleString();
    expect(within(rows[0]).getByText(stamp)).toBeInTheDocument();
    expect(within(titleLine).queryByText(stamp)).toBeNull();

    expect(within(rows[1]).getByTestId("history-commit-title")).toHaveTextContent(
      "Add the results section",
    );
    expect(screen.queryByText(/The body explains the new table/)).toBeNull();

    expect(screen.getByTestId("history-graph-rail")).toHaveClass("bg-primary/40");
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
  });

  it("offers no label controls and no version tabs", async () => {
    render(<GitHistoryPanel />);

    await screen.findAllByTestId("history-commit");

    expect(screen.queryByRole("tab", { name: "All History" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit label/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove label/ })).toBeNull();
    expect(screen.queryByText("Compile V1")).toBeNull();
    expect(screen.queryByText("Compile V2")).toBeNull();
  });

  it("copies the full commit ID from the short id button", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<GitHistoryPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Copy commit ID 6138cce" }),
    );

    expect(writeText).toHaveBeenCalledWith(commits[0].oid);
  });
});
