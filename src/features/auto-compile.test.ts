import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_COMPILE_DEBOUNCE_MS,
  AUTO_COMPILE_RETRY_MS,
  scheduleAutoCompile,
  type AutoCompileSnapshot,
} from "./auto-compile";

function harness(initial: AutoCompileSnapshot) {
  const snapshot = { ...initial };
  const recompile = vi.fn();
  const stopCompile = vi.fn(() => {
    snapshot.status = "idle";
  });
  return {
    snapshot,
    recompile,
    stopCompile,
    schedule: (editedAt: number) =>
      scheduleAutoCompile({
        editedAt,
        getSnapshot: () => ({ ...snapshot }),
        recompile,
        stopCompile,
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduleAutoCompile", () => {
  it("waits out the debounce before recompiling", () => {
    const h = harness({ status: "idle", compileStartedAt: null });
    h.schedule(1_000);

    vi.advanceTimersByTime(AUTO_COMPILE_DEBOUNCE_MS - 1);
    expect(h.recompile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(h.recompile).toHaveBeenCalledTimes(1);
    expect(h.stopCompile).not.toHaveBeenCalled();
  });

  it("stops a build that started before the edit, then recompiles", () => {
    const h = harness({ status: "compiling", compileStartedAt: 500 });
    h.schedule(1_000);

    vi.advanceTimersByTime(AUTO_COMPILE_DEBOUNCE_MS);
    expect(h.stopCompile).toHaveBeenCalledTimes(1);
    expect(h.recompile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AUTO_COMPILE_RETRY_MS);
    expect(h.recompile).toHaveBeenCalledTimes(1);
  });

  it("asks a slow stale build to stop only once", () => {
    const h = harness({ status: "compiling", compileStartedAt: 500 });
    h.stopCompile.mockImplementation(() => {});
    h.schedule(1_000);

    vi.advanceTimersByTime(AUTO_COMPILE_DEBOUNCE_MS + AUTO_COMPILE_RETRY_MS * 4);
    expect(h.stopCompile).toHaveBeenCalledTimes(1);
    expect(h.recompile).not.toHaveBeenCalled();
  });

  it("waits for a build that started after the edit instead of stopping it", () => {
    const h = harness({ status: "compiling", compileStartedAt: 2_000 });
    h.schedule(1_000);

    vi.advanceTimersByTime(AUTO_COMPILE_DEBOUNCE_MS + AUTO_COMPILE_RETRY_MS * 3);
    expect(h.stopCompile).not.toHaveBeenCalled();
    expect(h.recompile).not.toHaveBeenCalled();

    h.snapshot.status = "idle";
    vi.advanceTimersByTime(AUTO_COMPILE_RETRY_MS);
    expect(h.recompile).toHaveBeenCalledTimes(1);
  });

  it("waits for a build with no recorded start time rather than stopping it", () => {
    const h = harness({ status: "compiling", compileStartedAt: null });
    h.schedule(1_000);

    vi.advanceTimersByTime(AUTO_COMPILE_DEBOUNCE_MS + AUTO_COMPILE_RETRY_MS * 2);
    expect(h.stopCompile).not.toHaveBeenCalled();
    expect(h.recompile).not.toHaveBeenCalled();
  });

  it("cancelling before the debounce elapses compiles nothing", () => {
    const h = harness({ status: "idle", compileStartedAt: null });
    h.schedule(1_000)();

    vi.advanceTimersByTime(AUTO_COMPILE_DEBOUNCE_MS * 4);
    expect(h.recompile).not.toHaveBeenCalled();
  });

  it("cancelling while polling a stale build stops the poll loop", () => {
    const h = harness({ status: "compiling", compileStartedAt: 500 });
    h.stopCompile.mockImplementation(() => {});
    const cancel = h.schedule(1_000);

    vi.advanceTimersByTime(AUTO_COMPILE_DEBOUNCE_MS);
    expect(h.stopCompile).toHaveBeenCalledTimes(1);

    cancel();
    h.snapshot.status = "idle";
    vi.advanceTimersByTime(AUTO_COMPILE_RETRY_MS * 4);
    expect(h.recompile).not.toHaveBeenCalled();
  });
});
