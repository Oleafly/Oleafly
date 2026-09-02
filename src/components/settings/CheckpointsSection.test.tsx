// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@oleafly/backend-port";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  checkpointFiles: vi.fn(),
  checkpointInspect: vi.fn(),
  checkpointList: vi.fn(),
  checkpointRevealStore: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}));

vi.mock("@/lib/checkpoints", () => ({
  checkpointFiles: mocks.checkpointFiles,
  checkpointInspect: mocks.checkpointInspect,
  checkpointList: mocks.checkpointList,
  checkpointRevealStore: mocks.checkpointRevealStore,
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));

import { CheckpointsSection } from "./CheckpointsSection";

const config = {
  github_token: "",
  github_user: "",
  github_connected: false,
  ai_api_key: "",
  ai_provider: "openai",
  ai_model: "gpt-4o-mini",
  ai_keys: {},
  ai_system_prompt: "",
  ai_pdf_capture: true,
  ai_provider_models: {},
  ai_custom_providers: [],
  ai_personas: [],
  ai_starter_personas_seeded: false,
  checkpoints_enabled: true,
  checkpoint_notifications: true,
  mcp_enabled: false,
  mcp_port: 5323,
  mcp_read_only: false,
  mcp_approval_policy: "ask",
  mcp_servers: [],
} satisfies AppConfig;

const inspection = {
  store_path: "/tmp/.oleafly/history/project",
  catalog_path: "/tmp/.oleafly/history/project/catalog.sqlite",
  catalog_bytes: 4096,
  format_version: 2,
  lineage: "lineage-abc",
  table_counts: {
    checkpoints: 2,
    manifests: 2,
    packs: 1,
    chunks: 9,
    manifest_chunks: 4,
  },
  packs: [{ file_name: "pack-0001.pack", bytes: 2048, chunk_count: 9 }],
};

const emptyInspection = {
  store_path: null,
  catalog_path: null,
  catalog_bytes: 0,
  format_version: 0,
  lineage: null,
  table_counts: { checkpoints: 0, manifests: 0, packs: 0, chunks: 0, manifest_chunks: 0 },
  packs: [],
};

const checkpoints = [
  {
    snapshot_root: "root-newest",
    completed_at_unix_ms: 1_777_000_100_000,
    engine: "Tectonic",
    toolchain_identity: "tectonic@0.15.0",
    main_document: "main.tex",
    output_hash: "output-1",
    file_count: 2,
    logical_bytes: 4096,
  },
  {
    snapshot_root: "root-oldest",
    completed_at_unix_ms: 1_777_000_000_000,
    engine: "Tectonic",
    toolchain_identity: "tectonic@0.15.0",
    main_document: "main.tex",
    output_hash: "output-2",
    file_count: 1,
    logical_bytes: 2048,
  },
];

const files = [
  { path: "main.tex", bytes: 2048, content_hash: "hash-main", stored: true, replayed: true },
  {
    path: "scratch/notes.txt",
    bytes: 128,
    content_hash: "hash-notes",
    stored: false,
    replayed: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue(config);
  mocks.setConfig.mockResolvedValue(undefined);
  mocks.checkpointInspect.mockResolvedValue(inspection);
  mocks.checkpointList.mockResolvedValue(checkpoints);
  mocks.checkpointFiles.mockResolvedValue(files);
  mocks.checkpointRevealStore.mockResolvedValue(undefined);
  useFilesStore.setState({ projectId: "project" });
  useSettingsStore.setState({ settingsOpen: true, checkpointsOpen: false });
});

describe("CheckpointsSection", () => {
  it("writes both checkpoint switches back to the app config", async () => {
    const user = userEvent.setup();
    render(<CheckpointsSection />);

    const compileSwitch = await screen.findByRole("switch", {
      name: "Save a checkpoint after each successful compile",
    });
    const noticeSwitch = screen.getByRole("switch", {
      name: "Show a notice when a checkpoint is skipped",
    });
    expect(compileSwitch).toHaveAttribute("aria-checked", "true");
    expect(noticeSwitch).toHaveAttribute("aria-checked", "true");

    await user.click(compileSwitch);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({ ...config, checkpoints_enabled: false }),
    );
    expect(compileSwitch).toHaveAttribute("aria-checked", "false");

    await user.click(noticeSwitch);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({
        ...config,
        checkpoints_enabled: false,
        checkpoint_notifications: false,
      }),
    );
  });

  it("reports a failed config write without losing the section", async () => {
    mocks.setConfig.mockRejectedValueOnce(new Error("disk full"));
    const user = userEvent.setup();
    render(<CheckpointsSection />);

    await user.click(
      await screen.findByRole("switch", {
        name: "Save a checkpoint after each successful compile",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save checkpoint settings.",
    );
  });

  it("shows the store path, catalog size, and pack totals for the open project", async () => {
    render(<CheckpointsSection />);

    expect(await screen.findByText("/tmp/.oleafly/history/project")).toBeInTheDocument();
    expect(mocks.checkpointInspect).toHaveBeenCalledWith("project");
    const catalogSize = screen.getByText("Catalog size").parentElement as HTMLElement;
    expect(within(catalogSize).getByRole("definition")).toHaveTextContent("4 KB");
    const packSize = screen.getByText("Pack size").parentElement as HTMLElement;
    expect(within(packSize).getByRole("definition")).toHaveTextContent("2 KB");
  });

  it("reveals the store folder through the native handler", async () => {
    const user = userEvent.setup();
    render(<CheckpointsSection />);

    await user.click(await screen.findByRole("button", { name: /^Show in / }));

    expect(mocks.checkpointRevealStore).toHaveBeenCalledWith("project");
  });

  it("explains that no project is open", async () => {
    useFilesStore.setState({ projectId: null });
    render(<CheckpointsSection />);

    expect(
      await screen.findByText("Open a project to see where its checkpoints are stored."),
    ).toBeInTheDocument();
    expect(mocks.checkpointInspect).not.toHaveBeenCalled();
  });

  it("explains that the project has no store yet", async () => {
    mocks.checkpointInspect.mockResolvedValue(emptyInspection);
    render(<CheckpointsSection />);

    expect(
      await screen.findByText(
        "This project has no checkpoint store yet. One is created with its first checkpoint.",
      ),
    ).toBeInTheDocument();
  });

  it("inspects the catalog, its packs, and each checkpoint's files", async () => {
    const user = userEvent.setup();
    render(<CheckpointsSection />);

    await user.click(await screen.findByRole("button", { name: "Inspect catalog" }));

    expect(screen.getByText("Format version").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Lineage").nextElementSibling).toHaveTextContent("lineage-abc");
    expect(screen.getByText("Manifest chunks").nextElementSibling).toHaveTextContent("4");
    expect(screen.getByText("pack-0001.pack")).toBeInTheDocument();

    await waitFor(() => expect(mocks.checkpointList).toHaveBeenCalledWith("project"));
    const newest = await screen.findByRole("button", { name: "Show files for V2" });
    expect(screen.getByRole("button", { name: "Show files for V1" })).toBeInTheDocument();

    await user.click(newest);
    await waitFor(() =>
      expect(mocks.checkpointFiles).toHaveBeenCalledWith("project", "root-newest"),
    );
    expect(await screen.findByText("scratch/notes.txt")).toBeInTheDocument();
    expect(screen.getByText("Not stored")).toBeInTheDocument();
  });

  it("opens the Checkpoints window and closes settings", async () => {
    const user = userEvent.setup();
    render(<CheckpointsSection />);

    await user.click(await screen.findByRole("button", { name: "Open Checkpoints" }));

    expect(useSettingsStore.getState().checkpointsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });
});
