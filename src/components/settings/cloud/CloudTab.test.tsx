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
    cloudProjectDismissConflicts: vi.fn(async () => undefined),
    cloudProjectReplaceRemote: vi.fn(),
    cloudProjectRemove: vi.fn(async () => undefined),
    cloudRemoveRemote: vi.fn(async () => undefined),
    cloudDownloadProject: vi.fn(),
    cloudSettingsSync: vi.fn(async () => ({ outcome: "current" })),
    cloudSettingsDownload: vi.fn(),
    cloudSettingsApplied: vi.fn(async () => undefined),
    cloudSettingsKeepLocal: vi.fn(async () => undefined),
    cloudSettingsDefer: vi.fn(async () => undefined),
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
    skippedFiles: [],
    conflictCopies: [],
    hold: null,
    recycled: false,
    removedBy: null,
    pendingFiles: null,
    uploadingFrom: null,
    ...overrides,
  };
}

const UNREADABLE = '@oleafly/error:{"code":"cloud.remote_unreadable","params":{}}';

function holdReport() {
  return {
    localId: "thesis",
    uploaded: 0,
    downloaded: 12,
    deletedRemote: 0,
    deletedLocal: 0,
    conflicts: 0,
    skipped: 0,
    held: false,
    error: null,
    changed: [],
    changedTruncated: false,
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
  useCloudStore.setState({ autoSync: true });
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
    expect(screen.queryByTestId("cloud-disconnect")).toBeNull();
    await userEvent.click(screen.getByTestId("cloud-advanced-toggle"));
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
    expect(within(provider).queryByText("Connected")).toBeNull();
    expect(within(provider).getByText("ada@uni.edu")).toBeInTheDocument();
    const ring = await screen.findByRole("progressbar", { name: "Dropbox storage" });
    expect(ring).toHaveAttribute("value", "60");
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
    const alert = within(banner).getByRole("alert");
    expect(alert).toHaveTextContent("Dropbox access ended.");
    expect(within(alert).queryByRole("button")).toBeNull();
    expect(screen.getByText("Access ended")).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole("button", { name: "Connect again" }));
    expect(mocks.cloud.cloudConnectBegin).toHaveBeenCalledWith(false);
    expect(mocks.cloud.cloudDetails).not.toHaveBeenCalled();
  });

  it("warns when Dropbox is full", async () => {
    serve(cloudState({ quotaFull: true }));
    render(<CloudTab />);
    const notice = await screen.findByTestId("cloud-quota-full");
    expect(notice).toHaveTextContent(/New changes stay on this computer/);
    expect(within(notice).getByRole("status")).toHaveTextContent(/Your Dropbox is full/);
    expect(within(notice).queryByRole("alert")).toBeNull();
    expect(screen.getByText("Dropbox full")).toBeInTheDocument();
  });

  it("stores the automatic sync choice for this computer", async () => {
    localStorage.setItem("oleafly.cloudSync.interval", "5m");
    serve(cloudState());
    render(<CloudTab />);
    const auto = await screen.findByRole("switch", { name: "Sync automatically" });
    expect(auto).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("cloud-sync-auto")).toHaveTextContent(/as soon as another computer changes your Dropbox/);
    await userEvent.click(auto);
    expect(useCloudStore.getState().autoSync).toBe(false);
    expect(localStorage.getItem("oleafly.cloudSync.auto")).toBe("off");
    expect(localStorage.getItem("oleafly.cloudSync.interval")).toBeNull();
    expect(auto).toHaveAttribute("aria-checked", "false");
  });

  it("shows what a round is moving, what another computer is still uploading, and a resumed project waiting", async () => {
    serve(
      cloudState({
        projects: [
          project({ lastSyncedMs: Date.now() - 60_000 }),
          project({ localId: "notes", cloudId: "c-notes", name: "Notes", mode: "sync", lastSyncedMs: Date.now() - 60_000 }),
        ],
      }),
      { used: 1, allocated: 100 },
      [
        project({
          localId: null,
          cloudId: "c-stats",
          name: "Stats",
          mode: "download",
          sizeBytes: 2048,
          pendingFiles: 844,
          uploadingFrom: "Laptop",
        }),
        project({ localId: null, cloudId: "c-old", name: "Old", mode: "download", sizeBytes: 0, pendingFiles: 3 }),
      ],
    );
    render(<CloudTab />);
    await openProjects();
    act(() => {
      useCloudStore.getState().noteProgress({ projectId: "thesis", cloudId: "c-thesis", phase: "uploading", done: 312, total: 1144 });
      useCloudStore.getState().noteProgress({ projectId: null, cloudId: "c-stats", phase: "fetching", done: 1024, total: 4096 });
      useCloudStore.setState({ resumedAt: { notes: Date.now() } });
    });
    const rows = await screen.findAllByTestId("cloud-project-row");
    const thesis = rows.find((row) => within(row).queryByText("Thesis"));
    const bar = within(thesis as HTMLElement).getByRole("progressbar");
    expect(bar).toHaveAccessibleName("Uploading 312 of 1,144 files");
    expect(bar).toHaveAttribute("aria-valuenow", "312");
    const stats = rows.find((row) => within(row).queryByText("Stats")) as HTMLElement;
    expect(within(stats).getByRole("progressbar")).toHaveAccessibleName("Downloading 1 KB of 4 KB");
    act(() => {
      useCloudStore.getState().noteProgress({ projectId: null, cloudId: "c-stats", phase: "fetching", done: 4096, total: 4096 });
    });
    expect(within(stats).queryByRole("progressbar")).toBeNull();
    expect(stats).toHaveTextContent("Still uploading from Laptop");
    expect(stats).toHaveTextContent("2 KB so far");
    const old = rows.find((row) => within(row).queryByText("Old")) as HTMLElement;
    expect(old).toHaveTextContent("Still uploading from another computer");
    const notes = rows.find((row) => within(row).queryByText("Notes")) as HTMLElement;
    expect(notes).toHaveTextContent("Waiting to sync");
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
    mocks.cloud.cloudProjectResolveHold.mockResolvedValue(holdReport());
    render(<CloudTab />);
    const held = await screen.findByTestId("cloud-project-held");
    expect(held).toHaveTextContent("12 of 40 files were deleted here");
    await userEvent.click(within(held).getByRole("button", { name: "Put them back" }));
    expect(mocks.cloud.cloudProjectResolveHold).toHaveBeenCalledWith("thesis", "restore", []);
    await waitFor(() => expect(within(held).getByRole("button", { name: "Delete from Dropbox too" })).toBeEnabled());
    await userEvent.click(within(held).getByRole("button", { name: "Delete from Dropbox too" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("The 12 files you deleted from Thesis");
    expect(mocks.cloud.cloudProjectResolveHold).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete from Dropbox" }));
    expect(mocks.cloud.cloudProjectResolveHold).toHaveBeenLastCalledWith("thesis", "delete", []);
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

  it("renames this computer in place and cancels with Escape", async () => {
    serve(cloudState());
    render(<CloudTab />);
    await userEvent.click(await screen.findByTestId("cloud-computer-rename"));
    const field = screen.getByRole("textbox", { name: "Name for this computer" });
    expect(field).toHaveValue("Desk");
    await userEvent.clear(field);
    await userEvent.type(field, "Laptop{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name for this computer" })).toBeNull();
    expect(mocks.cloud.cloudSetDeviceName).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("cloud-computer-rename"));
    const again = screen.getByRole("textbox", { name: "Name for this computer" });
    await userEvent.clear(again);
    serve(cloudState({ deviceName: "Laptop" }));
    await userEvent.type(again, "Laptop{Enter}");
    expect(mocks.cloud.cloudSetDeviceName).toHaveBeenCalledWith("Laptop");
    await waitFor(() => expect(screen.getByTestId("cloud-computer-name")).toHaveTextContent("Laptop"));
    expect(screen.queryByRole("textbox", { name: "Name for this computer" })).toBeNull();
  });

  it("disconnects only after confirming and clears the last round", async () => {
    serve(cloudState());
    render(<CloudTab />);
    await userEvent.click(await screen.findByTestId("cloud-advanced-toggle"));
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

  it("shows a loading row while Dropbox is checked instead of saying there are no projects", async () => {
    let finish!: (value: unknown) => void;
    mocks.cloud.cloudState.mockResolvedValue(cloudState());
    mocks.cloud.cloudDetails.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<CloudTab />);
    await openProjects();
    expect(await screen.findByTestId("cloud-remote-loading")).toHaveTextContent("Checking your Dropbox");
    expect(screen.getByTestId("cloud-projects")).toHaveTextContent("Checking your Dropbox");
    expect(screen.queryByText(/No projects yet/)).toBeNull();
    await act(async () => finish({ space: null, remote: [], error: null }));
    expect(await screen.findByText("No projects yet. Projects you create in your Library will sync.")).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-remote-loading")).toBeNull();
  });

  it("offers Try again when the Dropbox list can't be loaded", async () => {
    mocks.cloud.cloudState.mockResolvedValue(cloudState());
    mocks.cloud.cloudDetails.mockRejectedValueOnce('@oleafly/error:{"code":"cloud.network","params":{}}');
    render(<CloudTab />);
    await openProjects();
    const failed = await screen.findByTestId("cloud-remote-error");
    expect(failed).toHaveTextContent("Couldn't load the projects in your Dropbox.");
    expect(screen.queryByText(/No projects yet/)).toBeNull();
    mocks.cloud.cloudDetails.mockResolvedValueOnce({
      space: null,
      remote: [project({ localId: null, cloudId: "c-notes", name: "Notes", mode: "download" })],
      error: null,
    });
    await userEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Notes")).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-remote-error")).toBeNull();
  });

  it("removes a Dropbox-only project from Dropbox after confirming", async () => {
    serve(cloudState(), null, [project({ localId: null, cloudId: "c-notes", name: "Notes", mode: "download" })]);
    render(<CloudTab />);
    await openProjects();
    fireEvent.pointerDown(await screen.findByRole("button", { name: "More actions for Notes" }), {
      button: 0,
      ctrlKey: false,
    });
    await userEvent.click(await screen.findByTestId("cloud-project-remove"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Remove Notes from Dropbox?");
    expect(dialog).toHaveTextContent("It isn't on this computer, so you can't download it here afterwards.");
    expect(mocks.cloud.cloudRemoveRemote).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove from Dropbox" }));
    expect(mocks.cloud.cloudRemoveRemote).toHaveBeenCalledWith("c-notes");
    await waitFor(() =>
      expect(mocks.toast.successUnique).toHaveBeenCalledWith("cloud-action", "Notes was removed from your Dropbox."),
    );
  });

  it("hides Download all when the only Dropbox projects are in the Recycle Bin", async () => {
    serve(cloudState(), null, [project({ localId: null, cloudId: "c-bin", name: "Binned", mode: "download", recycled: true })]);
    render(<CloudTab />);
    await waitFor(() => expect(screen.getByTestId("cloud-projects")).toHaveTextContent("1 only in Dropbox"));
    expect(screen.queryByTestId("cloud-download-all")).toBeNull();
  });

  it("lists skipped files with a reason and how many more there are", async () => {
    serve(
      cloudState({
        projects: [
          project({
            lastSyncedMs: Date.now(),
            skipped: 4,
            skippedFiles: [
              { path: "figures/CON.png", reason: "unsupportedName" },
              { path: "data/huge.bin", reason: "tooLarge" },
              { path: "notes.md", reason: "uploadFailed" },
            ],
          }),
        ],
      }),
    );
    render(<CloudTab />);
    await openProjects();
    const toggle = screen.getByTestId("cloud-project-skipped");
    expect(toggle).toHaveTextContent("4 files were skipped");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("figures/CON.png")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Skipped files in Thesis" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("figures/CON.png");
    expect(items[0]).toHaveTextContent("Name that doesn't work on every computer");
    expect(items[1]).toHaveTextContent("data/huge.bin");
    expect(items[1]).toHaveTextContent("Too large to sync");
    expect(items[2]).toHaveTextContent("notes.md");
    expect(items[2]).toHaveTextContent("Couldn't be uploaded");
    expect(items[3]).toHaveTextContent("And 1 more file");
  });

  it("lists conflict copies and dismisses them", async () => {
    serve(
      cloudState({
        projects: [
          project({
            lastSyncedMs: Date.now(),
            conflicts: 2,
            conflictCopies: ["main (Laptop 2026-10-14).tex", "refs (Laptop 2026-10-14).bib"],
          }),
        ],
      }),
    );
    render(<CloudTab />);
    const notice = await screen.findByTestId("cloud-project-conflicts");
    expect(notice).toHaveTextContent("2 conflict copies were made");
    expect(notice).toHaveTextContent("so Oleafly kept both");
    const list = within(notice).getByRole("list", { name: "Conflict copies in Thesis" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "main (Laptop 2026-10-14).tex",
      "refs (Laptop 2026-10-14).bib",
    ]);
    expect(within(within(notice).getByRole("status")).queryByRole("button")).toBeNull();
    serve(cloudState({ projects: [project({ lastSyncedMs: Date.now() })] }));
    await userEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(mocks.cloud.cloudProjectDismissConflicts).toHaveBeenCalledWith("thesis");
    await waitFor(() => expect(screen.queryByTestId("cloud-project-conflicts")).toBeNull());
  });

  it("replaces an unreadable copy in Dropbox only after confirming", async () => {
    serve(cloudState({ projects: [project({ lastSyncedMs: 5, error: UNREADABLE })] }));
    mocks.cloud.cloudProjectReplaceRemote.mockResolvedValue({ ...holdReport(), downloaded: 0, uploaded: 4 });
    render(<CloudTab />);
    const notice = await screen.findByTestId("cloud-project-unreadable");
    expect(within(notice).getByRole("alert")).toHaveTextContent(
      "Oleafly can't read the copy in your Dropbox, so this project isn't syncing.",
    );
    expect(notice).not.toHaveTextContent(/try again/i);
    await userEvent.click(within(notice).getByRole("button", { name: "Replace with this computer's copy" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Replace the copy of Thesis in Dropbox?");
    expect(mocks.cloud.cloudProjectReplaceRemote).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(mocks.cloud.cloudProjectReplaceRemote).toHaveBeenCalledWith("thesis", []);
  });

  it("says a project with too many files can't sync without promising to try again", async () => {
    serve(
      cloudState({
        projects: [project({ lastSyncedMs: 5, error: '@oleafly/error:{"code":"cloud.too_many_files","params":{}}' })],
      }),
    );
    render(<CloudTab />);
    const row = await screen.findByTestId("cloud-project-row");
    expect(row).toHaveTextContent("This project has more than 100,000 files. That's too many to sync.");
    expect(row).not.toHaveTextContent(/try again/i);
  });

  it("offers a put-off settings choice in the card instead of a dialog", async () => {
    serve(cloudState());
    useCloudStore.setState({ settingsChoice: { values: { a: 1 }, stamp: "6", deferred: true } });
    render(<CloudTab />);
    const notice = await screen.findByTestId("cloud-settings-waiting");
    expect(notice).toHaveTextContent("Which settings should Oleafly use?");
    expect(screen.queryByTestId("cloud-settings-choice")).toBeNull();
    await userEvent.click(within(notice).getByRole("button", { name: "Use Dropbox settings" }));
    expect(mocks.cloud.cloudSettingsApplied).toHaveBeenCalledWith("6", {});
    await waitFor(() => expect(screen.queryByTestId("cloud-settings-waiting")).toBeNull());
  });

  it("replaces unreadable settings in Dropbox with this computer's", async () => {
    serve(cloudState());
    useCloudStore.setState({ settingsProblem: UNREADABLE });
    render(<CloudTab />);
    const notice = await screen.findByTestId("cloud-settings-problem");
    expect(notice).toHaveTextContent("Oleafly can't read the settings in your Dropbox. They won't sync until you replace them.");
    await userEvent.click(within(notice).getByRole("button", { name: "Use this computer's settings" }));
    expect(mocks.cloud.cloudSettingsKeepLocal).toHaveBeenCalledWith({});
    await waitFor(() => expect(screen.queryByTestId("cloud-settings-problem")).toBeNull());
  });
});
