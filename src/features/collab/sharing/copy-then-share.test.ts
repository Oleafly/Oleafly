import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ copyIntoLibrary: vi.fn() }));

vi.mock("@/store/copy-into-library", () => ({ copyIntoLibrary: mocks.copyIntoLibrary }));

import { useShareDialog } from "@/components/collab/share-dialog";
import { copyThenShare } from "./copy-then-share";

beforeEach(() => {
  mocks.copyIntoLibrary.mockReset();
  useShareDialog.setState({ projectId: "original", fromCopy: false });
});

describe("sharing a copy of a project", () => {
  it("closes the dialog, copies the project, opens the copy and shares it", async () => {
    mocks.copyIntoLibrary.mockResolvedValue("copy-1");
    await copyThenShare("original", "Thesis (copy)");
    expect(mocks.copyIntoLibrary).toHaveBeenCalledWith("original", "Thesis (copy)", { openAfterCopy: true });
    expect(useShareDialog.getState()).toMatchObject({ projectId: "copy-1", fromCopy: true });
  });

  it("leaves the dialog closed when no copy was made", async () => {
    mocks.copyIntoLibrary.mockResolvedValue(null);
    await copyThenShare("original", "Thesis (copy)");
    expect(useShareDialog.getState()).toMatchObject({ projectId: null, fromCopy: false });
  });
});
