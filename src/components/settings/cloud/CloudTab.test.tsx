// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudProject, CloudState } from "@/lib/cloud";

const mocks = vi.hoisted(() => ({
  cloud: {
    cloudState: vi.fn(),
    cloudDetails: vi.fn(),
    cloudConnectBegin: vi.fn(),
    cloudConnectWait: vi.fn(),
    cloudConnectPaste: vi.fn(),
    cloudConnectCancel: vi.fn(async () => undefined),
    cloudDisconnect: vi.fn(async () => undefined),
    cloudSetEnabled: vi.fn(async () => undefined),
    cloudSetDeviceName: vi.fn(async () => undefined),
    cloudSyncNow: vi.fn(),
    cloudProjectSetMode: vi.fn(async () => undefined),
    cloudProjectResolveHold: vi.fn(),
    cloudProjectRemove: vi.fn(async () => undefined),
    cloudDownloadProject: vi.fn(),
    cloudSettingsSync: vi.fn(async () => ({ outcome: "current" })),
    cloudSettingsDownload: vi.fn(),
    cloudSettingsApplied: vi.fn(async () => undefined),
    cloudSettingsKeepLocal: vi.fn(async () => undefined),
  },
  open: vi.fn(async () => undefined),
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    successUnique: vi.fn(),
    infoUnique: vi.fn(),
    errorUnique: vi.fn(),
  },
  refreshProjects: vi.fn(async () => undefined),
}));

vi.mock("@/lib/cloud", () => mocks.cloud);
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/cloud-settings", () => ({
  gatherCloudSettings: vi.fn(async () => ({})),
  applyCloudSettings: vi.fn(async () => ({})),
}));

import { loadNamespace } from "@/i18n/lazy-namespaces";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { CloudTab } from "./CloudTab";
import { storageTone } from "./StorageRing";

const initialCloud = useCloudStore.getState();

function project(overrides: Partial<CloudProject>): CloudProject {
  return {
    localId: "thesis",
    cloudId: "c-thesis",
    name: "Thesis",
    mode: "sync",
    lastSyncedMs: 0,
    sizeBytes: 0,
    error: null,
    conflicts: 0,
    skipped: 0,
    hold: null,
    recycled: false,
    removedBy: null,
    ...overrides,
  };
}

function cloudState(overrides: Partial<CloudState> = {}): CloudState {
  return {
    status: "connected",
    email: "ada@uni.edu",
    displayName: "Ada",
    deviceName: "Desk",
    enabled: true,
    lastEmail: "ada@uni.edu",
    lastSyncedMs: 0,
    lastError: null,
    quotaFull: false,
    linkedCount: 0,
    projects: [],
    ...overrides,
  };
}

function serve(state: CloudState, details: { used: number; allocated: number } | null = null, remote: CloudProject[] = []) {
  mocks.cloud.cloudState.mockResolvedValue(state);
  mocks.cloud.cloudDetails.mockResolvedValue({ space: details, remote, error: null });
}

async function openProjects() {
  await userEvent.click(await screen.findByTestId("cloud-projects-toggle"));
}

beforeAll(async () => {
  await loadNamespace("cloud");
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useCloudStore.setState(initialCloud, true);
  useSettingsStore.setState({ cloudSync: true });
  useCloudStore.setState({ syncInterval: "1m" });
  useFilesStore.setState({ refreshProjects: mocks.refreshProjects });
  mocks.cloud.cloudSyncNow.mockResolvedValue({ projects: [], lastSyncedMs: 1, error: null });
  serve(cloudState({ status: "disconnected", email: null }));
});

