import * as React from 'react';
import useLockEffect from "./useLockEffect";
/**
 * When user first focus one input, any submit will trigger focus another one.
 * When second time focus one input, submit will not trigger focus again.
 * When click outside to close the panel, trigger event if it can trigger onChange.
 */
export default function useRangeActive(disabled, empty = [], mergedOpen = false) {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const activeListRef = React.useRef([]);
  const submitIndexRef = React.useRef(null);
  const lastOperationRef = React.useRef(null);
  const updateSubmitIndex = index => {
    submitIndexRef.current = index;
  };
  const hasActiveSubmitValue = index => {
    return submitIndexRef.current === index;
  };
  const triggerFocus = nextFocus => {
    setFocused(nextFocus);
  };

  // ============================= Record =============================
  const lastOperation = type => {
    if (type) {
      lastOperationRef.current = type;
    }
    return lastOperationRef.current;
  };

  // ============================ Strategy ============================
  // Trigger when input enter or input blur or panel close
  const nextActiveIndex = nextValue => {
    const list = activeListRef.current;
    const filledActiveSet = new Set(list.filter(index => nextValue[index] || empty[index]));
    const nextIndex = list[list.length - 1] === 0 ? 1 : 0;
    if (filledActiveSet.size >= 2 || disabled[nextIndex]) {
      return null;
    }
    return nextIndex;
  };

  // ============================= Effect =============================
  // Wait in case it's from the click outside to blur
  useLockEffect(focused || mergedOpen, () => {
    if (!focused) {
      activeListRef.current = [];
      updateSubmitIndex(null);
    }
  });
  React.useEffect(() => {
    if (focused) {
      activeListRef.current.push(activeIndex);
    }
  }, [focused, activeIndex]);
  return [focused, triggerFocus, lastOperation, activeIndex, setActiveIndex, nextActiveIndex, activeListRef.current, updateSubmitIndex, hasActiveSubmitValue];
}