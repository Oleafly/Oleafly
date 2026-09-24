// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  errorUnique: vi.fn(),
  dismiss: vi.fn(),
  getConfig: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: { errorUnique: mocks.errorUnique, dismiss: mocks.dismiss },
  notifyError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ getConfig: mocks.getConfig }));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import type { CheckpointPublicationOutcome } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  applyCheckpointPublicationEvent,
  checkpointSkippedToastKey,
  INCOMPLETE_CAPTURE_NOTICE_AFTER,
} from "./checkpoint-publication";

const storageUnavailable = {
  status: "skipped" as const,
  reason: "storage_unavailable" as const,
  message: "Checkpoint not saved. Checkpoint storage is full or not writable.",
  suggestion: "Free some disk space or check folder permissions, then compile again.",
};

const incompleteCapture = {
  status: "skipped" as const,
  reason: "incomplete_capture" as const,
  message: "Checkpoint not saved. chapter.tex changed while it was being read.",
  suggestion: "Check the affected files and folder permissions, then compile again.",
};

let projectRun = 0;
let active = "";

function finished(outcome: CheckpointPublicationOutcome, projectId = active) {
  return {
    project_id: projectId,
    main_document: "main.tex",
    phase: "finished" as const,
    outcome,
  };
}

function started(projectId = active) {
  return { project_id: projectId, main_document: "main.tex", phase: "started" as const };
}

const publishedOutcome = { status: "published" as const, snapshot_root: "root", created: true };

function published(projectId = active) {
  return finished(publishedOutcome, projectId);
}

function failed(projectId = active) {
  return finished(storageUnavailable, projectId);
}

function incomplete(projectId = active) {
  return finished(incompleteCapture, projectId);
}

function storageCopy() {
  return i18n.t(($) => $.core.checkpoint.storageUnavailable);
}

