import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compileTagged: vi.fn(),
  readCompiledPdf: vi.fn(),
  saveActive: vi.fn(),
  runPreflight: vi.fn(),
  notifyCompileSucceeded: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
  reportCompileSaveFailure: vi.fn(),
  beginCompileRequestIdentity: vi.fn(() => ({
    projectId: "project",
    mainDocument: "main.tex",
    projectRevision: 0,
    requestGeneration: 0,
  })),
  captureCompileSourceSnapshot: vi.fn(async () => null),
  isCompileRequestIdentityCurrent: vi.fn(() => true),
  isCompileOutputStillWanted: vi.fn(() => true),
  refreshPreviewWindow: vi.fn(),
  compileState: {} as Record<string, unknown>,
  files: {
    projectId: "project" as string | null,
    mainDoc: "main.tex",
    saveActive: vi.fn(),
  },
  toast: {
    info: vi.fn(() => 1),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    infoUnique: vi.fn(() => 2),
    successUnique: vi.fn(() => 4),
    errorUnique: vi.fn(() => 3),
  },
}));

vi.mock("@/lib/tauri", () => ({
  compileTagged: mocks.compileTagged,
  readCompiledPdf: mocks.readCompiledPdf,
}));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => mocks.files },
}));
vi.mock("@/store/compile", () => ({
  beginCompileRequestIdentity: mocks.beginCompileRequestIdentity,
  captureCompileSourceSnapshot: mocks.captureCompileSourceSnapshot,
  isCompileRequestIdentityCurrent: mocks.isCompileRequestIdentityCurrent,
  isCompileOutputStillWanted: mocks.isCompileOutputStillWanted,
  reportCompileSaveFailure: mocks.reportCompileSaveFailure,
  saveActiveForCompile: (files: { saveActive: () => Promise<void> }) => files.saveActive(),
  useCompileStore: {
    getState: () => mocks.compileState,
    setState: (
      update:
        | Record<string, unknown>
        | ((state: Record<string, unknown>) => Record<string, unknown>),
    ) => {
      Object.assign(
        mocks.compileState,
        typeof update === "function" ? update(mocks.compileState) : update,
      );
    },
  },
}));
vi.mock("@/store/preflight", () => ({
  usePreflightStore: {
    getState: () => ({ run: mocks.runPreflight }),
  },
}));
vi.mock("@/store/engine", () => ({
  useEngineStore: {
    getState: () => ({
      info: { kind: "system", lualatex: "/usr/bin/lualatex" },
    }),
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
  notifyError: mocks.notifyError,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/cross-window", () => ({
  currentCompileProducerId: () => "main-window",
  notifyCompileSucceeded: mocks.notifyCompileSucceeded,
}));
vi.mock("@/lib/preview-window", () => ({
  refreshPreviewWindow: mocks.refreshPreviewWindow,
}));

import {
  createCompileSuccessCheckpoint,
  fingerprintCompileOutput,
} from "@/lib/compile-checkpoint";
import { compileTaggedAndVerify } from "./latex-engine";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function checkpoint(bytes: Uint8Array, outputRevision: number) {
  return createCompileSuccessCheckpoint({
    projectId: "project",
    mainDocument: "main.tex",
    outputKind: "standard",
    producerId: "remote-window",
    outputRevision,
    outputId: fingerprintCompileOutput(bytes),
    previousCompletedAt: 100,
    now: 100 + outputRevision,
  });
}

beforeEach(() => {
  mocks.compileTagged.mockReset();
  mocks.readCompiledPdf.mockReset();
  mocks.saveActive.mockReset().mockResolvedValue(undefined);
  mocks.files.saveActive = mocks.saveActive;
  mocks.files.projectId = "project";
  mocks.files.mainDoc = "main.tex";
  mocks.runPreflight.mockReset().mockResolvedValue(undefined);
  mocks.notifyCompileSucceeded.mockReset();
  mocks.notifyError.mockReset();
  mocks.logError.mockReset();
  mocks.reportCompileSaveFailure.mockReset();
  mocks.isCompileOutputStillWanted.mockReset().mockReturnValue(true);
  mocks.refreshPreviewWindow.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockClear();
  Object.assign(mocks.compileState, {
    status: "success",
    phase: "idle",
    log: "prior success",
    pdfBytes: new Uint8Array([9]),
    lastCompiledAt: 123,
    lastCompileCheckpoint: null,
  });
});

describe("tagged compile checkpoints", () => {
  it("accepts and verifies a tagged main output while refreshing the detached preview exactly once", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.compileTagged.mockResolvedValue({
      success: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bytes),
      output_revision: 12,
      log: "tagged ok",
    });
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);

    await compileTaggedAndVerify();

    expect(mocks.compileState.status).toBe("success");
    expect(mocks.compileState.pdfBytes).toEqual(bytes);
    expect(mocks.compileState.lastCompiledAt).toEqual(expect.any(Number));
    expect(mocks.compileState.lastCompiledAt).toBeGreaterThan(123);
    expect(mocks.compileState.lastCompileCheckpoint).toEqual(
      expect.objectContaining({
        outputKind: "tagged",
        outputRevision: 12,
        outputId: fingerprintCompileOutput(bytes),
      }),
    );
    expect(mocks.notifyCompileSucceeded).toHaveBeenCalledTimes(1);
    expect(mocks.refreshPreviewWindow).toHaveBeenCalledTimes(2);
    expect(mocks.runPreflight).toHaveBeenCalledTimes(1);
    expect(mocks.toast.successUnique).toHaveBeenCalledExactlyOnceWith(
      "tagged-compile:project",
      "Tagged PDF compiled. See the accessibility verdict below.",
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("shows a verified best-effort PDF from a failed tagged compile without checkpointing it", async () => {
    const bestEffort = new Uint8Array([4, 5, 6]);
    mocks.compileTagged.mockResolvedValue({
      success: false,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bestEffort),
      output_revision: null,
      log: "tagged failed",
    });
    mocks.readCompiledPdf.mockResolvedValue(bestEffort.buffer);

    await compileTaggedAndVerify();

    expect(mocks.compileState.status).toBe("error");
    expect(mocks.compileState.pdfBytes).toEqual(bestEffort);
    expect(mocks.compileState.lastCompiledAt).toBe(123);
    expect(mocks.compileState.lastCompileCheckpoint).toBeNull();
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
    expect(mocks.runPreflight).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(
      "tagged-compile:project",
      "Tagged compile finished with errors. Check the log.",
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("stays quiet when the tagged compile was stopped on request", async () => {
    const bestEffort = new Uint8Array([4, 5, 6]);
    mocks.compileTagged.mockResolvedValue({
      success: false,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bestEffort),
      output_revision: null,
      log: "pass one\nOleafly stopped the tagged compile on request.\n",
    });
    mocks.readCompiledPdf.mockResolvedValue(bestEffort.buffer);

    await compileTaggedAndVerify();

    expect(mocks.compileState.status).toBe("error");
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("reports a tagged compile exception once in the tagged slot", async () => {
    const error = new Error("lualatex missing");
    mocks.compileTagged.mockRejectedValue(error);

    await compileTaggedAndVerify();

    expect(mocks.compileState).toMatchObject({
      status: "error",
      failureReason: "Tagged compile failed: Error: lualatex missing",
    });
    expect(mocks.logError).toHaveBeenCalledWith("compile tagged", error);
    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(
      "tagged-compile:project",
      "Tagged compile failed. Check the engine and try again.",
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("only logs an exception from a tagged attempt that was superseded", async () => {
    const error = new Error("lualatex missing");
    mocks.compileTagged.mockImplementation(async () => {
      mocks.isCompileOutputStillWanted.mockReturnValue(false);
      throw error;
    });

    await compileTaggedAndVerify();

    expect(mocks.logError).toHaveBeenCalledWith("compile tagged", error);
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.refreshPreviewWindow).toHaveBeenCalledTimes(1);
  });

  it("rejects successful metadata when the readable PDF was replaced before IPC", async () => {
    const tagged = new Uint8Array([1, 1, 1]);
    const replacement = new Uint8Array([2, 2, 2]);
    mocks.compileTagged.mockResolvedValue({
      success: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(tagged),
      output_revision: 13,
      log: "tagged ok",
    });
    mocks.readCompiledPdf.mockResolvedValue(replacement.buffer);

    await compileTaggedAndVerify();

    expect(mocks.compileState.status).toBe("error");
    expect(mocks.compileState.pdfBytes).toEqual(new Uint8Array([9]));
    expect(mocks.compileState.lastCompiledAt).toBe(123);
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
    expect(mocks.runPreflight).not.toHaveBeenCalled();
  });

  it("does not let an older tagged PDF read overwrite a newer remote checkpoint", async () => {
    const olderBytes = new Uint8Array([1, 2, 3]);
    const newerBytes = new Uint8Array([8, 8, 8]);
    const pendingRead = deferred<ArrayBuffer>();
    mocks.compileTagged.mockResolvedValue({
      success: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(olderBytes),
      output_revision: 12,
      log: "older tagged success",
    });
    mocks.readCompiledPdf.mockReturnValue(pendingRead.promise);

    const compiling = compileTaggedAndVerify();
    await vi.waitFor(() => expect(mocks.readCompiledPdf).toHaveBeenCalledOnce());

    const newer = checkpoint(newerBytes, 13);
    Object.assign(mocks.compileState, {
      status: "success",
      pdfBytes: newerBytes,
      log: "newer remote success",
      lastCompiledAt: newer.completedAt,
      lastCompileCheckpoint: newer,
    });
    pendingRead.resolve(olderBytes.buffer);
    await compiling;

    expect(mocks.compileState).toEqual(
      expect.objectContaining({
        status: "success",
        pdfBytes: newerBytes,
        log: "newer remote success",
        lastCompiledAt: newer.completedAt,
        lastCompileCheckpoint: newer,
      }),
    );
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
    expect(mocks.refreshPreviewWindow).toHaveBeenCalledTimes(1);
    expect(mocks.runPreflight).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("does not let a failed tagged PDF read downgrade a newer remote success", async () => {
    const bestEffort = new Uint8Array([4, 5, 6]);
    const newerBytes = new Uint8Array([9, 9, 9]);
    const pendingRead = deferred<ArrayBuffer>();
    mocks.compileTagged.mockResolvedValue({
      success: false,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bestEffort),
      output_revision: null,
      log: "older tagged failure",
    });
    mocks.readCompiledPdf.mockReturnValue(pendingRead.promise);

    const compiling = compileTaggedAndVerify();
    await vi.waitFor(() => expect(mocks.readCompiledPdf).toHaveBeenCalledOnce());

    const newer = checkpoint(newerBytes, 14);
    Object.assign(mocks.compileState, {
      status: "success",
      pdfBytes: newerBytes,
      log: "newer remote success",
      lastCompiledAt: newer.completedAt,
      lastCompileCheckpoint: newer,
    });
    pendingRead.resolve(bestEffort.buffer);
    await compiling;

    expect(mocks.compileState).toEqual(
      expect.objectContaining({
        status: "success",
        pdfBytes: newerBytes,
        log: "newer remote success",
        lastCompiledAt: newer.completedAt,
        lastCompileCheckpoint: newer,
      }),
    );
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
    expect(mocks.refreshPreviewWindow).toHaveBeenCalledTimes(1);
    expect(mocks.runPreflight).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("rejects a tagged read when the active main document changes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const pendingRead = deferred<ArrayBuffer>();
    mocks.compileTagged.mockResolvedValue({
      success: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bytes),
      output_revision: 15,
      log: "tagged success for old main",
    });
    mocks.readCompiledPdf.mockReturnValue(pendingRead.promise);

    const compiling = compileTaggedAndVerify();
    await vi.waitFor(() => expect(mocks.readCompiledPdf).toHaveBeenCalledOnce());
    mocks.files.mainDoc = "replacement.tex";
    pendingRead.resolve(bytes.buffer);
    await compiling;

    expect(mocks.compileState.status).toBe("compiling");
    expect(mocks.compileState.pdfBytes).toEqual(new Uint8Array([9]));
    expect(mocks.compileState.log).toBe("prior success");
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
    expect(mocks.refreshPreviewWindow).toHaveBeenCalledTimes(1);
  });

  it("sends save failures to the shared save notice instead of blaming the engine", async () => {
    const error = new Error("disk full");
    mocks.saveActive.mockRejectedValue(error);

    await expect(compileTaggedAndVerify()).resolves.toBeUndefined();

    expect(mocks.compileTagged).not.toHaveBeenCalled();
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
    expect(mocks.compileState).toMatchObject({
      status: "error",
      failureReason: "Tagged compile failed: Error: disk full",
    });
    expect(mocks.reportCompileSaveFailure).toHaveBeenCalledExactlyOnceWith(
      "save before tagged compile",
      mocks.files,
      error,
      true,
    );
    expect(mocks.toast.info).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
});
