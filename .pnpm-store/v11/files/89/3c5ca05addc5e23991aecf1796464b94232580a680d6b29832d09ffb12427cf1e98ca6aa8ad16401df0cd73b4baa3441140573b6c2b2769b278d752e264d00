import { useState } from 'react';

import { useEffectDeepCompare } from './useEffectDeepCompare';
import { useIsFirstRender } from './useIsFirstRender';

export function useMemoizedValue<T = any>(value: T) {
  const [stableValue, setStableValue] = useState(() => value);
  const isFirstRender = useIsFirstRender();

  useEffectDeepCompare(() => {
    if (isFirstRender) {
      return;
    }

    setStableValue(() => value);
  }, [value]);

  return stableValue;
}
