import { useEffect, useRef, useState } from 'react';

import { canUseDOM, off, on } from './utils';

export interface UseWindowSizeResult {
  height: number;
  width: number;
}

export function useWindowSize(debounce = 0) {
  const [size, setSize] = useState<UseWindowSizeResult>({
    height: canUseDOM() ? window.innerHeight : 0,
    width: canUseDOM() ? window.innerWidth : 0,
  });
  const timeoutRef = useRef<number>(0);

  const handleResize = useRef(() => {
    window.clearTimeout(timeoutRef.current);

    timeoutRef.current = window.setTimeout(() => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }, debounce);
  });

  useEffect(() => {
    /* c8 ignore next 3 */
    if (!canUseDOM()) {
      return () => undefined;
    }

    const getSize = handleResize.current;

    setSize({
      height: window.innerHeight,
      width: window.innerWidth,
    });
    on(window, 'resize', getSize);

    return () => {
      off(window, 'resize', getSize);
    };
  }, []);

  return size;
}
