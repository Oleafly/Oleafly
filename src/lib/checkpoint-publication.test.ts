// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  infoUnique: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: { infoUnique: mocks.infoUnique },
  notifyError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ getConfig: mocks.getConfig }));

import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  applyCheckpointPublicationEvent,
  notifyCheckpointPublicationSkipped,
} from "./checkpoint-publication";

const skipped = {
  status: "skipped" as const,
  reason: "external_dependency" as const,
  message: "Checkpoint not saved because a required file is outside the project.",
  suggestion: "Move the required file into this project, then compile again.",
};

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("checkpoint publication events", () => {
  beforeEach(() => {
    mocks.infoUnique.mockReset();
    mocks.getConfig.mockReset();
    mocks.getConfig.mockResolvedValue({ checkpoint_notifications: true });
    useFilesStore.setState({ projectId: "active" });
    useSettingsStore.setState({
      checkpointsOpen: false,
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
    expect(mocks.infoUnique).not.toHaveBeenCalled();
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
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("shows one skipped notice whose action opens the Checkpoints panel", async () => {
    applyCheckpointPublicationEvent({
      project_id: "active",
      main_document: "main.tex",
      phase: "finished",
      outcome: skipped,
    });
    await flush();

    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
    expect(mocks.infoUnique).toHaveBeenCalledTimes(1);
    expect(mocks.infoUnique).toHaveBeenCalledWith(
      "checkpoint-publication-external_dependency",
      `${skipped.message} ${skipped.suggestion}`,
      expect.objectContaining({ label: "View Checkpoints" }),
    );
    const action = mocks.infoUnique.mock.calls[0]?.[2] as { onClick?: () => void } | undefined;
    action?.onClick?.();
    expect(useSettingsStore.getState().checkpointsOpen).toBe(true);
  });

  it("stays silent when skipped notices are turned off", async () => {
    mocks.getConfig.mockResolvedValue({ checkpoint_notifications: false });

    await notifyCheckpointPublicationSkipped(skipped);

    expect(mocks.getConfig).toHaveBeenCalledTimes(1);
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });

  it("stays silent when the config cannot be read", async () => {
    mocks.getConfig.mockRejectedValue(new Error("offline"));

    await notifyCheckpointPublicationSkipped(skipped);

    expect(mocks.infoUnique).not.toHaveBeenCalled();
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

    expect(mocks.infoUnique).not.toHaveBeenCalled();
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

  it("ignores malformed payloads and non-skipped results", async () => {
    applyCheckpointPublicationEvent(null);
    applyCheckpointPublicationEvent({ phase: "finished" });
    applyCheckpointPublicationEvent({ project_id: "active", phase: "finished" });
    await notifyCheckpointPublicationSkipped(undefined);
    await notifyCheckpointPublicationSkipped({ status: "scheduled" });
    await notifyCheckpointPublicationSkipped({ status: "not_attempted" });
    await notifyCheckpointPublicationSkipped({ status: "unchanged" });

    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
  });
});
