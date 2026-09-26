import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CopiedIntoLibrary, CopyIntoLibraryProgress } from "@/lib/tauri";

type Progress = (progress: CopyIntoLibraryProgress) => void;

const copyLinkedIntoLibrary =
  vi.fn<
    (projectId: string, operationId: string, onProgress: Progress) => Promise<CopiedIntoLibrary>
  >();
const cancelCopyIntoLibrary = vi.fn<(operationId: string) => Promise<boolean>>();
const toastSuccess = vi.fn();
const logError = vi.fn(async () => {});
const refreshProjects = vi.fn(async () => {});
const openProject = vi.fn(async () => {});

vi.mock("@/lib/tauri", () => ({
  copyLinkedIntoLibrary: (projectId: string, operationId: string, onProgress: Progress) =>
    copyLinkedIntoLibrary(projectId, operationId, onProgress),
  cancelCopyIntoLibrary: (operationId: string) => cancelCopyIntoLibrary(operationId),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args) },
}));
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => logError(...(args as [])),
}));
vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({ refreshProjects, openProject }),
  },
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { copyIntoLibrary, useCopyIntoLibraryStore } from "./copy-into-library";

const appError = (code: string) => `@oleafly/error:${JSON.stringify({ code })}`;

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  copyLinkedIntoLibrary.mockReset();
  cancelCopyIntoLibrary.mockReset();
  cancelCopyIntoLibrary.mockResolvedValue(true);
  toastSuccess.mockReset();
  logError.mockReset();
  refreshProjects.mockReset();
  openProject.mockReset();
  useCopyIntoLibraryStore.getState().close();
});

describe("copy into library", () => {
  it("tracks progress, refreshes the library and offers to open the copy", async () => {
    const pending = deferred<CopiedIntoLibrary>();
    copyLinkedIntoLibrary.mockImplementation((_projectId, _operationId, onProgress) => {
      onProgress({
        phase: "copying",
        entriesDone: 12,
        entriesTotal: 40,
        bytesDone: 10,
        bytesTotal: 100,
      });
      return pending.promise;
    });

    const started = copyIntoLibrary("linked-thesis", "Thesis");

    const state = useCopyIntoLibraryStore.getState();
    expect(state.target).toEqual({ projectId: "linked-thesis", name: "Thesis" });
    expect(state.status).toBe("running");
    expect(state.progress?.entriesDone).toBe(12);
    const [projectId, operationId] = copyLinkedIntoLibrary.mock.calls[0];
    expect(projectId).toBe("linked-thesis");
    expect(operationId).toMatch(/^[A-Za-z0-9-]{1,64}$/);
    expect(await copyIntoLibrary("linked-other", "Other")).toBeNull();
    expect(copyLinkedIntoLibrary).toHaveBeenCalledTimes(1);

    pending.resolve({ projectId: "thesis-copy", leftOut: 0 });
    expect(await started).toBe("thesis-copy");

    expect(useCopyIntoLibraryStore.getState().target).toBeNull();
    expect(refreshProjects).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [message, action] = toastSuccess.mock.calls[0] as [string, { label: string; onClick: () => void }];
    expect(message).toBe(enLibrary.folder.copy.done.replace("{{name}}", "Thesis"));
    expect(action.label).toBe(enCommon.actions.open);
    action.onClick();
    expect(openProject).toHaveBeenCalledWith("thesis-copy");
  });

  it("opens the copy straight away when asked and says so once", async () => {
    copyLinkedIntoLibrary.mockResolvedValueOnce({ projectId: "thesis-copy", leftOut: 0 });
    expect(await copyIntoLibrary("linked-thesis", "Thesis", { openAfterCopy: true })).toBe(
      "thesis-copy",
    );
    expect(openProject).toHaveBeenCalledWith("thesis-copy");
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0]).toEqual([enShell.openedFolder.readOnly.copied]);
  });

  it("still names what stayed behind when it opens the copy", async () => {
    copyLinkedIntoLibrary.mockResolvedValueOnce({ projectId: "thesis-copy", leftOut: 3 });
    await copyIntoLibrary("linked-thesis", "Thesis", { openAfterCopy: true });
    expect(openProject).toHaveBeenCalledWith("thesis-copy");
    expect(toastSuccess.mock.calls).toEqual([
      [enLibrary.folder.copy.doneLeftOut.replace("{{name}}", "Thesis")],
    ]);
  });

  it("says which items stayed behind when some could not be copied", async () => {
    copyLinkedIntoLibrary.mockResolvedValueOnce({ projectId: "thesis-copy", leftOut: 2 });
    expect(await copyIntoLibrary("linked-thesis", "Thesis")).toBe("thesis-copy");
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0][0]).toBe(
      enLibrary.folder.copy.doneLeftOut.replace("{{name}}", "Thesis"),
    );
  });

  it("names Git history when it pushed the folder over the item limit", async () => {
    copyLinkedIntoLibrary.mockRejectedValueOnce(appError("project.copy_entry_limit_git"));
    await copyIntoLibrary("linked-thesis", "Thesis");
    expect(useCopyIntoLibraryStore.getState().error).toBe(enErrors.project.copy_entry_limit_git);
  });

  it("cancels quietly", async () => {
    const pending = deferred<CopiedIntoLibrary>();
    copyLinkedIntoLibrary.mockReturnValue(pending.promise);
    const started = copyIntoLibrary("linked-thesis", "Thesis");
    const operationId = copyLinkedIntoLibrary.mock.calls[0][1];

    useCopyIntoLibraryStore.getState().cancel();
    useCopyIntoLibraryStore.getState().cancel();

    expect(useCopyIntoLibraryStore.getState().status).toBe("cancelling");
    expect(cancelCopyIntoLibrary).toHaveBeenCalledTimes(1);
    expect(cancelCopyIntoLibrary).toHaveBeenCalledWith(operationId);
    pending.reject(appError("project.copy_cancelled"));
    expect(await started).toBeNull();
    expect(useCopyIntoLibraryStore.getState().target).toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the reason when the copy fails", async () => {
    copyLinkedIntoLibrary.mockRejectedValueOnce(appError("project.copy_entry_limit"));
    expect(await copyIntoLibrary("linked-thesis", "Thesis")).toBeNull();
    expect(useCopyIntoLibraryStore.getState()).toMatchObject({
      status: "failed",
      error: enErrors.project.copy_entry_limit,
    });
    expect(logError).toHaveBeenCalledTimes(1);

    useCopyIntoLibraryStore.getState().close();
    copyLinkedIntoLibrary.mockRejectedValueOnce(new Error("disk full"));
    await copyIntoLibrary("linked-thesis", "Thesis");
    expect(useCopyIntoLibraryStore.getState().error).toBe(
      enLibrary.folder.copy.failed.replace("{{name}}", "Thesis"),
    );
    expect(toastSuccess).not.toHaveBeenCalled();

    useCopyIntoLibraryStore.getState().close();
    expect(useCopyIntoLibraryStore.getState().target).toBeNull();
  });

  it("lets a failed copy be started again", async () => {
    copyLinkedIntoLibrary.mockRejectedValueOnce(appError("project.copy_size_limit"));
    await copyIntoLibrary("linked-thesis", "Thesis");
    copyLinkedIntoLibrary.mockResolvedValueOnce({ projectId: "thesis-copy", leftOut: 0 });
    expect(await copyIntoLibrary("linked-thesis", "Thesis")).toBe("thesis-copy");
    expect(copyLinkedIntoLibrary).toHaveBeenCalledTimes(2);
  });
});
