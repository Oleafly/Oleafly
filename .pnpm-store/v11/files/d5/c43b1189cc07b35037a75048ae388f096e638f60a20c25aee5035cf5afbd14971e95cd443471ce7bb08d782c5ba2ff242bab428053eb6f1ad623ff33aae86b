import { useRef } from 'react';

export function useIsFirstRender(): boolean {
  const isFirstRender = useRef(true);

  if (isFirstRender.current) {
    isFirstRender.current = false;

    return true;
  }

  return isFirstRender.current;
}
