// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useTauriEvent, useTauriSubscription } from "./use-tauri-event";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(name, handler);
    return mocks.unlisten;
  });
});

describe("useTauriEvent", () => {
  it("delivers payloads to the latest handler and stops on unmount", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = renderHook(({ handler }) => useTauriEvent<number>("tick", handler), {
      initialProps: { handler: first },
    });
    await act(async () => {});
    expect(mocks.listen).toHaveBeenCalledWith("tick", expect.any(Function));

    mocks.handlers.get("tick")?.({ payload: 1 });
    view.rerender({ handler: second });
    mocks.handlers.get("tick")?.({ payload: 2 });

    expect(first).toHaveBeenCalledExactlyOnceWith(1);
    expect(second).toHaveBeenCalledExactlyOnceWith(2);
    expect(mocks.listen).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not listen while disabled", async () => {
    renderHook(() => useTauriEvent("tick", vi.fn(), false));
    await act(async () => {});
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("logs a listener that fails to register", async () => {
    const failure = new Error("no bridge");
    mocks.listen.mockRejectedValueOnce(failure);
    renderHook(() => useTauriEvent("tick", vi.fn()));
    await act(async () => {});
    expect(mocks.logError).toHaveBeenCalledWith("listen for tick", failure);
  });
});

describe("useTauriSubscription", () => {
  it("releases a subscription that resolves after unmount", async () => {
    const pending = deferred<() => void>();
    const release = vi.fn();
    const view = renderHook(() => useTauriSubscription(() => pending.promise, "bridge"));
    view.unmount();
    expect(release).not.toHaveBeenCalled();

    await act(async () => pending.resolve(release));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("resubscribes when the subscription changes and skips a null one", async () => {
    const releaseA = vi.fn();
    const releaseB = vi.fn();
    const subscribeA = vi.fn(async () => releaseA);
    const subscribeB = vi.fn(async () => releaseB);
    const view = renderHook(({ subscribe }) => useTauriSubscription(subscribe, "bridge"), {
      initialProps: { subscribe: subscribeA as (() => Promise<() => void>) | null },
    });
    await act(async () => {});
    view.rerender({ subscribe: subscribeB });
    await act(async () => {});
    expect(releaseA).toHaveBeenCalledTimes(1);
    expect(subscribeB).toHaveBeenCalledTimes(1);

    view.rerender({ subscribe: null });
    expect(releaseB).toHaveBeenCalledTimes(1);
    expect(subscribeA).toHaveBeenCalledTimes(1);
  });

  it("logs a failed subscription under its scope", async () => {
    const failure = new Error("denied");
    renderHook(() => useTauriSubscription(() => Promise.reject(failure), "start the bridge"));
    await act(async () => {});
    expect(mocks.logError).toHaveBeenCalledWith("start the bridge", failure);
  });
});
