// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  checkpointDelete: vi.fn(),
  checkpointExport: vi.fn(),
  checkpointImport: vi.fn(),
  checkpointKeepLatest: vi.fn(),
  checkpointList: vi.fn(),
  checkpointReset: vi.fn(),
  checkpointRestore: vi.fn(),
  checkpointStats: vi.fn(),
  getProject: vi.fn(),
  setProjectCheckpointPolicy: vi.fn(),
  pickOpenPath: vi.fn(),
  pickSavePath: vi.fn(),
  prepareExternalMutation: vi.fn(),
  applyProjectStateChanged: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/checkpoints", () => ({
  checkpointDelete: mocks.checkpointDelete,
  checkpointExport: mocks.checkpointExport,
  checkpointImport: mocks.checkpointImport,
  checkpointKeepLatest: mocks.checkpointKeepLatest,
  checkpointList: mocks.checkpointList,
  checkpointReset: mocks.checkpointReset,
  checkpointRestore: mocks.checkpointRestore,
  checkpointStats: mocks.checkpointStats,
}));

vi.mock("@/lib/native-file-dialog", () => ({
  pickOpenPath: mocks.pickOpenPath,
  pickSavePath: mocks.pickSavePath,
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  setProjectCheckpointPolicy: mocks.setProjectCheckpointPolicy,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { success: mocks.toastSuccess },
}));

import { CheckpointsModal } from "./CheckpointsModal";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const checkpoints = [
  {
    snapshot_root: "root-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    completed_at_unix_ms: 1_777_000_100_000,
    engine: "Tectonic",
    toolchain_identity: "tectonic@0.15.0",
    main_document: "main.tex",
    output_hash: "output-11111111111111111111111111111111",
    file_count: 4,
    logical_bytes: 4096,
  },
  {
    snapshot_root: "root-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    completed_at_unix_ms: 1_777_000_000_000,
    engine: "Typst",
    toolchain_identity: "typst@0.13.1",
    main_document: "paper.typ",
    output_hash: "output-22222222222222222222222222222222",
    file_count: 2,
    logical_bytes: 2048,
  },
];

const stats = {
  checkpoint_count: 2,
  stored_pack_bytes: 2048,
  logical_bytes: 6144,
  reclaimable_bytes: 512,
};

const restoredEvent = {
  projectId: "project",
  revision: 12,
  reason: "checkpoint_restore",
  filesChanged: true,
  mutationGeneration: 18,
};

const projectMeta = {
  name: "Research draft",
  main_doc: "main.tex",
  engine: "tectonic",
  allow_shell_escape: false,
  checkpoints: {
    mode: "engine_dependencies",
    always_include: ["figures/*.png"],
    ignored: ["scratch/*.tmp"],
    future_option: { enabled: true },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkpointList.mockResolvedValue(checkpoints);
  mocks.checkpointStats.mockResolvedValue(stats);
  mocks.checkpointDelete.mockResolvedValue(undefined);
  mocks.checkpointExport.mockResolvedValue(undefined);
  mocks.checkpointImport.mockResolvedValue(undefined);
  mocks.checkpointKeepLatest.mockResolvedValue(undefined);
  mocks.checkpointReset.mockResolvedValue(undefined);
  mocks.checkpointRestore.mockResolvedValue(restoredEvent);
  mocks.getProject.mockResolvedValue(projectMeta);
  mocks.setProjectCheckpointPolicy.mockImplementation(async (_projectId: string, policy: typeof projectMeta.checkpoints) => ({
    ...projectMeta,
    checkpoints: policy,
  }));
  mocks.pickOpenPath.mockResolvedValue(null);
  mocks.pickSavePath.mockResolvedValue(null);
  mocks.prepareExternalMutation.mockResolvedValue(17);
  mocks.applyProjectStateChanged.mockResolvedValue(true);
  useSettingsStore.setState({ checkpointsOpen: true });
  useFilesStore.setState({
    projectId: "project",
    projectName: "Research draft",
    prepareExternalMutation: mocks.prepareExternalMutation,
    applyProjectStateChanged: mocks.applyProjectStateChanged,
  });
});

