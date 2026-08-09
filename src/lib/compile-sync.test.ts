import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  readCompiledPdf: vi.fn(),
  refreshPreviewWindow: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, readCompiledPdf: mocks.readCompiledPdf };
});
vi.mock("@/lib/preview-window", () => ({
  refreshPreviewWindow: mocks.refreshPreviewWindow,
}));

import {
  createCompileSuccessCheckpoint,
  fingerprintCompileOutput,
  type CompileOutputKind,
} from "./compile-checkpoint";
import { applyRemoteCompileSuccess } from "./compile-sync";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import {
  currentProjectStateRevision,
  recordProjectStateRevision,
} from "./project-state-revision";

function remoteEvent(checkpointValue: ReturnType<typeof checkpoint>) {
  return {
    projectStateRevision: currentProjectStateRevision(),
    checkpoint: checkpointValue,
  };
}

function checkpoint(
  bytes: Uint8Array,
  outputRevision: number,
  outputKind: CompileOutputKind = "standard",
) {
  return createCompileSuccessCheckpoint({
    projectId: "project",
    mainDocument: "main.tex",
    outputKind,
    producerId: "detached-preview",
    outputRevision,
    outputId: fingerprintCompileOutput(bytes),
    previousCompletedAt: 100,
    now: 100 + outputRevision,
  });
}

beforeEach(() => {
  mocks.readCompiledPdf.mockReset();
  mocks.refreshPreviewWindow.mockReset();
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
  });
  // The analysis snapshot is the canonical project revision, so an event is
  // only current when it names the revision this window has activated.
  useProjectAnalysisStore.getState().activateProject({
    projectId: "project",
    projectRevision: 0,
    languageServiceGeneration: 0,
  });
  useCompileStore.getState().reset();
});

describe("cross-window successful output synchronization", () => {
  it("applies a newer event only after the on-disk PDF matches its identity", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const payload = checkpoint(bytes, 4, "tagged");
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);

    await expect(
      applyRemoteCompileSuccess(remoteEvent(payload), "main-window"),
    ).resolves.toBe(true);

    const state = useCompileStore.getState();
    expect(state.status).toBe("success");
    expect(state.pdfBytes).toEqual(bytes);
    expect(state.lastCompileCheckpoint).toEqual(payload);
    expect(state.lastCompiledAt).toBe(payload.completedAt);
    expect(state.log).toContain("Tagged PDF compiled successfully");
  });

  it("does not mark a stale readable PDF successful after another window failed", async () => {
    const priorBytes = new Uint8Array([1, 1, 1]);
    const expectedNewBytes = new Uint8Array([2, 2, 2]);
    const prior = checkpoint(priorBytes, 4);
    const announced = checkpoint(expectedNewBytes, 5);
    useCompileStore.setState({
      status: "error",
      phase: "idle",
      pdfBytes: priorBytes,
      lastCompiledAt: prior.completedAt,
      lastCompileCheckpoint: prior,
      log: "local compile failed",
    });
    // The file is readable, but it is the old output, not the event's output.
    mocks.readCompiledPdf.mockResolvedValue(priorBytes.buffer);

    await expect(
      applyRemoteCompileSuccess(remoteEvent(announced), "main-window"),
    ).resolves.toBe(false);

    const state = useCompileStore.getState();
    expect(state.status).toBe("error");
    expect(state.pdfBytes).toEqual(priorBytes);
    expect(state.lastCompiledAt).toBe(prior.completedAt);
    expect(state.lastCompileCheckpoint).toEqual(prior);
    expect(state.log).toBe("local compile failed");
  });

  it("rejects duplicate and out-of-order revisions before reading the PDF", async () => {
    const current = checkpoint(new Uint8Array([8]), 8);
    useCompileStore.setState({
      lastCompiledAt: current.completedAt,
      lastCompileCheckpoint: current,
    });

    await expect(
      applyRemoteCompileSuccess(
        remoteEvent(checkpoint(new Uint8Array([7]), 7)),
        "main-window",
      ),
    ).resolves.toBe(false);
    await expect(
      applyRemoteCompileSuccess(remoteEvent(current), "main-window"),
    ).resolves.toBe(false);
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });

  it("rejects an event announcing a revision this window has not activated", async () => {
    const stale = checkpoint(new Uint8Array([4]), 4);

    await expect(
      applyRemoteCompileSuccess(
        remoteEvent({
          ...stale,
          projectRevision: stale.projectRevision + 1,
        }),
        "main-window",
      ),
    ).resolves.toBe(false);
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });

  it("rejects a delayed success from before the latest project-state mutation", async () => {
    const bytes = new Uint8Array([5]);
    const staleEvent = remoteEvent(checkpoint(bytes, 5));
    recordProjectStateRevision(staleEvent.projectStateRevision + 1);
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);

    await expect(
      applyRemoteCompileSuccess(staleEvent, "main-window"),
    ).resolves.toBe(false);

    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });

  it("rejects self, legacy, wrong-project, and wrong-main-document events", async () => {
    const bytes = new Uint8Array([3]);
    const valid = checkpoint(bytes, 3);
    await expect(
      applyRemoteCompileSuccess(remoteEvent(valid), valid.producerId),
    ).resolves.toBe(false);
    await expect(
      applyRemoteCompileSuccess(
        { projectId: "project", from: "legacy-window" },
        "main-window",
      ),
    ).resolves.toBe(false);
    await expect(
      applyRemoteCompileSuccess(
        remoteEvent({ ...valid, projectId: "other-project" }),
        "main-window",
      ),
    ).resolves.toBe(false);
    await expect(
      applyRemoteCompileSuccess(
        remoteEvent({ ...valid, mainDocument: "other.tex" }),
        "main-window",
      ),
    ).resolves.toBe(false);
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });
});
