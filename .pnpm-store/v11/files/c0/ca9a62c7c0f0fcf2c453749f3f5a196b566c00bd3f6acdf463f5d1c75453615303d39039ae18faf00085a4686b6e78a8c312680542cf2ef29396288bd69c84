import { useEffect, useRef, useState } from 'react';

import { useUnmount } from './useUnmount';

export function useThrottleValue<T>(value: T, delayMs: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const hasNextValue = useRef(false);
  const nextValue = useRef<any>(null);
  const timer = useRef<number>(undefined);

  useEffect(() => {
    if (!timer.current) {
      setThrottledValue(value);

      const timeoutCallback = () => {
        if (hasNextValue.current) {
          hasNextValue.current = false;
          setThrottledValue(nextValue.current);
          timer.current = window.setTimeout(timeoutCallback, delayMs);
        } else {
          timer.current = undefined;
        }
      };

      timer.current = window.setTimeout(timeoutCallback, delayMs);
    } else {
      hasNextValue.current = true;
      nextValue.current = value;
    }
  }, [delayMs, value]);

  useUnmount(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  });

  return throttledValue;
}
