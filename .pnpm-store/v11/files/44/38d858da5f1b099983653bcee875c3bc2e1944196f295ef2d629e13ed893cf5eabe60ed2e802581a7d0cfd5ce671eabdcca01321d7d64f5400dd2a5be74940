import { useEffect } from 'react';

import { useLatest } from './useLatest';

export function useUnmount(callback: () => void) {
  const callbackRef = useLatest(callback);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => callbackRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