describe("CloudTab", () => {
  it("keeps the placeholder while the experiment is off and nothing is connected", async () => {
    useSettingsStore.setState({ cloudSync: false });
    render(<CloudTab />);
    expect(screen.getByText(/own Dropbox/i)).toBeInTheDocument();
    await waitFor(() => expect(mocks.cloud.cloudState).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Connect Dropbox/ })).toBeNull();
    expect(mocks.cloud.cloudDetails).not.toHaveBeenCalled();
  });

  it("still offers Disconnect for an account connected while the experiment is off", async () => {
    useSettingsStore.setState({ cloudSync: false });
    serve(cloudState());
    render(<CloudTab />);
    expect(await screen.findByText("ada@uni.edu")).toBeInTheDocument();
    expect(screen.getByText(/turned off in Experimentation/)).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-projects")).toBeNull();
    expect(screen.getByTestId("cloud-disconnect")).toBeInTheDocument();
    expect(mocks.cloud.cloudDetails).not.toHaveBeenCalled();
  });

  it("explains what syncs and connects with a busy button", async () => {
    let begin!: (value: unknown) => void;
    mocks.cloud.cloudConnectBegin.mockReturnValue(new Promise((resolve) => (begin = resolve)));
    render(<CloudTab />);
    const provider = await screen.findByTestId("cloud-provider-dropbox");
    expect(provider).toHaveTextContent("Git history and checkpoints don't sync yet.");
    expect(provider).toHaveTextContent("AI chats, passwords and keys never leave this computer.");
    expect(provider).not.toHaveTextContent(/skills|templates/i);
    await userEvent.click(screen.getByRole("button", { name: /Connect Dropbox/ }));
    expect(mocks.cloud.cloudConnectBegin).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("cloud-connect")).toBeDisabled();
    mocks.cloud.cloudConnectWait.mockReturnValue(new Promise(() => {}));
    await act(async () => begin({ flowId: "f1", authUrl: "https://www.dropbox.com/oauth2/authorize", paste: false }));
    expect(await screen.findByTestId("cloud-connect-panel")).toBeInTheDocument();
    expect(mocks.open).toHaveBeenCalledWith("https://www.dropbox.com/oauth2/authorize");
  });

  it("keeps the panel and the open paste section while the paste flow starts", async () => {
    mocks.cloud.cloudConnectWait.mockReturnValue(new Promise(() => {}));
    mocks.cloud.cloudConnectBegin.mockResolvedValueOnce({ flowId: "f1", authUrl: "https://a", paste: false });
    let pasteBegin!: (value: unknown) => void;
    mocks.cloud.cloudConnectBegin.mockReturnValueOnce(new Promise((resolve) => (pasteBegin = resolve)));
    render(<CloudTab />);
    await userEvent.click(await screen.findByRole("button", { name: /Connect Dropbox/ }));
    await screen.findByTestId("cloud-connect-panel");
    await userEvent.click(screen.getByText(/Paste a code instead/));
    expect(mocks.cloud.cloudConnectBegin).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("cloud-connect-panel")).toBeInTheDocument();
    expect(screen.getByLabelText(/Code from Dropbox/)).toBeDisabled();
    await act(async () => pasteBegin({ flowId: "f2", authUrl: "https://b", paste: true }));
    expect(mocks.cloud.cloudConnectCancel).toHaveBeenCalledWith("f1");
    const input = screen.getByLabelText(/Code from Dropbox/);
    expect(input).toBeEnabled();
    let finish!: (value: unknown) => void;
    mocks.cloud.cloudConnectPaste.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await userEvent.type(input, "code-42");
    await userEvent.click(screen.getByTestId("cloud-paste-submit"));
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(mocks.cloud.cloudConnectPaste).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.cloudConnectPaste).toHaveBeenCalledWith("f2", "code-42");
    serve(cloudState());
    await act(async () => finish({ email: "ada@uni.edu" }));
    expect(await screen.findByText("ada@uni.edu")).toBeInTheDocument();
    expect(useCloudStore.getState().connectError).toBeNull();
  });

  it("shows the account, the storage ring and the sync controls when connected", async () => {
    serve(cloudState(), { used: 1_288_490_189, allocated: 2_147_483_648 });
    render(<CloudTab />);
    const provider = await screen.findByTestId("cloud-provider-dropbox");
    expect(within(provider).getByText("Connected")).toBeInTheDocument();
    expect(within(provider).getByText("ada@uni.edu")).toBeInTheDocument();
    const ring = await screen.findByRole("progressbar", { name: "Dropbox storage" });
    expect(ring).toHaveAttribute("aria-valuenow", "60");
    expect(ring).toHaveAttribute("aria-valuetext", "1.2 GB of 2 GB used");
    const storage = screen.getByTestId("cloud-storage");
    expect(storage).toHaveAttribute("data-tone", "filling");
    expect(storage).toHaveTextContent("60%");
    expect(storage).toHaveTextContent("1.2 GB of 2 GB used");
    expect(storage).toHaveTextContent("819.2 MB free");
    expect(screen.getByRole("switch", { name: "Sync on this computer" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("cloud-computer-name")).toHaveTextContent("Desk");
    expect(screen.getByRole("button", { name: "About cloud sync" })).toBeInTheDocument();
  });

  it("hides the storage ring when the space is unknown", async () => {
    serve(cloudState(), { used: 10, allocated: 0 });
    render(<CloudTab />);
    await screen.findByTestId("cloud-provider-dropbox");
    await waitFor(() => expect(mocks.cloud.cloudDetails).toHaveBeenCalled());
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("colours the storage ring by how full Dropbox is", () => {
    expect(storageTone(0)).toBe("roomy");
    expect(storageTone(49.9)).toBe("roomy");
    expect(storageTone(50)).toBe("filling");
    expect(storageTone(64.9)).toBe("filling");
    expect(storageTone(65)).toBe("tight");
    expect(storageTone(79.9)).toBe("tight");
    expect(storageTone(80)).toBe("full");
    expect(storageTone(100)).toBe("full");
  });

  it("asks to connect again when access ended", async () => {
    serve(cloudState({ status: "revoked" }));
    mocks.cloud.cloudConnectBegin.mockReturnValue(new Promise(() => {}));
    render(<CloudTab />);
    const banner = await screen.findByTestId("cloud-revoked");
    expect(banner).toHaveTextContent("Dropbox access ended. Connect again to keep syncing.");
    expect(screen.getByText("Access ended")).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole("button", { name: "Connect again" }));
    expect(mocks.cloud.cloudConnectBegin).toHaveBeenCalledWith(false);
    expect(mocks.cloud.cloudDetails).not.toHaveBeenCalled();
  });

  it("warns when Dropbox is full", async () => {
    serve(cloudState({ quotaFull: true }));
    render(<CloudTab />);
    expect(await screen.findByTestId("cloud-quota-full")).toHaveTextContent(/New changes stay on this computer/);
    expect(screen.getByText("Dropbox full")).toBeInTheDocument();
  });

  it("stores the automatic sync choice for this computer", async () => {
    serve(cloudState());
    render(<CloudTab />);
    const trigger = await screen.findByTestId("cloud-sync-interval-trigger");
    expect(trigger).toHaveTextContent("Every minute");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Only when I choose Sync now" }));
    expect(useCloudStore.getState().syncInterval).toBe("manual");
    expect(localStorage.getItem("oleafly.cloudSync.interval")).toBe("manual");
  });

  it("lists local and Dropbox-only projects with their controls", async () => {
    serve(
      cloudState({
        linkedCount: 2,
        lastSyncedMs: Date.now() - 5 * 60_000,
        projects: [
          project({ lastSyncedMs: Date.now() - 5 * 60_000, sizeBytes: 2048, conflicts: 2 }),
          project({ localId: "draft", cloudId: "c-draft", name: "Draft", mode: "pause", lastSyncedMs: 1 }),
          project({ localId: "old", cloudId: "c-old", name: "Old", mode: "removed", removedBy: "Laptop" }),
        ],
      }),
      null,
      [
        project({ localId: null, cloudId: "c-notes", name: "Notes", mode: "download" }),
        project({ localId: null, cloudId: "c-bin", name: "Binned", mode: "download", recycled: true }),
      ],
    );
    render(<CloudTab />);
    await waitFor(() => expect(screen.getByTestId("cloud-projects")).toHaveTextContent("2 only in Dropbox"));
    expect(screen.getByTestId("cloud-projects")).toHaveTextContent("1 synced, 2 paused, 2 only in Dropbox");
    expect(screen.getByTestId("cloud-sync-status")).toHaveTextContent("Last synced 5 minutes ago");
    expect(screen.queryByText("Thesis")).toBeNull();
    await openProjects();
    const rows = screen.getAllByTestId("cloud-project-row");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Synced 5 minutes ago");
    expect(rows[0]).toHaveTextContent("2 conflict copies were made");
    expect(rows[0]).toHaveTextContent("2 KB");
    expect(rows[1]).toHaveTextContent("Paused on this computer");
    expect(rows[2]).toHaveTextContent("Removed from Dropbox on Laptop");
    expect(within(rows[2]).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(rows[3]).toHaveTextContent("Only in Dropbox");
    expect(rows[4]).toHaveTextContent("In your Recycle Bin");
    expect(screen.getByTitle("Thesis")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Binned from the Recycle Bin" })).toBeInTheDocument();
    expect(screen.getByText(/2 projects opened from a folder aren't synced/)).toBeInTheDocument();
  });

  it("turns a removed project back on so it uploads again", async () => {
    serve(cloudState({ projects: [project({ mode: "removed", removedBy: "Laptop" })] }));
    render(<CloudTab />);
    await openProjects();
    await userEvent.click(screen.getByRole("switch", { name: "Sync Thesis on this computer" }));
    expect(mocks.cloud.cloudProjectSetMode).toHaveBeenCalledWith("thesis", "sync");
    await waitFor(() => expect(mocks.cloud.cloudSyncNow).toHaveBeenCalled());
  });

  it("downloads one project from its icon button", async () => {
    serve(cloudState(), null, [project({ localId: null, cloudId: "c-notes", name: "Notes", mode: "download" })]);
    mocks.cloud.cloudDownloadProject.mockResolvedValue({ localId: "notes", restored: false });
    render(<CloudTab />);
    await openProjects();
    await userEvent.click(await screen.findByRole("button", { name: "Download Notes" }));
    expect(mocks.cloud.cloudDownloadProject).toHaveBeenCalledWith("c-notes");
    await waitFor(() =>
      expect(mocks.toast.successUnique).toHaveBeenCalledWith("cloud-download", "Notes is on this computer now."),
    );
    expect(mocks.refreshProjects).toHaveBeenCalled();
  });

  it("downloads every Dropbox-only project one after another with one summary", async () => {
    serve(cloudState(), null, [
      project({ localId: null, cloudId: "c1", name: "One", mode: "download" }),
      project({ localId: null, cloudId: "c2", name: "Two", mode: "download" }),
    ]);
    const releases: (() => void)[] = [];
    mocks.cloud.cloudDownloadProject.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve({ localId: "x", restored: false }))),
    );
    render(<CloudTab />);
    const button = await screen.findByTestId("cloud-download-all");
    await userEvent.click(button);
    expect(button).toHaveTextContent("Downloading 1 of 2");
    expect(mocks.cloud.cloudDownloadProject).toHaveBeenCalledTimes(1);
    await act(async () => releases[0]());
    await waitFor(() => expect(button).toHaveTextContent("Downloading 2 of 2"));
    expect(mocks.cloud.cloudDownloadProject).toHaveBeenLastCalledWith("c2");
    await act(async () => releases[1]());
    await waitFor(() =>
      expect(mocks.toast.successUnique).toHaveBeenCalledWith("cloud-download", "Downloaded 2 projects."),
    );
    expect(mocks.toast.successUnique).toHaveBeenCalledTimes(1);
  });

  it("puts held files back, and deletes them from Dropbox only after confirming", async () => {
    serve(
      cloudState({ projects: [project({ mode: "held", hold: { kind: "massDelete", count: 12, total: 40 } })] }),
    );
    mocks.cloud.cloudProjectResolveHold.mockResolvedValue({
      localId: "thesis",
      uploaded: 0,
      downloaded: 12,
      deletedRemote: 0,
      deletedLocal: 0,
      conflicts: 0,
      skipped: 0,
      held: false,
      error: null,
    });
    render(<CloudTab />);
    const held = await screen.findByTestId("cloud-project-held");
    expect(held).toHaveTextContent("12 of 40 files were deleted here");
    await userEvent.click(within(held).getByRole("button", { name: "Put them back" }));
    expect(mocks.cloud.cloudProjectResolveHold).toHaveBeenCalledWith("thesis", "restore");
    await waitFor(() => expect(within(held).getByRole("button", { name: "Delete from Dropbox too" })).toBeEnabled());
    await userEvent.click(within(held).getByRole("button", { name: "Delete from Dropbox too" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("The 12 files you deleted from Thesis");
    expect(mocks.cloud.cloudProjectResolveHold).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete from Dropbox" }));
    expect(mocks.cloud.cloudProjectResolveHold).toHaveBeenLastCalledWith("thesis", "delete");
  });

  it("removes a project from Dropbox only after confirming", async () => {
    serve(cloudState({ projects: [project({ lastSyncedMs: 5 })] }));
    render(<CloudTab />);
    await openProjects();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Thesis" }), { button: 0, ctrlKey: false });
    await userEvent.click(await screen.findByTestId("cloud-project-remove"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Remove Thesis from Dropbox?");
    expect(dialog).toHaveTextContent("The project stays on this computer");
    expect(mocks.cloud.cloudProjectRemove).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove from Dropbox" }));
    expect(mocks.cloud.cloudProjectRemove).toHaveBeenCalledWith("thesis");
  });

  it("disconnects only after confirming and clears the last round", async () => {
    serve(cloudState());
    render(<CloudTab />);
    await userEvent.click(await screen.findByTestId("cloud-disconnect"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Your projects stay on this computer and in your Dropbox.");
    expect(mocks.cloud.cloudDisconnect).not.toHaveBeenCalled();
    useCloudStore.setState({ syncError: "boom", lastReport: { projects: [], lastSyncedMs: 1, error: null } });
    serve(cloudState({ status: "disconnected" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    expect(mocks.cloud.cloudDisconnect).toHaveBeenCalledTimes(1);
    await screen.findByRole("button", { name: /Connect Dropbox/ });
    expect(useCloudStore.getState().syncError).toBeNull();
    expect(useCloudStore.getState().lastReport).toBeNull();
  });

  it("toasts the result of Sync now once", async () => {
    serve(cloudState());
    render(<CloudTab />);
    await userEvent.click(await screen.findByTestId("cloud-sync-now"));
    await waitFor(() =>
      expect(mocks.toast.successUnique).toHaveBeenCalledWith("cloud-sync", "Everything is synced."),
    );
    expect(mocks.cloud.cloudSyncNow).toHaveBeenCalledWith([]);
  });

  it("shows a quiet line when Dropbox can't be reached", async () => {
    serve(
      cloudState({
        lastError: '@oleafly/error:{"code":"cloud.network","params":{}}',
        projects: [project({})],
      }),
    );
    render(<CloudTab />);
    expect(await screen.findByTestId("cloud-sync-status")).toHaveTextContent(
      "Couldn't reach Dropbox. Oleafly will try again.",
    );
  });

  it("returns to General when a pending cloud import is ready", async () => {
    serve(cloudState());
    useCloudStore.setState({ settingsImport: "resume" });
    render(<CloudTab />);
    await waitFor(() => expect(useCloudStore.getState().navRequest).toBe("general"));
  });
});
