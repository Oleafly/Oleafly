import { useCallback, useRef, useState } from "react";

export interface BusyRows {
  busy: ReadonlySet<string>;
  run: (id: string, action: () => Promise<void>) => Promise<boolean>;
}

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
