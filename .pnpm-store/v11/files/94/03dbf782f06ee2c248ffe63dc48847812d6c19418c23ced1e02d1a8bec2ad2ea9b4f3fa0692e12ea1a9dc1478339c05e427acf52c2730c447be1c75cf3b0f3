import { useEffect, useRef } from 'react';

import { useMemoizedValue } from './useMemoizedValue';
import { off, on } from './utils';

export function useClickOutside<T extends Element = HTMLElement>(callback: () => void) {
  const ref = useRef<T>(null);
  const memoizedCallback = useMemoizedValue(callback);

  useEffect(() => {
    const handleClick = (event: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        memoizedCallback();
      }
    };

    on(document, 'click', handleClick);

    return () => {
      off(document, 'click', handleClick);
    };
  }, [memoizedCallback]);

  return ref;
}
