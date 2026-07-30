'use client';

import * as React from 'react';
import { isElementDisabled } from '@base-ui/utils/isElementDisabled';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useMergedRefs } from '@base-ui/utils/useMergedRefs';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { COMPOSITE_KEYS, ARROW_DOWN, ARROW_KEYS, ARROW_LEFT, ARROW_RIGHT, ARROW_UP, END, HOME, HORIZONTAL_KEYS, HORIZONTAL_KEYS_WITH_EXTRA_KEYS, MODIFIER_KEYS, VERTICAL_KEYS, VERTICAL_KEYS_WITH_EXTRA_KEYS, findNonDisabledListIndex, getMaxListIndex, getMinListIndex, isListIndexDisabled, isIndexOutOfListBounds, isNativeInput, scrollIntoViewIfNeeded } from "../composite.mjs";
import { ACTIVE_COMPOSITE_ITEM } from "../constants.mjs";
import { getTarget } from "../../../floating-ui-react/utils.mjs";
const EMPTY_ARRAY = [];
export function useCompositeRoot(params) {
  const {
    loopFocus = true,
    orientation = 'both',
    grid,
    onLoop,
    direction,
    highlightedIndex: externalHighlightedIndex,
    onHighlightedIndexChange: externalSetHighlightedIndex,
    rootRef: externalRef,
    enableHomeAndEndKeys = false,
    stopEventPropagation = false,
    disabledIndices,
    modifierKeys = EMPTY_ARRAY
  } = params;
  const [internalHighlightedIndex, internalSetHighlightedIndex] = React.useState(0);
  const isGrid = grid != null;
  const rootRef = React.useRef(null);
  const mergedRef = useMergedRefs(rootRef, externalRef);
  const elementsRef = React.useRef([]);
  const hasSetDefaultIndexRef = React.useRef(false);
  const highlightedIndex = externalHighlightedIndex ?? internalHighlightedIndex;
  const onHighlightedIndexChange = useStableCallback((index, shouldScrollIntoView = false) => {
    (externalSetHighlightedIndex ?? internalSetHighlightedIndex)(index);
    if (shouldScrollIntoView) {
      const newActiveItem = elementsRef.current[index];
      scrollIntoViewIfNeeded(rootRef.current, newActiveItem, direction, orientation);
    }
  });
  const onMapChange = useStableCallback(map => {
    if (map.size === 0 || hasSetDefaultIndexRef.current) {
      return;
    }
    hasSetDefaultIndexRef.current = true;
    const sortedElements = Array.from(map.keys());
    const activeItem = sortedElements.find(compositeElement => compositeElement?.hasAttribute(ACTIVE_COMPOSITE_ITEM)) ?? null;
    // Set the default highlighted index of an arbitrary composite item.
    const activeIndex = activeItem ? sortedElements.indexOf(activeItem) : -1;
    if (activeIndex !== -1) {
      onHighlightedIndexChange(activeIndex);
    } else if (isListIndexDisabled(sortedElements, highlightedIndex, disabledIndices)) {
      // The default highlighted item is disabled, so it should not hold the single
      // roving tab stop: a natively disabled element is removed from the tab order,
      // and an aria-disabled one should not be the entry point. Move the tab stop
      // to the first enabled item. If every item is disabled, keep the current
      // highlighted index.
      const firstEnabledIndex = findNonDisabledListIndex(sortedElements, {
        disabledIndices
      });
      if (!isIndexOutOfListBounds(sortedElements, firstEnabledIndex)) {
        onHighlightedIndexChange(firstEnabledIndex);
      }
    }
    scrollIntoViewIfNeeded(rootRef.current, activeItem, direction, orientation);
  });
  useIsoLayoutEffect(() => {
    // `disabledIndices` can resolve a render after the initial map population
    // (e.g. Toolbar derives it from item metadata through a state update), so the
    // default tab stop at index 0 may now point at a disabled item, leaving the
    // composite without a reachable tab stop. Re-validate and move it to the first
    // enabled item. Gated on `disabledIndices` being provided so composites that
    // rely on the DOM disabled fallback keep their existing behavior.
    if (disabledIndices == null || externalHighlightedIndex != null || !hasSetDefaultIndexRef.current) {
      return;
    }
    const elements = elementsRef.current;
    if (isListIndexDisabled(elements, highlightedIndex, disabledIndices)) {
      const firstEnabledIndex = findNonDisabledListIndex(elements, {
        disabledIndices
      });
      if (!isIndexOutOfListBounds(elements, firstEnabledIndex)) {
        onHighlightedIndexChange(firstEnabledIndex);
      }
    }
  }, [disabledIndices, externalHighlightedIndex, highlightedIndex, elementsRef, onHighlightedIndexChange]);
  const wrappedOnLoop = useStableCallback((event, prevIndex, nextIndex) => {
    if (!onLoop) {
      return nextIndex;
    }
    return onLoop(event, prevIndex, nextIndex, elementsRef);
  });

  // Stable so that `relayKeyboardEvent` does not invalidate identity-sensitive
  // consumers (the `CompositeRootContext` value and trigger data forwarding).
  const onKeyDown = useStableCallback(event => {
    const RELEVANT_KEYS = enableHomeAndEndKeys ? COMPOSITE_KEYS : ARROW_KEYS;
    if (!RELEVANT_KEYS.has(event.key)) {
      return;
    }
    if (isModifierKeySet(event, modifierKeys)) {
      return;
    }
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const isRtl = direction === 'rtl';
    const horizontalForwardKey = isRtl ? ARROW_LEFT : ARROW_RIGHT;
    const forwardKey = {
      horizontal: horizontalForwardKey,
      vertical: ARROW_DOWN,
      both: horizontalForwardKey
    }[orientation];
    const horizontalBackwardKey = isRtl ? ARROW_RIGHT : ARROW_LEFT;
    const backwardKey = {
      horizontal: horizontalBackwardKey,
      vertical: ARROW_UP,
      both: horizontalBackwardKey
    }[orientation];
    const target = getTarget(event.nativeEvent);
    if (target != null && isNativeInput(target) && !isElementDisabled(target)) {
      const selectionStart = target.selectionStart;
      const selectionEnd = target.selectionEnd;
      const textContent = target.value ?? '';
      // return to native textbox behavior when
      // 1 - Shift is held to make a text selection, or if there already is a text selection
      if (selectionStart == null || event.shiftKey || selectionStart !== selectionEnd) {
        return;
      }
      // 2 - arrow-ing forward and not in the last position of the text
      if (event.key !== backwardKey && selectionStart < textContent.length) {
        return;
      }
      // 3 -arrow-ing backward and not in the first position of the text
      if (event.key !== forwardKey && selectionStart > 0) {
        return;
      }
    }
    let nextIndex = highlightedIndex;
    const minIndex = getMinListIndex(elementsRef, disabledIndices);
    const maxIndex = getMaxListIndex(elementsRef, disabledIndices);
    if (grid != null) {
      nextIndex = grid({
        disabledIndices,
        elementsRef,
        event,
        highlightedIndex,
        loopFocus,
        maxIndex,
        minIndex,
        onLoop: wrappedOnLoop,
        orientation,
        rtl: isRtl
      });
    }
    const forwardKeys = {
      horizontal: [horizontalForwardKey],
      vertical: [ARROW_DOWN],
      both: [horizontalForwardKey, ARROW_DOWN]
    }[orientation];
    const backwardKeys = {
      horizontal: [horizontalBackwardKey],
      vertical: [ARROW_UP],
      both: [horizontalBackwardKey, ARROW_UP]
    }[orientation];
    const preventedKeys = isGrid ? RELEVANT_KEYS : {
      horizontal: enableHomeAndEndKeys ? HORIZONTAL_KEYS_WITH_EXTRA_KEYS : HORIZONTAL_KEYS,
      vertical: enableHomeAndEndKeys ? VERTICAL_KEYS_WITH_EXTRA_KEYS : VERTICAL_KEYS,
      both: RELEVANT_KEYS
    }[orientation];
    if (enableHomeAndEndKeys) {
      if (event.key === HOME) {
        nextIndex = minIndex;
      } else if (event.key === END) {
        nextIndex = maxIndex;
      }
    }
    if (nextIndex === highlightedIndex && (forwardKeys.includes(event.key) || backwardKeys.includes(event.key))) {
      if (loopFocus && nextIndex === maxIndex && forwardKeys.includes(event.key)) {
        nextIndex = minIndex;
        if (onLoop) {
          nextIndex = onLoop(event, highlightedIndex, nextIndex, elementsRef);
        }
      } else if (loopFocus && nextIndex === minIndex && backwardKeys.includes(event.key)) {
        nextIndex = maxIndex;
        if (onLoop) {
          nextIndex = onLoop(event, highlightedIndex, nextIndex, elementsRef);
        }
      } else {
        nextIndex = findNonDisabledListIndex(elementsRef.current, {
          startingIndex: nextIndex,
          decrement: backwardKeys.includes(event.key),
          disabledIndices
        });
      }
    }
    if (nextIndex !== highlightedIndex && !isIndexOutOfListBounds(elementsRef.current, nextIndex)) {
      if (stopEventPropagation) {
        event.stopPropagation();
      }
      if (preventedKeys.has(event.key)) {
        event.preventDefault();
      }
      onHighlightedIndexChange(nextIndex, true);

      // Wait for FocusManager `returnFocus` to execute.
      queueMicrotask(() => {
        elementsRef.current[nextIndex]?.focus();
      });
    }
  });
  const props = {
    ref: mergedRef,
    onFocus(event) {
      const element = rootRef.current;
      const target = getTarget(event.nativeEvent);
      if (!element || target == null || !isNativeInput(target)) {
        return;
      }
      target.setSelectionRange(0, target.value.length ?? 0);
    },
    onKeyDown
  };
  return {
    props,
    highlightedIndex,
    onHighlightedIndexChange,
    elementsRef,
    disabledIndices,
    onMapChange,
    relayKeyboardEvent: onKeyDown
  };
}
function isModifierKeySet(event, ignoredModifierKeys) {
  for (const key of MODIFIER_KEYS.values()) {
    if (ignoredModifierKeys.includes(key)) {
      continue;
    }
    if (event.getModifierState(key)) {
      return true;
    }
  }
  return false;
}