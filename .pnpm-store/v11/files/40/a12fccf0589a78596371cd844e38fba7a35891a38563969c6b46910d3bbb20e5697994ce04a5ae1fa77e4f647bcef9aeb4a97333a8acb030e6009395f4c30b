import { raf, useControlledState, useEvent } from '@rc-component/util';
import React from 'react';

/**
 * Will be `true` immediately for next effect.
 * But will be `false` for a delay of effect.
 */
export default function useDelayState(value, defaultValue, onChange) {
  const [state, setState] = useControlledState(defaultValue, value);

  // Need force update to ensure React re-render
  const [, forceUpdate] = React.useState({});
  const triggerUpdate = useEvent(nextState => {
    setState(nextState);
    forceUpdate({});
  });
  const nextValueRef = React.useRef(value);

  // ============================= Update =============================
  const rafRef = React.useRef();
  const cancelRaf = () => {
    raf.cancel(rafRef.current);
  };
  const doUpdate = useEvent(() => {
    triggerUpdate(nextValueRef.current);
    if (onChange && state !== nextValueRef.current) {
      onChange(nextValueRef.current);
    }
  });
  const updateValue = useEvent((next, immediately) => {
    cancelRaf();
    nextValueRef.current = next;
    if (next || immediately) {
      doUpdate();
    } else {
      rafRef.current = raf(doUpdate);
    }
  });
  React.useEffect(() => cancelRaf, []);
  return [state, updateValue];
}