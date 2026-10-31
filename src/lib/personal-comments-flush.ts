// Keep quit/update paths independent of the lazily loaded comments feature.
const flushers = new Set<() => Promise<void>>();

export function registerPersonalCommentsFlush(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

export async function flushPersonalComments(): Promise<void> {
  for (const flush of [...flushers]) await flush();
}
