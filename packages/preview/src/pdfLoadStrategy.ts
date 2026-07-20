export function createPdfLoadAttempts<T>(
  expectText: boolean,
  open: () => Promise<T>,
  openAndProbe: () => Promise<T>,
  enableMainThread: () => Promise<void>,
): Array<() => Promise<T>> {
  const primary = expectText ? openAndProbe : open;
  return [
    primary,
    async () => {
      await enableMainThread();
      return primary();
    },
  ];
}
