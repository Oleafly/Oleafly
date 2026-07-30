import { useCallback, useState } from 'react';

type Patch<T> = Partial<T> | ((previousState: T) => Partial<T>);

export function useSetState<T extends object>(
  initialState: T = {} as T,
): [T, (patch: Patch<T>) => void] {
  const [state, set] = useState<T>(initialState);
  const setState = useCallback((patch: Patch<T>) => {
    set(previousState => ({
      ...previousState,
      ...(patch instanceof Function ? patch(previousState) : patch),
    }));
  }, []);

  return [state, setState];
}
