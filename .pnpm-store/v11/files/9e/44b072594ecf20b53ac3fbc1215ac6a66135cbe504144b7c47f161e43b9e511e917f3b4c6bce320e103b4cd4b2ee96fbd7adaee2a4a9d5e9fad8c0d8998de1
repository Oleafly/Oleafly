import { DependencyList, EffectCallback, useEffect, useRef } from 'react';
import deepEqual from '@gilbarbara/deep-equal';

import { validateDependencies } from './utils';

export function useEffectDeepCompare(effect: EffectCallback, dependencies: DependencyList) {
  validateDependencies(dependencies, 'useEffectDeepCompare', 'useEffect');

  const ref = useRef<DependencyList>(dependencies);

  if (!deepEqual(dependencies, ref.current)) {
    ref.current = dependencies;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, ref.current);
}
