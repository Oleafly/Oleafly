// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  checkpointDelete: vi.fn(),
  checkpointExport: vi.fn(),
  checkpointFiles: vi.fn(),
  checkpointIgnorePath: vi.fn(),
  checkpointImport: vi.fn(),
  checkpointInspect: vi.fn(),
  checkpointKeepLatest: vi.fn(),
  checkpointList: vi.fn(),
  checkpointReset: vi.fn(),
  checkpointRestore: vi.fn(),
  checkpointRevealStore: vi.fn(),
  checkpointStats: vi.fn(),
  checkpointUnignorePath: vi.fn(),
  getProject: vi.fn(),
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
  checkpointEngineLabel: (engine: string) => engine,
  checkpointExport: mocks.checkpointExport,
  checkpointFiles: mocks.checkpointFiles,
  checkpointIgnorePath: mocks.checkpointIgnorePath,
  checkpointImport: mocks.checkpointImport,
  checkpointInspect: mocks.checkpointInspect,
  checkpointKeepLatest: mocks.checkpointKeepLatest,
  checkpointList: mocks.checkpointList,
  checkpointReset: mocks.checkpointReset,
  checkpointRestore: mocks.checkpointRestore,
  checkpointRevealStore: mocks.checkpointRevealStore,
  checkpointStats: mocks.checkpointStats,
  checkpointUnignorePath: mocks.checkpointUnignorePath,
}));

vi.mock("@/lib/native-file-dialog", () => ({
  pickOpenPath: mocks.pickOpenPath,
  pickSavePath: mocks.pickSavePath,
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { success: mocks.toastSuccess },
}));

import { CheckpointsPanel } from "./CheckpointsPanel";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const NOW = 1_777_000_220_000;

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

const newestFiles = [
  { path: "main.tex", bytes: 2048, content_hash: "hash-main", stored: true, replayed: true },
  {
    path: "project.json",
    bytes: 256,
    content_hash: "hash-project",
    stored: true,
    replayed: false,
  },
  {
    path: "figures/plot.png",
    bytes: 1024,
    content_hash: "hash-plot",
    stored: true,
    replayed: true,
  },
  {
    path: "scratch/notes.txt",
    bytes: 128,
    content_hash: "hash-notes",
    stored: false,
    replayed: true,
  },
];

const stats = {
  checkpoint_count: 2,
  stored_pack_bytes: 2048,
  logical_bytes: 6144,
  reclaimable_bytes: 512,
};

