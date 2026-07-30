import { DependencyList, EffectCallback, useEffect } from 'react';

import { useIsFirstRender } from './useIsFirstRender';

export function useUpdateEffect(effect: EffectCallback, dependencies?: DependencyList) {
  const isFirstRender = useIsFirstRender();

  useEffect(() => {
    if (!isFirstRender) {
      return effect();
    }

    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