describe("CheckpointsModal", () => {
  it("shows a running publication and reloads once it lands", async () => {
    render(<CheckpointsModal />);
    expect(await screen.findByRole("button", { name: "Keep latest" })).toBeInTheDocument();
    expect(mocks.checkpointList).toHaveBeenCalledTimes(1);

    act(() => useSettingsStore.getState().setCheckpointPublishingProjectId("project"));
    expect(
      screen.getByText("Saving a checkpoint from the latest compile."),
    ).toBeInTheDocument();

    act(() => {
      useSettingsStore.getState().setCheckpointPublishingProjectId(null);
      useSettingsStore.getState().bumpCheckpointsRevision();
    });

    await waitFor(() => expect(mocks.checkpointList).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Saving a checkpoint from the latest compile.")).toBeNull();
    expect(screen.getByRole("button", { name: "Keep latest" })).toBeInTheDocument();
  });

  it("ignores publication markers that belong to another project", async () => {
    render(<CheckpointsModal />);
    expect(await screen.findByRole("button", { name: "Keep latest" })).toBeInTheDocument();

    act(() => useSettingsStore.getState().setCheckpointPublishingProjectId("elsewhere"));

    expect(screen.queryByText("Saving a checkpoint from the latest compile.")).toBeNull();
  });


  it("cannot run an old row action during the first render of a new project", async () => {
    function ImmediateProjectSwitch({ switchProject }: { switchProject: boolean }) {
      const renderedProjectId = useFilesStore((state) => state.projectId);

      useLayoutEffect(() => {
        if (switchProject && renderedProjectId === "project-a") {
          useFilesStore.setState({ projectId: "project-b", projectName: "Project B" });
        }
      }, [renderedProjectId, switchProject]);

      useLayoutEffect(() => {
        if (switchProject && renderedProjectId === "project-b") {
          screen.queryByRole("button", { name: "Delete checkpoint" })?.click();
        }
      }, [renderedProjectId, switchProject]);

      return <CheckpointsModal />;
    }

    mocks.checkpointList.mockImplementation(async () => checkpoints);
    useFilesStore.setState({ projectId: "project-a", projectName: "Project A" });
    const user = userEvent.setup();
    const view = render(<ImmediateProjectSwitch switchProject={false} />);

    await user.click(
      (await screen.findAllByRole("button", { name: /Delete checkpoint from/ }))[0],
    );
    expect(screen.getByRole("button", { name: "Delete checkpoint" })).toBeInTheDocument();

    view.rerender(<ImmediateProjectSwitch switchProject />);

    await waitFor(() => expect(mocks.checkpointList).toHaveBeenCalledWith("project-b"));
    expect(mocks.checkpointDelete).not.toHaveBeenCalled();
  });

  it("ignores an old project's destructive action after switching projects", async () => {
    const deletion = deferred<void>();
    const projectBCheckpoint = {
      ...checkpoints[1],
      snapshot_root: "root-project-bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      engine: "Project B engine",
      main_document: "project-b.typ",
    };
    mocks.checkpointDelete.mockReturnValueOnce(deletion.promise);
    mocks.checkpointList.mockImplementation(async (requestedProjectId: string) =>
      requestedProjectId === "project-b" ? [projectBCheckpoint] : checkpoints,
    );
    mocks.checkpointStats.mockImplementation(async (requestedProjectId: string) =>
      requestedProjectId === "project-b"
        ? { ...stats, checkpoint_count: 1 }
        : stats,
    );
    useFilesStore.setState({ projectId: "project-a", projectName: "Project A" });
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    await user.click(
      (await screen.findAllByRole("button", { name: /Delete checkpoint from/ }))[0],
    );
    await user.click(screen.getByRole("button", { name: "Delete checkpoint" }));
    await waitFor(() =>
      expect(mocks.checkpointDelete).toHaveBeenCalledWith(
        "project-a",
        checkpoints[0].snapshot_root,
      ),
    );

    useFilesStore.setState({ projectId: "project-b", projectName: "Project B" });
    expect(await screen.findByText(/Project B engine/)).toBeInTheDocument();

    deletion.resolve();
    await deletion.promise;
    await waitFor(() => {
      expect(screen.getByText(/Project B engine/)).toBeInTheDocument();
      expect(mocks.checkpointList.mock.calls.map(([id]) => id)).toEqual([
        "project-a",
        "project-b",
      ]);
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith("Checkpoint deleted.");
  });

  it("shows source provenance, storage use, and a recoverable load error", async () => {
    mocks.checkpointList.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load checkpoints. Try again.",
    );
    expect(mocks.logError).toHaveBeenCalledWith("load checkpoints", expect.any(Error));

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/Tectonic.*main\.tex/)).toBeInTheDocument();
    expect(screen.getByText(/Typst.*paper\.typ/)).toBeInTheDocument();
    expect(screen.getAllByText("Snapshot root")).toHaveLength(2);
    expect(screen.getAllByText("Output proof")).toHaveLength(2);
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("6 KB")).toBeInTheDocument();
    expect(screen.getByText("512 B")).toBeInTheDocument();
    expect(screen.queryByText(/commit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Git history/i)).not.toBeInTheDocument();
  });

  it("flushes pending edits before restoring and applies the returned project state", async () => {
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    await user.click((await screen.findAllByRole("button", { name: "Restore" }))[0]);
    expect(mocks.checkpointRestore).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Current project files will be replaced\. No new checkpoint is created\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore checkpoint" }));

    await waitFor(() => {
      expect(mocks.prepareExternalMutation).toHaveBeenCalledWith("project");
      expect(mocks.checkpointRestore).toHaveBeenCalledWith(
        "project",
        checkpoints[0].snapshot_root,
        17,
      );
      expect(mocks.applyProjectStateChanged).toHaveBeenCalledWith(restoredEvent);
    });
    expect(mocks.prepareExternalMutation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.checkpointRestore.mock.invocationCallOrder[0],
    );
    expect(mocks.checkpointRestore.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applyProjectStateChanged.mock.invocationCallOrder[0],
    );
    expect(mocks.checkpointList).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().checkpointsOpen).toBe(false);
  });

  it("requires inline confirmation for checkpoint deletion and reset, then refreshes", async () => {
    mocks.checkpointList
      .mockResolvedValueOnce(checkpoints)
      .mockResolvedValueOnce([checkpoints[1]])
      .mockResolvedValueOnce([]);
    mocks.checkpointStats
      .mockResolvedValueOnce(stats)
      .mockResolvedValueOnce({ ...stats, checkpoint_count: 1 })
      .mockResolvedValueOnce({
        checkpoint_count: 0,
        stored_pack_bytes: 0,
        logical_bytes: 0,
        reclaimable_bytes: 0,
      });
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    await user.click((await screen.findAllByRole("button", { name: /Delete checkpoint from/ }))[0]);
    expect(mocks.checkpointDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this checkpoint permanently? This cannot be undone.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete checkpoint" }));
    await waitFor(() =>
      expect(mocks.checkpointDelete).toHaveBeenCalledWith(
        "project",
        checkpoints[0].snapshot_root,
      ),
    );
    expect(await screen.findByText(/Typst.*paper\.typ/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(mocks.checkpointReset).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete all checkpoints for this project\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete all checkpoints" }));
    await waitFor(() => expect(mocks.checkpointReset).toHaveBeenCalledWith("project"));
    expect(await screen.findByText("No checkpoints yet")).toBeInTheDocument();
    expect(mocks.checkpointList).toHaveBeenCalledTimes(3);
    expect(mocks.checkpointStats).toHaveBeenCalledTimes(3);
  });

  it("validates archive passwords, exports, imports, and clears the password", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/research.oleafly-checkpoints");
    mocks.pickOpenPath.mockResolvedValue("/tmp/incoming.oleafly-checkpoints");
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    const password = await screen.findByLabelText("Archive password");
    await user.type(password, "short");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Password needs at least 8 characters.");
    expect(mocks.pickSavePath).not.toHaveBeenCalled();

    await user.clear(password);
    await user.type(password, "correct horse");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(mocks.checkpointExport).toHaveBeenCalledWith(
        "project",
        "/tmp/research.oleafly-checkpoints",
        "correct horse",
      ),
    );
    expect(password).toHaveValue("");

    await user.type(password, "battery staple");
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(mocks.checkpointImport).toHaveBeenCalledWith(
        "project",
        "/tmp/incoming.oleafly-checkpoints",
        "battery staple",
      ),
    );
    expect(password).toHaveValue("");
    expect(mocks.checkpointList).toHaveBeenCalledTimes(2);
    expect(mocks.checkpointStats).toHaveBeenCalledTimes(2);
  });

  it("counts archive passwords by Unicode scalars", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/research.oleafly-checkpoints");
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    const password = await screen.findByLabelText("Archive password");
    fireEvent.change(password, { target: { value: "😀😀😀😀😀😀😀" } });
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password needs at least 8 characters.",
    );
    expect(mocks.pickSavePath).not.toHaveBeenCalled();

    fireEvent.change(password, { target: { value: "😀😀😀😀😀😀😀😀" } });
    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(mocks.checkpointExport).toHaveBeenCalledWith(
        "project",
        "/tmp/research.oleafly-checkpoints",
        "😀😀😀😀😀😀😀😀",
      ),
    );
  });

  it("does not offer an empty checkpoint export", async () => {
    mocks.checkpointList.mockResolvedValue([]);
    mocks.checkpointStats.mockResolvedValue({
      checkpoint_count: 0,
      stored_pack_bytes: 0,
      logical_bytes: 0,
      reclaimable_bytes: 0,
    });
    render(<CheckpointsModal />);

    expect(await screen.findByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("loads and saves the project policy while preserving future fields", async () => {
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    const alwaysInclude = await screen.findByLabelText("Always include");
    const ignored = screen.getByLabelText("Ignored");
    expect(alwaysInclude).toHaveValue("figures/*.png");
    expect(ignored).toHaveValue("scratch/*.tmp");
    expect(screen.getByText("engine_dependencies")).toBeInTheDocument();

    fireEvent.change(alwaysInclude, {
      target: { value: "figures/*.png\nnotes/appendix.tex\nfigures/*.png\n" },
    });
    fireEvent.change(ignored, { target: { value: "generated/*.aux\n" } });
    await user.click(screen.getByRole("button", { name: "Save policy" }));

    await waitFor(() =>
      expect(mocks.setProjectCheckpointPolicy).toHaveBeenCalledWith("project", {
        mode: "engine_dependencies",
        always_include: ["figures/*.png", "notes/appendix.tex"],
        ignored: ["generated/*.aux"],
        future_option: { enabled: true },
      }),
    );
    expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Checkpoint policy saved.");
  });

  it("shows a future policy read-only until it is explicitly reset", async () => {
    mocks.getProject.mockResolvedValueOnce({
      ...projectMeta,
      checkpoints: {
        mode: "engine_dependencies_v2",
        always_include: [" figures/*.png ", "figures/*.png"],
        ignored: ["scratch/*.tmp"],
        future_option: { enabled: true },
      },
    });
    const user = userEvent.setup();
    render(<CheckpointsModal />);

    expect(
      await screen.findByText(
        "This project uses a checkpoint policy this version of Oleafly does not support.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Stored checkpoint policy")).toHaveTextContent(
      "engine_dependencies_v2",
    );
    expect(screen.queryByLabelText("Always include")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reset to safe policy" }));

    await waitFor(() =>
      expect(mocks.setProjectCheckpointPolicy).toHaveBeenCalledWith("project", {
        mode: "engine_dependencies",
        always_include: [],
        ignored: [],
      }),
    );
    expect(await screen.findByLabelText("Always include")).toHaveValue("");
  });

  it("shows malformed policy data without crashing or coercing it", async () => {
    mocks.getProject.mockResolvedValueOnce({
      ...projectMeta,
      checkpoints: {
        mode: "engine_dependencies",
        always_include: "figures/*.png",
        ignored: ["scratch/*.tmp", 7],
      },
    });
    render(<CheckpointsModal />);

    expect(
      await screen.findByText(
        "This project's checkpoint policy is malformed and cannot be edited safely.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Stored checkpoint policy")).toHaveTextContent(
      "figures/*.png",
    );
    expect(screen.queryByLabelText("Always include")).toBeNull();
    expect(screen.getByRole("button", { name: "Reset to safe policy" })).toBeEnabled();
  });

  it("normalizes valid stored pattern arrays before editing", async () => {
    mocks.getProject.mockResolvedValueOnce({
      ...projectMeta,
      checkpoints: {
        mode: "engine_dependencies",
        always_include: [" figures/*.png ", "figures/*.png", ""],
        ignored: [" scratch/*.tmp ", "scratch/*.tmp"],
        future_option: { enabled: true },
      },
    });
    render(<CheckpointsModal />);

    expect(await screen.findByLabelText("Always include")).toHaveValue(
      "figures/*.png",
    );
    expect(screen.getByLabelText("Ignored")).toHaveValue("scratch/*.tmp");
  });
});
