// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  gitLog: vi.fn(),
  gitReadVersionLabels: vi.fn(),
  gitSetVersionLabel: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  gitLog: mocks.gitLog,
  gitReadVersionLabels: mocks.gitReadVersionLabels,
  gitSetVersionLabel: mocks.gitSetVersionLabel,
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
    message: "Update: .gitignore, main.tex, project.json",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitLog.mockResolvedValue(commits);
  mocks.gitReadVersionLabels.mockResolvedValue({
    [commits[0].oid]: "Stable one",
  });
  mocks.gitSetVersionLabel.mockResolvedValue(undefined);
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
    const projectALabels = deferred<Record<string, string>>();
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
    mocks.gitReadVersionLabels.mockImplementation((projectId: string) =>
      projectId === "project-a"
        ? projectALabels.promise
        : Promise.resolve({ [projectBCommit.oid]: "Project B label" }),
    );
    useFilesStore.setState({ projectId: "project-a" });
    render(<GitHistoryPanel />);

    act(() => {
      useFilesStore.setState({ projectId: "project-b" });
    });
    expect(await screen.findByText("Project B commit")).toBeInTheDocument();
    expect(screen.getByText("Project B label")).toBeInTheDocument();

    await act(async () => {
      projectACommits.resolve(commits);
      projectALabels.resolve({ [commits[0].oid]: "Stale project A label" });
      await projectACommits.promise;
      await projectALabels.promise;
    });

    expect(screen.getByText("Project B commit")).toBeInTheDocument();
    expect(screen.getByText("Project B label")).toBeInTheDocument();
    expect(screen.queryByText("Update: project.json")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale project A label")).not.toBeInTheDocument();
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

  it("shows a primary history rail and filters Labels to manual labels", async () => {
    const user = userEvent.setup();
    render(<GitHistoryPanel />);

    expect(await screen.findByText("Stable one")).toBeInTheDocument();
    expect(screen.getByTestId("history-graph-rail")).toHaveClass(
      "bg-primary/40",
    );
    expect(screen.getByLabelText("Copy commit ID 6138cce")).toBeInTheDocument();
    expect(screen.getByLabelText("Labeled Stable one")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Labels" }));

    expect(screen.getByText("Update: project.json")).toBeInTheDocument();
    expect(
      screen.queryByText("Update: .gitignore, main.tex, project.json"),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove label Stable one" }),
    );

    await waitFor(() => {
      expect(mocks.gitSetVersionLabel).toHaveBeenCalledWith(
        "project",
        commits[0].oid,
        "",
      );
    });
    expect(
      await screen.findByText(
        "No labeled versions yet. Add a label from All History.",
      ),
    ).toBeInTheDocument();
  });

  it("creates or edits a label from All History", async () => {
    mocks.gitReadVersionLabels.mockResolvedValue({});
    render(<GitHistoryPanel />);

    await screen.findByText("Compile V2");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit label for 6138cce" }),
    );

    const input = screen.getByRole("textbox", { name: "Version label" });
    fireEvent.change(input, { target: { value: "Ready to submit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save label" }));

    await waitFor(() => {
      expect(mocks.gitSetVersionLabel).toHaveBeenCalledWith(
        "project",
        commits[0].oid,
        "Ready to submit",
      );
    });
    expect(await screen.findByText("Ready to submit")).toBeInTheDocument();
  });

  it("copies commit IDs and supports keyboard label editing", async () => {
    mocks.gitReadVersionLabels.mockResolvedValue({});
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<GitHistoryPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Copy commit ID 6138cce" }),
    );
    expect(writeText).toHaveBeenCalledWith(commits[0].oid);

    await user.click(screen.getByRole("button", { name: "Edit label for 6138cce" }));
    let input = screen.getByRole("textbox", { name: "Version label" });
    await user.type(input, "Temporary");
    await user.click(screen.getByRole("button", { name: "Cancel label editing" }));
    expect(screen.queryByRole("textbox", { name: "Version label" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit label for 6138cce" }));
    input = screen.getByRole("textbox", { name: "Version label" });
    await user.clear(input);
    await user.type(input, "Camera ready");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mocks.gitSetVersionLabel).toHaveBeenCalledWith(
        "project",
        commits[0].oid,
        "Camera ready",
      ),
    );
  });

  it("keeps a label save current when a commit ID is copied", async () => {
    const labelSave = deferred<void>();
    mocks.gitReadVersionLabels.mockResolvedValue({});
    mocks.gitSetVersionLabel.mockReturnValueOnce(labelSave.promise);
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<GitHistoryPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Edit label for 6138cce" }),
    );
    await user.clear(screen.getByRole("textbox", { name: "Version label" }));
    await user.type(
      screen.getByRole("textbox", { name: "Version label" }),
      "Ready after copy",
    );
    await user.click(screen.getByRole("button", { name: "Save label" }));
    await waitFor(() => expect(mocks.gitSetVersionLabel).toHaveBeenCalledOnce());

    await user.click(
      screen.getByRole("button", { name: "Copy commit ID 6138cce" }),
    );
    expect(writeText).toHaveBeenCalledWith(commits[0].oid);

    await act(async () => {
      labelSave.resolve();
      await labelSave.promise;
    });

    expect(await screen.findByText("Ready after copy")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Version label" })).toBeNull();
  });
});
