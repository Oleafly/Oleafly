// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  CHUNKED_MARKER,
  receiveChunkedText,
  type ChunkedMessage,
} from "./chunked-ipc";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null;
  },
}));

const mockInvoke = vi.mocked(invoke);

function message(partial: Partial<ChunkedMessage>): ChunkedMessage {
  return {
    marker: CHUNKED_MARKER,
    transfer_id: "t1",
    sequence: 0,
    kind: "start",
    ...partial,
  } as ChunkedMessage;
}

describe("receiveChunkedText", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("reassembles ordered chunks and acknowledges each one", async () => {
    const result = receiveChunkedText(async (channel) => {
      const emit = channel.onmessage as (m: ChunkedMessage) => void;
      emit(message({ kind: "start", sequence: 0 }));
      emit(message({ kind: "chunk", sequence: 1, data: "hello " }));
      emit(message({ kind: "chunk", sequence: 2, data: "world" }));
      emit(message({ kind: "end", sequence: 3 }));
    });

    await expect(result).resolves.toBe("hello world");
    expect(mockInvoke).toHaveBeenCalledWith("chunked_ack", {
      transferId: "t1",
      sequence: 1,
    });
    expect(mockInvoke).toHaveBeenCalledWith("chunked_ack", {
      transferId: "t1",
      sequence: 2,
    });
  });

  it("rejects on an out-of-order sequence", async () => {
    const result = receiveChunkedText(async (channel) => {
      const emit = channel.onmessage as (m: ChunkedMessage) => void;
      emit(message({ kind: "start", sequence: 0 }));
      emit(message({ kind: "chunk", sequence: 2, data: "skipped" }));
    });

    await expect(result).rejects.toThrow(/out of order/);
  });

  it("rejects when the invoke itself fails", async () => {
    const result = receiveChunkedText(async () => {
      throw new Error("command exploded");
    });

    await expect(result).rejects.toThrow("command exploded");
  });
});
