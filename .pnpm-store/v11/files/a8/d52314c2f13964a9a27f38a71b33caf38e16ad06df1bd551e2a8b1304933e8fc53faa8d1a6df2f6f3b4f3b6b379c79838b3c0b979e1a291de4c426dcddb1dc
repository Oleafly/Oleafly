import { useEffect, useRef } from 'react';

export function useInterval(callback: () => void, delayMs: number | null = 100) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  });

  useEffect(() => {
    if (delayMs !== null) {
      const interval = setInterval(() => savedCallback.current(), delayMs);

      return () => {
        clearInterval(interval);
      };
    }

    return undefined;
  }, [delayMs]);
}
