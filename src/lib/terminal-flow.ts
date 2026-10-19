// Acknowledges terminal output to Rust once xterm has parsed it, in chunks,
// so the shell's output pump can pause when the frontend falls behind.

export const TERMINAL_ACK_CHUNK = 128 * 1024;

export interface AckBatcher {
  /** xterm parsed this many bytes of output. */
  written(bytes: number): void;
  /** The session id is known: acknowledgements can go out. */
  ready(): void;
  dispose(): void;
}

export function createAckBatcher(send: (bytes: number) => void, chunk: number = TERMINAL_ACK_CHUNK): AckBatcher {
  let pending = 0;
  let ready = false;
  let disposed = false;
  const flush = () => {
    if (!ready || disposed || pending < chunk) return;
    const bytes = pending;
    pending = 0;
    send(bytes);
  };
  return {
    written(bytes) {
      if (disposed) return;
      pending += bytes;
      flush();
    },
    ready() {
      if (disposed) return;
      ready = true;
      flush();
    },
    dispose() {
      disposed = true;
      pending = 0;
    },
  };
}
