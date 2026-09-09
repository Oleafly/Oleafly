import { describe, expect, it, vi } from "vitest";
import { createTerminalResizer } from "./terminal-resize";

describe("terminal resize queue", () => {
  it("bounds a stalled resize storm to the active and latest sizes", async () => {
    let release!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const queue = createTerminalResizer(send, vi.fn());
    queue.request(80, 24);
    for (let cols = 81; cols <= 300; cols++) queue.request(cols, 40);
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    expect(send.mock.calls).toEqual([[80, 24], [300, 40]]);
    release();
    await Promise.resolve();
    queue.request(300, 40);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("discards queued work and late errors after terminal disposal", async () => {
    let reject!: (error: Error) => void;
    const send = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const onError = vi.fn();
    const queue = createTerminalResizer(send, onError);
    queue.request(80, 24);
    queue.request(100, 30);
    queue.dispose();
    reject(new Error("terminal closed"));
    await Promise.resolve();
    queue.request(120, 30);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports failures and permits retrying the same size", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("resize failed")).mockResolvedValue(undefined);
    const onError = vi.fn();
    const queue = createTerminalResizer(send, onError);
    queue.request(80, 24);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    queue.request(80, 24);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