function incompleteCopy() {
  return i18n.t(($) => $.core.checkpoint.incompleteCapture);
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("checkpoint publication events", () => {
  beforeEach(() => {
    projectRun += 1;
    active = `active-${projectRun}`;
    useFilesStore.setState({ projectId: active });
    mocks.errorUnique.mockReset().mockReturnValue(17);
    mocks.dismiss.mockReset();
    mocks.logError.mockReset();
    mocks.getConfig.mockReset();
    mocks.getConfig.mockResolvedValue({ checkpoint_notifications: true });
    useSettingsStore.setState({
      versioningOpen: false,
      checkpointsRevision: 0,
      checkpointPublishingProjectId: null,
    });
  });

  it("marks the active project as publishing until the lane finishes", () => {
    applyCheckpointPublicationEvent(started());
    expect(useSettingsStore.getState().checkpointPublishingProjectId).toBe(active);

    applyCheckpointPublicationEvent(published());

    const settings = useSettingsStore.getState();
    expect(settings.checkpointPublishingProjectId).toBeNull();
    expect(settings.checkpointsRevision).toBe(1);
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("treats an unchanged source as a silent outcome", async () => {
    applyCheckpointPublicationEvent(started());

    applyCheckpointPublicationEvent(finished({ status: "unchanged" }));
    await flush();

    const settings = useSettingsStore.getState();
    expect(settings.checkpointPublishingProjectId).toBeNull();
    expect(settings.checkpointsRevision).toBe(0);
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("reports full or locked storage as one sticky error for the project in translated copy", async () => {
    applyCheckpointPublicationEvent(failed());
    await flush();

    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.errorUnique).toHaveBeenCalledWith(
      checkpointSkippedToastKey(active),
      storageCopy(),
      undefined,
      true,
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "checkpoint publication skipped",
      `${storageUnavailable.message} ${storageUnavailable.suggestion}`,
    );
    expect(useSettingsStore.getState().versioningOpen).toBe(false);
  });

  it("reports a storage failure once for the project even when checkpoints save in between", async () => {
    applyCheckpointPublicationEvent(failed());
    await flush();
    applyCheckpointPublicationEvent(failed());
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);

    for (let lane = 0; lane < 3; lane++) {
      applyCheckpointPublicationEvent(published());
      applyCheckpointPublicationEvent(failed());
      await flush();
    }

    expect(mocks.dismiss).toHaveBeenCalledWith(17);
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().checkpointsRevision).toBe(3);
  });

  it("does not report a skip that a checkpoint saved over while the settings were read", async () => {
    let answer = (_config: { checkpoint_notifications: boolean }) => {};
    mocks.getConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    applyCheckpointPublicationEvent(failed());
    applyCheckpointPublicationEvent(published());
    answer({ checkpoint_notifications: true });
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();

    applyCheckpointPublicationEvent(failed());
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
  });

  it("does not report a storage failure twice when two lanes finish together", async () => {
    applyCheckpointPublicationEvent(failed());
    applyCheckpointPublicationEvent(failed());
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
  });

  it("keeps the storage failure up through unchanged and failed lanes", async () => {
    applyCheckpointPublicationEvent(failed());
    await flush();
    applyCheckpointPublicationEvent(finished({ status: "unchanged" }));
    applyCheckpointPublicationEvent(finished({ status: "failed" }));
    applyCheckpointPublicationEvent(failed());
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("only logs an incomplete capture until it keeps happening", async () => {
    for (let lane = 1; lane < INCOMPLETE_CAPTURE_NOTICE_AFTER; lane++) {
      applyCheckpointPublicationEvent(incomplete());
      await flush();
    }

    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledTimes(INCOMPLETE_CAPTURE_NOTICE_AFTER - 1);

    applyCheckpointPublicationEvent(incomplete());
    await flush();
    applyCheckpointPublicationEvent(incomplete());
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.errorUnique).toHaveBeenCalledWith(
      checkpointSkippedToastKey(active),
      incompleteCopy(),
      undefined,
      true,
    );
  });

  it("starts counting incomplete captures again after a checkpoint saves", async () => {
    for (let lane = 1; lane < INCOMPLETE_CAPTURE_NOTICE_AFTER; lane++) {
      applyCheckpointPublicationEvent(incomplete());
      await flush();
    }
    applyCheckpointPublicationEvent(published());
    applyCheckpointPublicationEvent(incomplete());
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("does not report incomplete captures again after checkpoints save in between", async () => {
    for (let lane = 0; lane < INCOMPLETE_CAPTURE_NOTICE_AFTER; lane++) {
      applyCheckpointPublicationEvent(incomplete());
      await flush();
    }
    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);

    applyCheckpointPublicationEvent(published());
    for (let lane = 0; lane < INCOMPLETE_CAPTURE_NOTICE_AFTER * 2; lane++) {
      applyCheckpointPublicationEvent(incomplete());
      await flush();
    }

    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the lane could not finish", async () => {
    applyCheckpointPublicationEvent(finished({ status: "failed" }));
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("reports the same storage failure again in a different project", async () => {
    applyCheckpointPublicationEvent(failed());
    await flush();
    expect(mocks.errorUnique).toHaveBeenCalledTimes(1);

    const second = `${active}-second`;
    useFilesStore.setState({ projectId: second });
    applyCheckpointPublicationEvent(failed(second));
    await flush();

    expect(mocks.errorUnique).toHaveBeenCalledTimes(2);
    expect(mocks.errorUnique).toHaveBeenLastCalledWith(
      checkpointSkippedToastKey(second),
      storageCopy(),
      undefined,
      true,
    );
  });

  it("stays silent when skipped notices are turned off", async () => {
    mocks.getConfig.mockResolvedValue({ checkpoint_notifications: false });

    applyCheckpointPublicationEvent(failed());
    await flush();

    expect(mocks.getConfig).toHaveBeenCalledTimes(1);
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the config cannot be read", async () => {
    mocks.getConfig.mockRejectedValue(new Error("offline"));

    applyCheckpointPublicationEvent(failed());
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("ignores lanes for projects that are not open", async () => {
    applyCheckpointPublicationEvent(started("other"));
    expect(useSettingsStore.getState().checkpointPublishingProjectId).toBeNull();

    applyCheckpointPublicationEvent(failed("other"));
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
  });

  it("clears a publishing marker when the project changed while the lane ran", () => {
    applyCheckpointPublicationEvent(started());
    useFilesStore.setState({ projectId: "other" });

    applyCheckpointPublicationEvent(published());

    expect(useSettingsStore.getState().checkpointPublishingProjectId).toBeNull();
    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
  });

  it("ignores malformed payloads", async () => {
    applyCheckpointPublicationEvent(null);
    applyCheckpointPublicationEvent({ phase: "finished" });
    applyCheckpointPublicationEvent({ project_id: active, phase: "finished" });
    await flush();

    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().checkpointsRevision).toBe(0);
  });
});
