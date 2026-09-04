// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  errorUnique: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: { errorUnique: mocks.errorUnique },
  notifyError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ getConfig: mocks.getConfig }));

import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { applyCheckpointPublicationEvent } from "./checkpoint-publication";

const skipped = {
  status: "skipped" as const,
  reason: "storage_unavailable" as const,
  message: "Checkpoint not saved. Checkpoint storage is full or not writable.",
  suggestion: "Free some disk space or check folder permissions, then compile again.",
};

const published = {
  project_id: "active",
  main_document: "main.tex",
  phase: "finished" as const,
  outcome: { status: "published" as const, snapshot_root: "root", created: true },
};

const failed = {
  project_id: "active",
  main_document: "main.tex",
  phase: "finished" as const,
  outcome: skipped,
};

function clearTheNoticeWithASavedCheckpoint() {
  applyCheckpointPublicationEvent(published);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("checkpoint publication events", () => {
  beforeEach(() => {
    mocks.errorUnique.mockReset();
    mocks.getConfig.mockReset();
    mocks.getConfig.mockResolvedValue({ checkpoint_notifications: true });
    useFilesStore.setState({ projectId: "active" });
    clearTheNoticeWithASavedCheckpoint();
    useSettingsStore.setState({
      versioningOpen: false,
      versioningTab: "git",
      checkpointsRevision: 0,
      checkpointPublishingProjectId: null,
    });
  });

  it("marks the active project as publishing until the lane finishes", () => {
    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "started",
    });
    expect(useSettingsStore.getState().checkpointPublishingProjectId).toBe("active");

    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "finished",
      outcome: { status: "published", snapshot_root: "root", created: true },
    });

    const settings = useSettingsStore.getState();
    expect(settings.checkpointPublishingProjectId).toBeNull();
    expect(settings.checkpointsRevision).toBe(1);
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("treats an unchanged source as a silent outcome", async () => {
    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "started",
    });

    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "finished",
      outcome: { status: "unchanged" },
    });
    await flush();

    const settings = useSettingsStore.getState();
    expect(settings.checkpointPublishingProjectId).toBeNull();
    expect(settings.checkpointsRevision).toBe(0);
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("reports a storage failure as a sticky error with no action", async () => {
    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "finished",
      outcome: skipped,
    });
    await flush();

    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.errorUnique).toHaveBeenCalledWith(
      "checkpoint-publication-skipped",
      `${skipped.message} ${skipped.suggestion}`,
      undefined,
      true,
    );
    expect(useSettingsStore.getState().versioningOpen).toBe(false);
  });

  it("reports the same storage failure once until a checkpoint saves again", async () => {
    applyCheckpointPublicationEvent(failed);
    await flush();
    applyCheckpointPublicationEvent(failed);
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);

    applyCheckpointPublicationEvent(published);
    applyCheckpointPublicationEvent(failed);
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(2);
  });

  it("stays silent when the lane could not finish", async () => {
    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "finished",
      outcome: { status: "failed" },
    });
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("reports the same storage failure again in a different project", async () => {
    applyCheckpointPublicationEvent(failed);
    await flush();
    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);

    useFilesStore.setState({ projectId: "second" });
    applyCheckpointPublicationEvent({ ...failed, project_id: "second" });
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(2);
  });

  it("stays silent when skipped notices are turned off", async () => {
    mocks.getConfig.mockResolvedValue({ checkpoint_notifications: false });

    applyCheckpointPublicationEvent(failed);
    await flush();

    expect(mocks.getConfig).toHaveBeenCalledTimes(1);
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("stays silent when the config cannot be read", async () => {
    mocks.getConfig.mockRejectedValue(new Error("offline"));

    applyCheckpointPublicationEvent(failed);
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("ignores lanes for projects that are not open", async () => {
    applyCheckpointPublicationEvent({
      project_id: "other",
      main_document: "main.tex",
      phase: "started",
    });
    expect(useSettingsStore.getState().checkpointPublishingProjectId).toBeNull();

    applyCheckpointPublicationEvent({
      project_id: "other",
      main_document: "main.tex",
      phase: "finished",
      outcome: skipped,
    });
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
  });

  it("clears a publishing marker when the project changed while the lane ran", () => {
    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "started",
    });
    useFilesStore.setState({ projectId: "other" });

    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "finished",
      outcome: { status: "published", snapshot_root: "root", created: true },
    });

    expect(useSettingsStore.getState().checkpointPublishingProjectId).toBeNull();
    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
  });

  it("ignores malformed payloads", async () => {
    applyCheckpointPublicationEvent(null);
    applyCheckpointPublicationEvent({ phase: "finished" });
    applyCheckpointPublicationEvent({ project_id: "active", phase: "finished" });
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
  });
});
