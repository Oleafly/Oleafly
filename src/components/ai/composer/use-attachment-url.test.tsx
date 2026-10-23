// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ attachmentObjectUrl: vi.fn() }));
vi.mock("@/lib/attachments", () => ({ attachmentObjectUrl: mocks.attachmentObjectUrl }));

import { useAttachmentUrl } from "./use-attachment-url";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAttachmentUrl", () => {
  it("reads a stored file once even when the caller builds a new ref every render", async () => {
    mocks.attachmentObjectUrl.mockResolvedValue("blob:one");
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useAttachmentUrl("p1", { sha256: "abc", mime: "image/png" });
    });
    await waitFor(() => expect(result.current.url).toBe("blob:one"));
    // Let any loop show itself: a looping hook would keep rendering and calling.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mocks.attachmentObjectUrl).toHaveBeenCalledTimes(1);
    expect(renders).toBeLessThan(5);
  });

  it("does not retry a file that cannot be read on every render", async () => {
    mocks.attachmentObjectUrl.mockRejectedValue(new Error("missing"));
    const { result } = renderHook(() => useAttachmentUrl(null, { sha256: "gone", mime: "image/png" }));
    await waitFor(() => expect(result.current.failed).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mocks.attachmentObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("loads again when the file or scope changes", async () => {
    mocks.attachmentObjectUrl.mockImplementation(async (_scope: string | null, sha: string) => `blob:${sha}`);
    const { result, rerender } = renderHook(
      ({ sha, scope }: { sha: string; scope: string | null }) => useAttachmentUrl(scope, { sha256: sha, mime: "image/png" }),
      { initialProps: { sha: "a", scope: "p1" as string | null } },
    );
    await waitFor(() => expect(result.current.url).toBe("blob:a"));
    rerender({ sha: "b", scope: "p1" });
    await waitFor(() => expect(result.current.url).toBe("blob:b"));
    rerender({ sha: "b", scope: "p2" });
    await waitFor(() => expect(mocks.attachmentObjectUrl).toHaveBeenCalledTimes(3));
    expect(mocks.attachmentObjectUrl).toHaveBeenLastCalledWith("p2", "b", "image/png");
  });

  it("returns nothing without a ref", () => {
    const { result } = renderHook(() => useAttachmentUrl("p1", undefined));
    expect(result.current).toEqual({ url: null, failed: false });
    expect(mocks.attachmentObjectUrl).not.toHaveBeenCalled();
  });
});
