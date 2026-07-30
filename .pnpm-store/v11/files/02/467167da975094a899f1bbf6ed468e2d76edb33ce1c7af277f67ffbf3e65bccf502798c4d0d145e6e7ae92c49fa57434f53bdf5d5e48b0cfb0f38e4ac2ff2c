import { useCallback, useEffect, useRef } from 'react';

import { TimerStatus } from './types';

export type UseTimeoutStatus = TimerStatus;

export interface UseTimeoutResult {
  cancel: () => void;
  getStatus: () => UseTimeoutStatus;
  reset: () => void;
}

export function useTimeout(callback: () => void, delayMs: number = 0): UseTimeoutResult {
  const status = useRef<UseTimeoutStatus>('pending');
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);
  const savedCallback = useRef(callback);

  const clear = useCallback(() => {
    status.current = 'cancelled';
    timeout.current && clearTimeout(timeout.current);
  }, []);

  const set = useCallback(() => {
    status.current = 'pending';
    timeout.current && clearTimeout(timeout.current);

    timeout.current = setTimeout(() => {
      status.current = 'completed';
      savedCallback.current();
    }, delayMs);
  }, [delayMs]);

  const getStatus = useCallback(() => status.current, []);

  // update ref when function changes
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // set on mount, clear on unmount
  useEffect(() => {
    set();

    return clear;
  }, [set, clear]);

  return { cancel: clear, getStatus, reset: set };
}
