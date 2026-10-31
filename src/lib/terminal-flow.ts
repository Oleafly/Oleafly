export const TERMINAL_ACK_CHUNK = 128 * 1024;

export interface AckBatcher {
  written(bytes: number): void;
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
