import { useEffect } from 'react';

export function useMount(callback: () => void) {
  useEffect(() => {
    callback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
