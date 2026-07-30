import { DependencyList, useCallback, useEffect, useRef } from 'react';

import { TimerStatus } from './types';
import { useEffectDeepCompare } from './useEffectDeepCompare';
import { useIsFirstRender } from './useIsFirstRender';

export type UseDebounceStatus = TimerStatus;

// export it
export interface UseDebounceResult {
  cancel: () => void;
  getStatus: () => UseDebounceStatus;
}

export function useDebounce(
  callback: () => void,
  delayMs: number = 250,
  dependencies: DependencyList = [],
): UseDebounceResult {
  const status = useRef<UseDebounceStatus>('pending');
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);
  const savedCallback = useRef(callback);
  const isFirstRender = useIsFirstRender();

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

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffectDeepCompare(() => {
    if (!isFirstRender) {
      set();

      return clear;
    }

    return undefined;
  }, [set, clear, dependencies, delayMs]);

  return { cancel: clear, getStatus };
}
