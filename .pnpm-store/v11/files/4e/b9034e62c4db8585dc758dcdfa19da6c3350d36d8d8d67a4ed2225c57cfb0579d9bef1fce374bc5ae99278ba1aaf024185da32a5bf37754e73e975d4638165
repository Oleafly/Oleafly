import { DependencyList, useMemo, useRef } from 'react';
import deepEqual from '@gilbarbara/deep-equal';

import { validateDependencies } from './utils';

export function useMemoDeepCompare<T>(factory: () => T, dependencies: DependencyList): T {
  validateDependencies(dependencies, 'useMemoDeepCompare', 'useMemo');

  const ref = useRef<DependencyList>(dependencies);

  if (!deepEqual(dependencies, ref.current)) {
    ref.current = dependencies;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, ref.current);
}
