export type PdfLayerRelease = () => void;

export interface PdfLayerQueue {
  acquire(pageNumber: number, isCurrent: () => boolean): Promise<PdfLayerRelease | null>;
  setPaused(paused: boolean): void;
  size(): number;
  clear(): void;
}

interface PdfLayerWaiter {
  pageNumber: number;
  isCurrent: () => boolean;
  grant: (release: PdfLayerRelease | null) => void;
}

function createTaskScheduler(): (run: () => void) => void {
  if (typeof MessageChannel !== "function") {
    return (run) => {
      setTimeout(run, 0);
    };
  }
  const channel = new MessageChannel();
  const queued: Array<() => void> = [];
  channel.port1.onmessage = () => {
    queued.shift()?.();
  };
  (channel.port1 as MessagePort & { unref?: () => void }).unref?.();
  (channel.port2 as MessagePort & { unref?: () => void }).unref?.();
  return (run) => {
    queued.push(run);
    channel.port2.postMessage(null);
  };
}

export function createPdfLayerQueue(
  priority: (pageNumber: number) => number,
  schedule: (run: () => void) => void = createTaskScheduler(),
): PdfLayerQueue {
  const waiters = new Set<PdfLayerWaiter>();
  let paused = false;
  let held = false;
  let scheduled = false;

  const take = (): PdfLayerWaiter | null => {
    let chosen: PdfLayerWaiter | null = null;
    let chosenPriority = Number.POSITIVE_INFINITY;
    for (const waiter of [...waiters]) {
      if (!waiter.isCurrent()) {
        waiters.delete(waiter);
        waiter.grant(null);
        continue;
      }
      const value = priority(waiter.pageNumber);
      if (chosen === null || value < chosenPriority) {
        chosen = waiter;
        chosenPriority = value;
      }
    }
    if (chosen) waiters.delete(chosen);
    return chosen;
  };

  const request = () => {
    if (scheduled || paused || held || waiters.size === 0) return;
    scheduled = true;
    schedule(pump);
  };

  function pump() {
    scheduled = false;
    if (paused || held) return;
    const waiter = take();
    if (!waiter) return;
    held = true;
    let released = false;
    waiter.grant(() => {
      if (released) return;
      released = true;
      held = false;
      request();
    });
  }

  return {
    acquire(pageNumber, isCurrent) {
      return new Promise((grant) => {
        waiters.add({ pageNumber, isCurrent, grant });
        request();
      });
    },
    setPaused(next) {
      paused = next;
      request();
    },
    size() {
      return waiters.size;
    },
    clear() {
      const dropped = [...waiters];
      waiters.clear();
      for (const waiter of dropped) waiter.grant(null);
    },
  };
}
