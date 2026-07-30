import * as React from 'react';

/**
 * Sync value with state.
 * This should only used for internal which not affect outside calculation.
 * Since it's not safe for suspense.
 */
export default function useSyncState(defaultValue, controlledValue) {
  const valueRef = React.useRef(defaultValue);
  const [, forceUpdate] = React.useState({});
  const getter = useControlledValueFirst => useControlledValueFirst && controlledValue !== undefined ? controlledValue : valueRef.current;
  const setter = nextValue => {
    valueRef.current = nextValue;
    forceUpdate({});
  };
  return [getter, setter, getter(true)];
}