import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  deleteEntry: vi.fn(),
}));

vi.mock("@/store/confirm-dialog", () => ({ confirmAction: mocks.confirmAction }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ deleteEntry: mocks.deleteEntry }) } }));

import { deleteAskingWithoutTrash, deleteProjectEntry } from "./project-file-delete";

const coded = (code: string) => `@oleafly/error:${JSON.stringify({ code, params: { path: "main.tex" }, detail: null })}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleting a file another app has open", () => {
  it("passes the refusal on without asking to delete for good", async () => {
    const forGood = vi.fn();
    await expect(
      deleteAskingWithoutTrash("main.tex", () => Promise.reject(coded("project.trash_in_use")), forGood),
    ).rejects.toBe(coded("project.trash_in_use"));
    expect(mocks.confirmAction).not.toHaveBeenCalled();
    expect(forGood).not.toHaveBeenCalled();
  });

  it("shows the refusal's own message and deletes nothing", async () => {
    mocks.deleteEntry.mockRejectedValue(coded("project.trash_in_use"));
    await expect(deleteProjectEntry("main.tex")).resolves.toBe(false);
    expect(mocks.deleteEntry).toHaveBeenCalledTimes(1);
    expect(mocks.deleteEntry).toHaveBeenCalledWith("main.tex");
    expect(mocks.confirmAction).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith("delete file", coded("project.trash_in_use"), undefined);
  });
});
