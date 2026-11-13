// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudState } from "@/lib/cloud";
import { useCloudStore } from "@/store/cloud";
import { useCloudBackupStore } from "@/store/cloud-backups";
import { useSettingsStore } from "@/store/settings";
import { BACKUP_CHECK_EVERY_MS, FIRST_BACKUP_CHECK_MS, useCloudBackupSchedule } from "./use-cloud-backup-schedule";

const runNow = vi.fn(async () => undefined);
const initialCloud = useCloudStore.getState();

function connect(status: "connected" | "revoked", enabled: boolean): void {
  useCloudStore.setState({ status, state: { status, enabled } as unknown as CloudState });
}

beforeEach(() => {
  vi.useFakeTimers();
  runNow.mockClear();
  useCloudBackupStore.setState({ runNow });
  connect("connected", true);
  useSettingsStore.setState({ notes: true });
});

afterEach(() => {
  vi.useRealTimers();
  useCloudStore.setState(initialCloud, true);
  useSettingsStore.setState({ notes: false });
});

describe("useCloudBackupSchedule", () => {
  it("asks for a scheduled backup a while after start and then every check period", () => {
    renderHook(() => useCloudBackupSchedule());
    vi.advanceTimersByTime(FIRST_BACKUP_CHECK_MS - 1);
    expect(runNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(runNow).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(BACKUP_CHECK_EVERY_MS);
    expect(runNow).toHaveBeenCalledTimes(2);
    act(() => useSettingsStore.setState({ notes: false }));
    vi.advanceTimersByTime(BACKUP_CHECK_EVERY_MS * 3);
    expect(runNow).toHaveBeenCalledTimes(2);
  });

  it("never starts for someone who hasn't turned Notes on", () => {
    useSettingsStore.setState({ notes: false });
    renderHook(() => useCloudBackupSchedule());
    vi.advanceTimersByTime(FIRST_BACKUP_CHECK_MS * 4);
    expect(runNow).not.toHaveBeenCalled();
  });

  it("does nothing while the cloud account's access is revoked", () => {
    connect("revoked", true);
    renderHook(() => useCloudBackupSchedule());
    vi.advanceTimersByTime(FIRST_BACKUP_CHECK_MS * 4);
    expect(runNow).not.toHaveBeenCalled();
  });

  it("keeps backing up while sync is turned off on this computer", () => {
    connect("connected", false);
    renderHook(() => useCloudBackupSchedule());
    vi.advanceTimersByTime(FIRST_BACKUP_CHECK_MS);
    expect(runNow).toHaveBeenCalledWith(true);
  });
});
