// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudState } from "@/lib/cloud";
import type { CloudBackupEntry, CloudBackupState, CloudBackupSummary } from "@/lib/cloud-backups";
import enCloud from "@/i18n/locales/en/cloud.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  cloudBackupState: vi.fn(),
  cloudBackupSetSettings: vi.fn(),
  cloudBackupRun: vi.fn(),
  cloudBackupList: vi.fn(),
  cloudBackupEntries: vi.fn(),
  cloudBackupRestore: vi.fn(),
  refreshProjects: vi.fn(async () => undefined),
}));

vi.mock("@/lib/cloud-backups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloud-backups")>()),
  cloudBackupState: mocks.cloudBackupState,
  cloudBackupSetSettings: mocks.cloudBackupSetSettings,
  cloudBackupRun: mocks.cloudBackupRun,
  cloudBackupList: mocks.cloudBackupList,
  cloudBackupEntries: mocks.cloudBackupEntries,
  cloudBackupRestore: mocks.cloudBackupRestore,
}));

import { loadNamespace } from "@/i18n";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { resetCloudBackupStoreForTest, useCloudBackupStore } from "@/store/cloud-backups";
import { useSettingsStore } from "@/store/settings";
import { CloudBackupsCard } from "./CloudBackupsCard";

const initialCloud = useCloudStore.getState();

function connect(status: "connected" | "revoked", enabled = true): void {
  useCloudStore.setState({ status, state: { status, enabled } as unknown as CloudState });
}

const strings = enCloud.backups;
const DAY = 24 * 60 * 60 * 1000;

function backupState(overrides: Partial<CloudBackupState> = {}): CloudBackupState {
  return {
    settings: { auto: true, everyHours: 24, keep: 30, includeProjects: false },
    lastRunMs: null,
    lastOkMs: null,
    lastError: null,
    last: null,
    running: false,
    due: true,
    ...overrides,
  };
}

const SUMMARY: CloudBackupSummary = {
  id: "1731312000000-0000abcd",
  device: "dev-a",
  deviceName: "Laptop",
  thisDevice: true,
  createdMs: Date.UTC(2026, 10, 11, 9, 0),
  scheduled: true,
  notes: 2,
  projects: 0,
  bytes: 4096,
};

const ENTRIES: CloudBackupEntry[] = [
  { id: "ideas", kind: "note", name: "Ideas", files: 2, bytes: 2048, here: true },
  { id: "gone", kind: "note", name: "Lost note", files: 1, bytes: 512, here: false },
];

beforeAll(async () => {
  await loadNamespace("cloud");
});

beforeEach(() => {
  resetCloudBackupStoreForTest();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.cloudBackupState.mockResolvedValue(backupState());
  mocks.cloudBackupSetSettings.mockImplementation(async (settings) => backupState({ settings }));
  mocks.cloudBackupList.mockResolvedValue([SUMMARY]);
  mocks.cloudBackupEntries.mockResolvedValue(ENTRIES);
  mocks.refreshProjects.mockResolvedValue(undefined);
  useFilesStore.setState({ refreshProjects: mocks.refreshProjects });
  connect("connected");
  useSettingsStore.setState({ notes: true });
});

afterEach(() => {
  useCloudStore.setState(initialCloud, true);
  useSettingsStore.setState({ notes: false });
});

async function openCard() {
  render(<CloudBackupsCard />);
  const toggle = await screen.findByRole("button", { name: new RegExp(strings.title) });
  fireEvent.click(toggle);
  return toggle;
}

