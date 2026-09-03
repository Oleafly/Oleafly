// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOverlayGate } from "./use-overlay-gate";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useOverlayGate", () => {
  it("hides the content before reporting the overlay as open", async () => {
    const hide = deferred();
    const setContentVisible = vi.fn((visible: boolean) =>
      visible ? Promise.resolve() : hide.promise,
    );
    const { result } = renderHook(() => useOverlayGate(setContentVisible));
    expect(result.current.open).toBe(false);

    act(() => result.current.setOpen(true));
    expect(setContentVisible).toHaveBeenCalledWith(false);
    expect(result.current.open).toBe(false);

    await act(async () => {
      hide.resolve();
      await hide.promise;
    });
    expect(result.current.open).toBe(true);
  });

  it("shows the content again as soon as the overlay closes", async () => {
    const setContentVisible = vi.fn((_visible: boolean) => Promise.resolve());
    const { result } = renderHook(() => useOverlayGate(setContentVisible));
    await act(async () => {
      result.current.setOpen(true);
    });
    expect(result.current.open).toBe(true);
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    expect(setContentVisible.mock.calls.map(([v]) => v)).toEqual([false, true]);
  });

  it("does not open when a close arrives before the hide completes", async () => {
    const hide = deferred();
    const setContentVisible = vi.fn((visible: boolean) =>
      visible ? Promise.resolve() : hide.promise,
    );
    const { result } = renderHook(() => useOverlayGate(setContentVisible));
    act(() => result.current.setOpen(true));
    act(() => result.current.setOpen(false));
    await act(async () => {
      hide.resolve();
      await hide.promise;
    });
    expect(result.current.open).toBe(false);
    expect(setContentVisible).toHaveBeenLastCalledWith(true);
  });

  it("still opens when hiding fails so the menu is never stuck", async () => {
    const setContentVisible = vi.fn((visible: boolean) =>
      visible ? Promise.resolve() : Promise.reject(new Error("gone")),
    );
    const { result } = renderHook(() => useOverlayGate(setContentVisible));
    await act(async () => {
      result.current.setOpen(true);
    });
    expect(result.current.open).toBe(true);
  });

  it("restores the content when unmounted while open", async () => {
    const setContentVisible = vi.fn(() => Promise.resolve());
    const { result, unmount } = renderHook(() => useOverlayGate(setContentVisible));
    await act(async () => {
      result.current.setOpen(true);
    });
    unmount();
    expect(setContentVisible).toHaveBeenLastCalledWith(true);
  });
});
