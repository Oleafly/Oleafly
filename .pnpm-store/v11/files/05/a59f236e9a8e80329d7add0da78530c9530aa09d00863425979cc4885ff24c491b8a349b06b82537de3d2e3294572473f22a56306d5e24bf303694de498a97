import { useRef } from 'react';

export function useOnce(callback: () => void): void {
  const hasBeenCalled = useRef(false);

  if (hasBeenCalled.current) {
    return;
  }

  callback();
  hasBeenCalled.current = true;
}
