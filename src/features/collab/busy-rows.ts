import { useCallback, useRef, useState } from "react";

export interface BusyRows {
  busy: ReadonlySet<string>;
  // Runs `action` for the row unless that row already has one in flight.
  // False when it didn't run. Errors from `action` reach the caller.
  run: (id: string, action: () => Promise<void>) => Promise<boolean>;
}

// Rows with a request in flight, each tracked on its own: finishing one
// row's action never frees another row that is still busy, and a second
// click on a busy row sends nothing.
export function useBusyRows(): BusyRows {
  const running = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const run = useCallback(async (id: string, action: () => Promise<void>) => {
    if (running.current.has(id)) return false;
    running.current.add(id);
    setBusy(new Set(running.current));
    try {
      await action();
      return true;
    } finally {
      running.current.delete(id);
      setBusy(new Set(running.current));
    }
  }, []);
  return { busy, run };
}
