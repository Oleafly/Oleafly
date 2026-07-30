import { Dispatch, SetStateAction } from 'react';

import { useEffectDeepCompare } from './useEffectDeepCompare';
import { useLocalStorage } from './useLocalStorage';
import { useSetState } from './useSetState';

export type UsePersistentStateResult<T> = [
  state: T,
  setState: Dispatch<SetStateAction<Partial<T>>>,
  remove: () => void,
];

export interface UsePersistentStateOptions<TState> {
  /**
   * Check if the saved state keys are different from the initial state and override it if needed.
   * @default false
   */
  overrideDivergentSavedState?: boolean;
  /**
   * Reset properties in the saved state.
   */
  resetProperties?: Partial<TState>;
}

function getState<TState extends object>(
  initialState: TState,
  savedState: TState,
  shouldOverride: boolean,
  restoreProperties?: Partial<TState>,
): TState {
  if (shouldOverride) {
    const initialStateKeys = Object.keys(initialState);
    const savedStateKeys = savedState ? Object.keys(savedState) : [];
    const restorePropertiesKeys = restoreProperties ? Object.keys(restoreProperties) : [];

    if (![...initialStateKeys, ...restorePropertiesKeys].every(k => savedStateKeys.includes(k))) {
      return { ...initialState, ...restoreProperties };
    }

    return { ...savedState, ...restoreProperties };
  }

  return { ...savedState, ...restoreProperties };
}

export function usePersistentState<TState extends object>(
  key: string,
  initialState: TState,
  options?: UsePersistentStateOptions<TState>,
): UsePersistentStateResult<TState> {
  const { overrideDivergentSavedState = false, resetProperties } = options || {};

  const [value, setValue, remove] = useLocalStorage(key, initialState);
  const [state, setState] = useSetState<TState>(
    getState(initialState, value!, overrideDivergentSavedState, resetProperties),
  );

  useEffectDeepCompare(() => {
    setValue(state);
  }, [setValue, state]);

  return [state, setState, remove];
}
