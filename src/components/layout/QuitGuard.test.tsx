// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.events.set(name, handler);
    return () => mocks.events.delete(name);
  }),
  isTauri: vi.fn(() => true),
  confirmQuitFlush: vi.fn(async () => {}),
  cancelQuitFlush: vi.fn(async () => {}),
  flushForQuit: vi.fn(async () => {}),
  notifyError: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@/lib/tauri", () => ({
  confirmQuitFlush: mocks.confirmQuitFlush,
  cancelQuitFlush: mocks.cancelQuitFlush,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ flushForQuit: mocks.flushForQuit }) },
}));

import { QuitGuard } from "./QuitGuard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function fireQuitRequest(restart = false) {
  await waitFor(() => expect(mocks.events.has("quit-flush-requested")).toBe(true));
  mocks.events.get("quit-flush-requested")?.({ payload: restart });
}

beforeEach(() => {
  mocks.events.clear();
  mocks.listen.mockClear();
  mocks.confirmQuitFlush.mockClear().mockResolvedValue(undefined);
  mocks.cancelQuitFlush.mockClear().mockResolvedValue(undefined);
  mocks.flushForQuit.mockReset().mockResolvedValue(undefined);
  mocks.notifyError.mockClear();
});

describe("QuitGuard", () => {
  it("flushes dirty buffers and confirms the quit when every save succeeds", async () => {
    render(<QuitGuard />);
    await fireQuitRequest(false);

    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(false));
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/could not be saved/i)).toBeNull();
  });

  it("passes the restart intent through after a successful flush", async () => {
    render(<QuitGuard />);
    await fireQuitRequest(true);

    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(true));
  });

  it("blocks the quit and lets the user stay when the flush fails", async () => {
    mocks.flushForQuit.mockRejectedValue(new Error("disk full"));
    render(<QuitGuard />);
    await fireQuitRequest(false);

    await screen.findByText(/could not be saved/i);
    expect(screen.getByRole("alertdialog").parentElement).toHaveClass("pointer-events-auto");
    expect(mocks.confirmQuitFlush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /stay/i }));
    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/could not be saved/i)).toBeNull();
    expect(mocks.confirmQuitFlush).not.toHaveBeenCalled();
  });

  it("quits anyway on explicit confirmation despite the failed flush", async () => {
    mocks.flushForQuit.mockRejectedValue(new Error("disk full"));
    render(<QuitGuard />);
    await fireQuitRequest(false);

    await screen.findByText(/could not be saved/i);
    fireEvent.click(screen.getByRole("button", { name: /quit anyway/i }));

    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(false));
  });

  it("ignores a repeated quit request while a flush is already running", async () => {
    const flush = deferred<void>();
    mocks.flushForQuit.mockImplementation(() => flush.promise);
    render(<QuitGuard />);
    await fireQuitRequest(false);
    await fireQuitRequest(false);

    flush.resolve();
    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
  });

  it("offers a safe escape when the save flush never settles", async () => {
    vi.useFakeTimers();
    const flush = deferred<void>();
    mocks.flushForQuit.mockImplementation(() => flush.promise);
    try {
      render(<QuitGuard />);
      await act(async () => {});
      expect(mocks.events.has("quit-flush-requested")).toBe(true);

      await act(async () => {
        mocks.events.get("quit-flush-requested")?.({ payload: false });
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(screen.getByText(/could not be saved/i)).toBeInTheDocument();
      expect(screen.getByText(/saving did not finish/i)).toBeInTheDocument();
      expect(mocks.confirmQuitFlush).not.toHaveBeenCalled();
    } finally {
      flush.resolve();
      vi.useRealTimers();
    }
  });
});
