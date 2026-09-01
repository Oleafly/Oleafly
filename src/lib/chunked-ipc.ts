import { Channel, invoke } from "@tauri-apps/api/core";

// Mirror of src-tauri/src/chunked.rs: large command results stream as ordered
// chunks over a tauri Channel instead of one giant invoke return. Every chunk
// is acknowledged back so the sender can apply backpressure.
export const CHUNKED_MARKER = "oleafly-chunked-message-v1";

export type ChunkedMessage = {
  marker: typeof CHUNKED_MARKER;
  transfer_id: string;
  sequence: number;
} & (
  | { kind: "start"; total_bytes?: number }
  | { kind: "chunk"; data: string }
  | { kind: "end" }
);

/**
 * Collects one chunked text transfer. `start` invokes the backend command,
 * handing it the channel the chunks arrive on.
 */
export function receiveChunkedText(
  start: (channel: Channel<ChunkedMessage>) => Promise<void>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = new Channel<ChunkedMessage>();
    const parts: string[] = [];
    let expected = 0;
    let done = false;

    channel.onmessage = (message) => {
      if (done || message.marker !== CHUNKED_MARKER) return;
      if (message.sequence !== expected) {
        done = true;
        reject(
          new Error(
            `chunked transfer ${message.transfer_id} out of order: got ${message.sequence}, expected ${expected}`,
          ),
        );
        return;
      }
      expected++;
      if (message.kind === "chunk") {
        parts.push(message.data);
        void invoke("chunked_ack", {
          transferId: message.transfer_id,
          sequence: message.sequence,
        }).catch(() => {});
      } else if (message.kind === "end") {
        done = true;
        resolve(parts.join(""));
      }
    };

    start(channel).catch((error) => {
      if (!done) {
        done = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
