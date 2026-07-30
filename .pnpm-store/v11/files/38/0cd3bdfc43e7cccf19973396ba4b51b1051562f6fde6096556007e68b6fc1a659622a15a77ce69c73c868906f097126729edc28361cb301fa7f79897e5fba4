import { useEffect } from 'react';

import { usePrevious } from './usePrevious';

export function useHasChanged<T>(
  value: T,
  callback?: (previous: T) => void,
): [hasChanged: boolean, previous: T | undefined] {
  const previous = usePrevious(value);
  const hasChanged = typeof previous !== 'undefined' && previous !== value;

  useEffect(() => {
    if (hasChanged) {
      callback?.(previous);
    }
  }, [callback, hasChanged, previous]);

  return [hasChanged, previous];
}
