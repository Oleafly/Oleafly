import { ActionDispatch, AnyActionArg, useCallback, useReducer } from 'react';

export type UseToggleResult = [
  value: boolean,
  actions: {
    toggle: ActionDispatch<AnyActionArg>;
    toggleOff: () => void;
    toggleOn: () => void;
  },
];

export function useToggle(initialValue: boolean = true): UseToggleResult {
  const [value, toggle] = useReducer(
    (state: boolean, nextValue?: boolean) => (typeof nextValue === 'boolean' ? nextValue : !state),
    initialValue,
  );

  const toggleOn = useCallback(() => toggle(true), []);
  const toggleOff = useCallback(() => toggle(false), []);

  return [value, { toggle, toggleOn, toggleOff }];
}
