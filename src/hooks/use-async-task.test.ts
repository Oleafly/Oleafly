// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncTask, type AsyncTaskOutcome } from "./use-async-task";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const describeFailure = (error: unknown) =>
  error instanceof Error && error.name === "AbortError" ? null : String(error);

describe("useAsyncTask", () => {
  it("tracks a task from busy to its result", async () => {
    const pending = deferred<number>();
    const { result } = renderHook(() => useAsyncTask<number>(describeFailure));
    let outcome!: Promise<AsyncTaskOutcome<number>>;
    act(() => {
      outcome = result.current.run(() => pending.promise);
    });
    expect(result.current).toMatchObject({ busy: true, result: null, error: null });

    await act(async () => pending.resolve(42));
    await expect(outcome).resolves.toEqual({ status: "done", result: 42 });
    expect(result.current).toMatchObject({ busy: false, result: 42, error: null });
  });

  it("maps a failure through the caller", async () => {
    const toFailure = vi.fn(describeFailure);
    const { result } = renderHook(() => useAsyncTask<number>(toFailure));
    let outcome!: AsyncTaskOutcome<number>;
    await act(async () => {
      outcome = await result.current.run(() => Promise.reject(new Error("bad input")));
    });
    expect(outcome).toEqual({ status: "failed" });
    expect(toFailure).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ busy: false, result: null, error: "Error: bad input" });
  });

  it("treats a failure the caller declines as no error", async () => {
    const { result } = renderHook(() => useAsyncTask<number>(describeFailure));
    const abort = Object.assign(new Error("stopped"), { name: "AbortError" });
    let outcome!: AsyncTaskOutcome<number>;
    await act(async () => {
      outcome = await result.current.run(() => Promise.reject(abort));
    });
    expect(outcome).toEqual({ status: "dropped" });
    expect(result.current).toMatchObject({ busy: false, error: null });
  });

  it("drops an older run and aborts its signal when a newer one starts", async () => {
    const first = deferred<number>();
    const toFailure = vi.fn(describeFailure);
    const { result } = renderHook(() => useAsyncTask<number>(toFailure));
    let firstSignal!: AbortSignal;
    let older!: Promise<AsyncTaskOutcome<number>>;
    act(() => {
      older = result.current.run((signal) => {
        firstSignal = signal;
        return first.promise;
      });
    });
    await act(async () => {
      await result.current.run(async () => 2);
    });
    expect(firstSignal.aborted).toBe(true);

    await act(async () => first.reject(new Error("late")));
    await expect(older).resolves.toEqual({ status: "dropped" });
    expect(toFailure).not.toHaveBeenCalled();
    expect(result.current.result).toBe(2);
  });

  it("cancels a running task without touching what it already shows", async () => {
    const pending = deferred<number>();
    const { result } = renderHook(() => useAsyncTask<number>(describeFailure));
    let signal!: AbortSignal;
    act(() => {
      void result.current.run((next) => {
        signal = next;
        return pending.promise;
      });
    });
    act(() => result.current.cancel());
    expect(signal.aborted).toBe(true);
    expect(result.current.busy).toBe(false);

    await act(async () => pending.resolve(9));
    expect(result.current.result).toBeNull();

    act(() => result.current.cancel());
    expect(result.current.busy).toBe(false);
  });

  it("resets, accepts an edited result, and aborts on unmount", async () => {
    const { result, unmount } = renderHook(() => useAsyncTask<string>(describeFailure));
    await act(async () => {
      await result.current.run(async () => "draft");
    });
    act(() => result.current.setResult("edited"));
    expect(result.current.result).toBe("edited");

    act(() => result.current.reset());
    expect(result.current).toMatchObject({ busy: false, result: null, error: null });

    let signal!: AbortSignal;
    act(() => {
      void result.current.run((next) => {
        signal = next;
        return new Promise<string>(() => {});
      });
    });
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