const inspection = {
  store_path: "/data/checkpoints/project",
  catalog_path: "/data/checkpoints/project/catalog.sqlite",
  catalog_bytes: 8192,
  format_version: 3,
  lineage: "lineage-1234",
  table_counts: {
    checkpoints: 2,
    manifests: 2,
    packs: 1,
    chunks: 9,
    manifest_chunks: 4,
  },
  packs: [{ file_name: "pack-0001.pack", bytes: 2048, chunk_count: 9 }],
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

async function openAdvanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("checkpoints-advanced"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.checkpointList.mockResolvedValue(checkpoints);
  mocks.checkpointStats.mockResolvedValue(stats);
  mocks.checkpointDelete.mockResolvedValue(undefined);
  mocks.checkpointExport.mockResolvedValue(undefined);
  mocks.checkpointFiles.mockResolvedValue(newestFiles);
  mocks.checkpointIgnorePath.mockResolvedValue(projectMeta);
  mocks.checkpointImport.mockResolvedValue(undefined);
  mocks.checkpointInspect.mockResolvedValue(inspection);
  mocks.checkpointKeepLatest.mockResolvedValue(undefined);
  mocks.checkpointReset.mockResolvedValue(undefined);
  mocks.checkpointRestore.mockResolvedValue(restoredEvent);
  mocks.checkpointRevealStore.mockResolvedValue(undefined);
  mocks.checkpointUnignorePath.mockResolvedValue(projectMeta);
  mocks.getProject.mockResolvedValue(projectMeta);
  mocks.pickOpenPath.mockResolvedValue(null);
  mocks.pickSavePath.mockResolvedValue(null);
  mocks.prepareExternalMutation.mockResolvedValue(17);
  mocks.applyProjectStateChanged.mockResolvedValue(true);
  useSettingsStore.setState({ versioningOpen: true, versioningTab: "checkpoints" });
  useFilesStore.setState({
    projectId: "project",
    projectName: "Research draft",
    prepareExternalMutation: mocks.prepareExternalMutation,
    applyProjectStateChanged: mocks.applyProjectStateChanged,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CheckpointsPanel timeline", () => {
  it("numbers versions from the oldest and shows the newest on top", async () => {
    render(<CheckpointsPanel />);

    const timeline = await screen.findByTestId("checkpoint-timeline");
    const entries = within(timeline).getAllByTestId("checkpoint-entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAttribute("data-version", "V2");
    expect(entries[0]).toHaveAttribute("data-root", checkpoints[0].snapshot_root);
    expect(entries[1]).toHaveAttribute("data-version", "V1");
    expect(entries[1]).toHaveAttribute("data-root", checkpoints[1].snapshot_root);

    expect(within(entries[0]).getByText("2 minutes ago")).toBeInTheDocument();
    expect(within(entries[0]).getByText(/Tectonic · main\.tex/)).toBeInTheDocument();
    expect(within(entries[0]).getByText("4 files")).toBeInTheDocument();
    expect(within(entries[0]).getByText("4 KB")).toBeInTheDocument();
    expect(
      within(entries[0]).getByText(new Date(checkpoints[0].completed_at_unix_ms).toLocaleString()),
    ).toBeInTheDocument();
    expect(within(entries[1]).getByText(/Typst · paper\.typ/)).toBeInTheDocument();

    expect(
      screen.getByText("One version per successful compile that changed the source."),
    ).toBeInTheDocument();
    expect(screen.getByText("Source only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore V2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete V1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show files for V2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy checkpoint id root-aaa/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Always include")).toBeNull();
    expect(screen.queryByLabelText("Ignored")).toBeNull();
    expect(screen.queryByText(/commit/i)).not.toBeInTheDocument();
  });

  it("keeps the store details out of the basic view until Advanced is expanded", async () => {
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    const advanced = await screen.findByTestId("checkpoints-advanced");
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Reclaimable")).toBeNull();
    expect(screen.queryByLabelText("Archive password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep latest" })).toBeNull();
    expect(mocks.checkpointInspect).not.toHaveBeenCalled();

    await user.click(advanced);

    expect(advanced).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(mocks.checkpointInspect).toHaveBeenCalledWith("project"));
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Storage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeInTheDocument();

    const summary = screen.getByText("Reclaimable").closest("dl") as HTMLElement;
    const summaryValue = (term: string) =>
      within(within(summary).getByText(term).parentElement as HTMLElement).getByRole("definition");
    expect(summaryValue("Checkpoints")).toHaveTextContent("2");
    expect(summaryValue("Stored")).toHaveTextContent("2 KB");
    expect(summaryValue("Source size")).toHaveTextContent("6 KB");
    expect(summaryValue("Reclaimable")).toHaveTextContent("512 B");

    expect(await screen.findByText("/data/checkpoints/project")).toBeInTheDocument();
    expect(screen.getByLabelText("Archive password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep latest" })).toBeInTheDocument();
  });

  it("reveals the catalog facts and pack table on demand", async () => {
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await openAdvanced(user);
    const inspect = await screen.findByRole("button", { name: "Inspect catalog" });
    await waitFor(() => expect(inspect).toBeEnabled());
    await user.click(inspect);

    expect(screen.getByText("/data/checkpoints/project/catalog.sqlite")).toBeInTheDocument();
    expect(screen.getByText("lineage-1234")).toBeInTheDocument();
    expect(screen.getByText("pack-0001.pack")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show catalog files for V2" }));
    await waitFor(() =>
      expect(mocks.checkpointFiles).toHaveBeenCalledWith("project", checkpoints[0].snapshot_root),
    );
    expect(await screen.findByText("figures/plot.png")).toBeInTheDocument();
  });

  it("copies the full snapshot root from the short id button", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CheckpointsPanel />);

    await user.click(await screen.findByRole("button", { name: /Copy checkpoint id root-aaa/ }));

    expect(writeText).toHaveBeenCalledWith(checkpoints[0].snapshot_root);
  });

  it("shows a running publication and reloads once it lands", async () => {
    render(<CheckpointsPanel />);
    expect(await screen.findByTestId("checkpoint-timeline")).toBeInTheDocument();
    expect(mocks.checkpointList).toHaveBeenCalledTimes(1);

    act(() => useSettingsStore.getState().setCheckpointPublishingProjectId("project"));
    expect(screen.getByTestId("checkpoint-publishing")).toHaveTextContent(
      "Saving a checkpoint from the latest compile.",
    );

    act(() => {
      useSettingsStore.getState().setCheckpointPublishingProjectId(null);
      useSettingsStore.getState().bumpCheckpointsRevision();
    });

    await waitFor(() => expect(mocks.checkpointList).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("checkpoint-publishing")).toBeNull();
  });

  it("ignores publication markers that belong to another project", async () => {
    render(<CheckpointsPanel />);
    expect(await screen.findByTestId("checkpoint-timeline")).toBeInTheDocument();

    act(() => useSettingsStore.getState().setCheckpointPublishingProjectId("elsewhere"));

    expect(screen.queryByTestId("checkpoint-publishing")).toBeNull();
  });

  it("reports a load failure and recovers on retry", async () => {
    mocks.checkpointList.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load checkpoints. Try again.",
    );
    expect(mocks.logError).toHaveBeenCalledWith("load checkpoints", expect.any(Error));

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("checkpoint-timeline")).toBeInTheDocument();
  });
});

