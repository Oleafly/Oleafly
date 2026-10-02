// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COPIED_FEEDBACK_MS,
  COPY_FAILED_FEEDBACK_MS,
  useCopyStatus,
} from "./use-copy-status";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCopyStatus", () => {
  it("shows the copied text until the feedback delay passes", async () => {
    const { result } = renderHook(() => useCopyStatus());
    let copied = false;
    await act(async () => {
      copied = await result.current.copy("abc");
    });
    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(result.current.status).toBe("copied");
    expect(result.current.copied).toBe(true);
    expect(result.current.copiedText).toBe("abc");

    act(() => vi.advanceTimersByTime(COPIED_FEEDBACK_MS - 1));
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.status).toBe("idle");
    expect(result.current.copiedText).toBeNull();
  });

  it("restarts the delay for a second copy", async () => {
    const { result } = renderHook(() => useCopyStatus({ copiedMs: 100 }));
    await act(async () => {
      await result.current.copy("first");
    });
    act(() => vi.advanceTimersByTime(60));
    await act(async () => {
      await result.current.copy("second");
    });
    act(() => vi.advanceTimersByTime(60));
    expect(result.current.copiedText).toBe("second");
    act(() => vi.advanceTimersByTime(40));
    expect(result.current.copiedText).toBeNull();
  });

  it("reports a failed copy and clears it after the failure delay", async () => {
    const failure = new Error("blocked");
    writeText.mockRejectedValueOnce(failure);
    const onError = vi.fn();
    const { result } = renderHook(() => useCopyStatus({ onError }));
    let copied = true;
    await act(async () => {
      copied = await result.current.copy("abc");
    });
    expect(copied).toBe(false);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.status).toBe("failed");
    expect(result.current.copied).toBe(false);
    expect(result.current.copiedText).toBeNull();

    act(() => vi.advanceTimersByTime(COPY_FAILED_FEEDBACK_MS));
    expect(result.current.status).toBe("idle");
  });

  it("resets on demand", async () => {
    const { result } = renderHook(() => useCopyStatus());
    await act(async () => {
      await result.current.copy("abc");
    });
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    act(() => vi.advanceTimersByTime(COPIED_FEEDBACK_MS));
    expect(result.current.status).toBe("idle");
  });

  it("leaves state alone when the copy settles after unmount", async () => {
    let finish!: () => void;
    writeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useCopyStatus());
    const pending = result.current.copy("late");
    unmount();
    finish();
    await expect(pending).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
