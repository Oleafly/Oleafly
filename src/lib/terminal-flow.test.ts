import { describe, expect, it, vi } from "vitest";
import { createAckBatcher, TERMINAL_ACK_CHUNK } from "./terminal-flow";

describe("terminal acknowledgements", () => {
  it("acknowledges whole chunks once the session is ready", () => {
    const send = vi.fn();
    const acks = createAckBatcher(send, 100);
    acks.written(60);
    acks.written(60);
    expect(send).not.toHaveBeenCalled();
    acks.ready();
    expect(send).toHaveBeenCalledWith(120);
    acks.written(99);
    expect(send).toHaveBeenCalledTimes(1);
    acks.written(1);
    expect(send).toHaveBeenLastCalledWith(100);
    acks.dispose();
    acks.written(500);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits for a full chunk by default", () => {
    const send = vi.fn();
    const acks = createAckBatcher(send);
    acks.ready();
    acks.written(TERMINAL_ACK_CHUNK - 1);
    expect(send).not.toHaveBeenCalled();
    acks.written(1);
    expect(send).toHaveBeenCalledWith(TERMINAL_ACK_CHUNK);
  });

  it("sends nothing once disposed, even when it becomes ready", () => {
    const send = vi.fn();
    const acks = createAckBatcher(send, 10);
    acks.written(50);
    acks.dispose();
    acks.ready();
    expect(send).not.toHaveBeenCalled();
  });
});