describe("CheckpointsPanel files", () => {
  it("loads an entry's files on demand and labels how each one arrived", async () => {
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await user.click(await screen.findByRole("button", { name: "Show files for V2" }));

    await waitFor(() =>
      expect(mocks.checkpointFiles).toHaveBeenCalledWith("project", checkpoints[0].snapshot_root),
    );
    const rows = await screen.findAllByTestId("checkpoint-file");
    expect(rows.map((row) => row.getAttribute("data-path"))).toEqual([
      "main.tex",
      "project.json",
      "figures/plot.png",
      "scratch/notes.txt",
    ]);

    expect(within(rows[3]).getByText("Not stored")).toBeInTheDocument();
    expect(within(rows[3]).getByText("128 B · Compiler input")).toBeInTheDocument();
    expect(within(rows[1]).getByText("256 B · Included by policy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide files for V2" })).toBeInTheDocument();

    expect(within(rows[0]).queryByRole("button")).toBeNull();
    expect(within(rows[1]).queryByRole("button")).toBeNull();
    expect(
      within(rows[2]).getByRole("button", { name: "Ignore in future checkpoints" }),
    ).toBeInTheDocument();
  });

  it("ignores one file and then offers to stop ignoring it", async () => {
    mocks.checkpointIgnorePath.mockResolvedValue({
      ...projectMeta,
      checkpoints: { ...projectMeta.checkpoints, ignored: ["scratch/notes.txt"] },
    });
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await user.click(await screen.findByRole("button", { name: "Show files for V2" }));
    const rows = await screen.findAllByTestId("checkpoint-file");
    await user.click(
      within(rows[3]).getByRole("button", { name: "Ignore in future checkpoints" }),
    );

    await waitFor(() =>
      expect(mocks.checkpointIgnorePath).toHaveBeenCalledWith("project", "scratch/notes.txt"),
    );
    expect(
      await within(screen.getAllByTestId("checkpoint-file")[3]).findByRole("button", {
        name: "Stop ignoring",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Stop ignoring" })[0]);
    await waitFor(() =>
      expect(mocks.checkpointUnignorePath).toHaveBeenCalledWith("project", "scratch/notes.txt"),
    );
  });
});

describe("CheckpointsPanel actions", () => {
  it("warns about unstored files, then flushes edits and applies the restored state", async () => {
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await user.click(await screen.findByRole("button", { name: "Restore V2" }));
    expect(mocks.checkpointRestore).not.toHaveBeenCalled();
    expect(
      await screen.findByText("1 file was not stored, so it stays as it is on disk."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Overwrite all" }));

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
    expect(useSettingsStore.getState().versioningOpen).toBe(false);
  });

  it("requires inline confirmation for deletion and reset, then refreshes", async () => {
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
    render(<CheckpointsPanel />);

    await user.click(await screen.findByRole("button", { name: "Delete V2" }));
    expect(mocks.checkpointDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete checkpoint" }));
    await waitFor(() =>
      expect(mocks.checkpointDelete).toHaveBeenCalledWith("project", checkpoints[0].snapshot_root),
    );
    expect(await screen.findByText(/Typst · paper\.typ/)).toBeInTheDocument();

    await openAdvanced(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(mocks.checkpointReset).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete all checkpoints for this project\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete all checkpoints" }));
    await waitFor(() => expect(mocks.checkpointReset).toHaveBeenCalledWith("project"));
    expect(await screen.findByText("No checkpoints yet")).toBeInTheDocument();
    expect(mocks.checkpointList).toHaveBeenCalledTimes(3);
    expect(mocks.checkpointStats).toHaveBeenCalledTimes(3);
  });

  it("keeps only the latest checkpoint after confirmation", async () => {
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await openAdvanced(user);
    await user.click(await screen.findByRole("button", { name: "Keep latest" }));
    expect(mocks.checkpointKeepLatest).not.toHaveBeenCalled();
    expect(
      screen.getByText("Delete every checkpoint except the latest one? This cannot be undone."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete older checkpoints" }));

    await waitFor(() => expect(mocks.checkpointKeepLatest).toHaveBeenCalledWith("project"));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Older checkpoints deleted.");
  });

  it("validates archive passwords, exports, imports, and clears the password", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/research.oleafly-checkpoints");
    mocks.pickOpenPath.mockResolvedValue("/tmp/incoming.oleafly-checkpoints");
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await openAdvanced(user);
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
    render(<CheckpointsPanel />);

    await openAdvanced(user);
    const password = await screen.findByLabelText("Archive password");
    fireEvent.change(password, { target: { value: "😀😀😀😀😀😀😀" } });
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Password needs at least 8 characters.");
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
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await openAdvanced(user);
    expect(await screen.findByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });
});

describe("CheckpointsPanel project safety", () => {
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

      return <CheckpointsPanel />;
    }

    mocks.checkpointList.mockImplementation(async () => checkpoints);
    useFilesStore.setState({ projectId: "project-a", projectName: "Project A" });
    const user = userEvent.setup();
    const view = render(<ImmediateProjectSwitch switchProject={false} />);

    await user.click(await screen.findByRole("button", { name: "Delete V2" }));
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
      requestedProjectId === "project-b" ? { ...stats, checkpoint_count: 1 } : stats,
    );
    useFilesStore.setState({ projectId: "project-a", projectName: "Project A" });
    const user = userEvent.setup();
    render(<CheckpointsPanel />);

    await user.click(await screen.findByRole("button", { name: "Delete V2" }));
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
});
