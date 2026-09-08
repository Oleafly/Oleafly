export function createTerminalResizer(
  send: (cols: number, rows: number) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  let pending: { cols: number; rows: number } | null = null;
  let running = false;
  let disposed = false;
  let applied: { cols: number; rows: number } | null = null;
  const drain = async () => {
    running = true;
    while (!disposed && pending) {
      const size = pending;
      pending = null;
      if (applied?.cols === size.cols && applied.rows === size.rows) continue;
      try {
        await send(size.cols, size.rows);
        applied = size;
      } catch (error) {
        if (!disposed) onError(error);
      }
    }
    running = false;
  };
  return {
    request(cols: number, rows: number) {
      if (disposed) return;
      pending = { cols, rows };
      if (!running) void drain();
    },
    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
