import { DependencyList, useCallback, useRef } from 'react';
import deepEqual from '@gilbarbara/deep-equal';

import { FunctionWithArguments } from './types';
import { validateDependencies } from './utils';

export function useCallbackDeepCompare<T extends FunctionWithArguments>(
  callback: T,
  dependencies: DependencyList,
): T {
  validateDependencies(dependencies, 'useCallbackDeepCompare', 'useCallback');

  const ref = useRef<DependencyList>(dependencies);
  const callbackRef = useRef<T>(callback); // Store the latest function reference

  if (!deepEqual(dependencies, ref.current)) {
    ref.current = dependencies;
    callbackRef.current = callback; // Update function reference when deps change
  }

  return useCallback(
    (...arguments_: any[]) => callbackRef.current(...arguments_),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ref.current,
  ) as T;
}
