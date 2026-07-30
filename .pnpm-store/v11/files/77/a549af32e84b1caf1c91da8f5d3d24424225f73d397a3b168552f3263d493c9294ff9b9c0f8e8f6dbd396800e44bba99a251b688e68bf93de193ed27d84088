import { useEffect } from 'react';

/**
 * Run the provided functions on mount and unmount.
 */
export function useLifecycleHooks(mount: () => void, unmount: () => void) {
  useEffect(() => {
    mount();

    return unmount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