describe("CloudBackupsCard", () => {
  it("stays hidden and reads nothing until Notes is turned on", async () => {
    useSettingsStore.setState({ notes: false });
    const { container } = render(<CloudBackupsCard />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.cloudBackupState).not.toHaveBeenCalled();
  });

  it("stays hidden while the cloud account's access is revoked", async () => {
    connect("revoked");
    const { container } = render(<CloudBackupsCard />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.cloudBackupState).not.toHaveBeenCalled();
  });

  it("keeps its controls while sync is turned off on this computer", async () => {
    connect("connected", false);
    render(<CloudBackupsCard />);
    expect(await screen.findByText(strings.none)).toBeInTheDocument();
    expect(screen.getByTestId("cloud-backup-now")).toBeEnabled();
  });

  it("says there are no backups yet and starts one by hand", async () => {
    mocks.cloudBackupRun.mockResolvedValue({ ran: true, outcome: null, error: null });
    render(<CloudBackupsCard />);
    expect(await screen.findByText(strings.none)).toBeInTheDocument();
    mocks.cloudBackupState.mockResolvedValue(
      backupState({ lastOkMs: Date.now() - 60_000, last: { notes: 3, projects: 1, bytes: 2048 } }),
    );
    fireEvent.click(screen.getByTestId("cloud-backup-now"));
    await waitFor(() => expect(mocks.cloudBackupRun).toHaveBeenCalledWith(false));
    expect(await screen.findByTestId("cloud-backups-summary")).toHaveTextContent(/3 notes · 1 project · 2(\.0)? KB/);
  });

  it("shows why the last backup failed", async () => {
    mocks.cloudBackupState.mockResolvedValue(backupState({ lastError: "Disk exploded" }));
    render(<CloudBackupsCard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk exploded");
  });

  it("saves each setting as it changes", async () => {
    await openCard();
    fireEvent.click(screen.getByRole("switch", { name: strings.includeProjects.label }));
    await waitFor(() =>
      expect(mocks.cloudBackupSetSettings).toHaveBeenLastCalledWith({ auto: true, everyHours: 24, keep: 30, includeProjects: true }),
    );
    fireEvent.click(screen.getByRole("switch", { name: strings.auto.label }));
    await waitFor(() => expect(useCloudBackupStore.getState().state?.settings.auto).toBe(false));
  });

  it("lists the backups once opened and restores a missing note from one", async () => {
    mocks.cloudBackupRestore.mockResolvedValue({
      restored: [{ from: "gone", to: "brave-teal-otter", name: "Lost note", copy: false }],
      here: ["Ideas"],
      failed: [],
    });
    await openCard();
    const row = await screen.findByTestId("cloud-backup-row");
    expect(row).toHaveTextContent("This computer");
    expect(row).toHaveTextContent("2 notes");
    fireEvent.click(within(row).getByRole("button", { name: /Restore the backup from/ }));

    const dialog = await screen.findByTestId("cloud-restore-dialog");
    expect(await within(dialog).findByText("Lost note")).toBeInTheDocument();
    expect(within(dialog).getByText(strings.restore.here)).toBeInTheDocument();
    expect(within(dialog).getByText(strings.restore.missing)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByTestId("cloud-restore-missing"));
    await waitFor(() =>
      expect(mocks.cloudBackupRestore).toHaveBeenCalledWith("dev-a", SUMMARY.id, null, expect.stringMatching(/^\(restored .+\)$/u)),
    );
    expect(await within(dialog).findByText(strings.restore.restored)).toBeInTheDocument();
    expect(mocks.refreshProjects).toHaveBeenCalled();
    expect(within(dialog).getByTestId("cloud-restore-missing")).toHaveTextContent(strings.restore.nothingMissing);
  });

  it("restores a note that is still here as a copy, and reports a failure on its row", async () => {
    mocks.cloudBackupRestore
      .mockResolvedValueOnce({ restored: [{ from: "ideas", to: "x", name: "Ideas (restored)", copy: true }], here: [], failed: [] })
      .mockResolvedValueOnce({ restored: [], here: [], failed: [{ id: "gone", name: "Lost note", error: "No room" }] });
    await openCard();
    fireEvent.click(await screen.findByRole("button", { name: /Restore the backup from/ }));
    const dialog = await screen.findByTestId("cloud-restore-dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Restore Ideas" }));
    expect(await within(dialog).findByText(strings.restore.restoredCopy)).toBeInTheDocument();
    expect(mocks.cloudBackupRestore).toHaveBeenLastCalledWith("dev-a", SUMMARY.id, ["ideas"], expect.any(String));
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore Lost note" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No room");
  });

  it("says when the cloud has no backups yet", async () => {
    mocks.cloudBackupList.mockResolvedValue([]);
    await openCard();
    expect(await screen.findByText(/No backups in .+ yet\./u)).toBeInTheDocument();
  });

  it("formats an older backup with its date", async () => {
    mocks.cloudBackupState.mockResolvedValue(
      backupState({ lastOkMs: Date.now() - 3 * DAY, last: { notes: 1, projects: 0, bytes: 10 } }),
    );
    render(<CloudBackupsCard />);
    expect(await screen.findByTestId("cloud-backups-summary")).toHaveTextContent(/3 days ago · 1 note/u);
  });
});
