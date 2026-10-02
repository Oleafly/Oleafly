import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { logError } from "@/lib/log";

export type Unsubscribe = () => void;
export type Subscribe = () => Promise<Unsubscribe>;

export function useTauriSubscription(subscribe: Subscribe | null, scope: string): void {
  useEffect(() => {
    if (!subscribe) return;
    let disposed = false;
    let stop: Unsubscribe | undefined;
    subscribe().then(
      (unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      },
      (error: unknown) => {
        void logError(scope, error);
      },
    );
    return () => {
      disposed = true;
      stop?.();
    };
  }, [subscribe, scope]);
}

export function useTauriEvent<T>(
  event: string,
  handler: (payload: T) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const subscribe = useCallback(
    () => listen<T>(event, ({ payload }) => handlerRef.current(payload)),
    [event],
  );
  useTauriSubscription(enabled ? subscribe : null, `listen for ${event}`);
}
