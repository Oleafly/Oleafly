'use client';

import * as React from 'react';
import { useStore } from '@base-ui/utils/store';
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useComboboxRootContext } from "../root/ComboboxRootContext.mjs";
import { useComboboxChipContext } from "../chip/ComboboxChipContext.mjs";
import { useButton } from "../../internals/use-button/index.mjs";
import { stopEvent } from "../../floating-ui-react/utils.mjs";
import { selectors } from "../store.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { findItemIndex } from "../../internals/itemEquality.mjs";

/**
 * A button to remove a chip.
 * Renders a `<button>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
export const ComboboxChipRemove = /*#__PURE__*/React.forwardRef(function ComboboxChipRemove(componentProps, forwardedRef) {
  const {
    render,
    className,
    disabled: disabledProp = false,
    nativeButton = true,
    style,
    ...elementProps
  } = componentProps;
  const store = useComboboxRootContext();
  const {
    index
  } = useComboboxChipContext();
  const comboboxDisabled = useStore(store, selectors.disabled);
  const readOnly = useStore(store, selectors.readOnly);
  const selectedValue = useStore(store, selectors.selectedValue);
  const isItemEqualToValue = useStore(store, selectors.isItemEqualToValue);
  const disabled = comboboxDisabled || disabledProp;
  const {
    buttonRef,
    getButtonProps
  } = useButton({
    native: nativeButton,
    disabled: disabled || readOnly,
    focusableWhenDisabled: true
  });
  const state = {
    disabled
  };
  function clearActiveIndexForRemovedItem(removedItem) {
    const activeIndex = store.state.activeIndex;
    if (activeIndex == null) {
      return;
    }

    // Try current visible list first; if not found, it's filtered out.
    // No need to clear highlight in that case since it can't equal activeIndex.
    const removedIndex = findItemIndex(store.state.valuesRef.current, removedItem, isItemEqualToValue);
    if (removedIndex !== -1 && activeIndex === removedIndex) {
      store.state.setIndices({
        activeIndex: null,
        type: store.state.keyboardActiveRef.current ? 'keyboard' : 'pointer'
      });
    }
  }
  function removeChip(event) {
    const eventDetails = createChangeEventDetails(REASONS.chipRemovePress, event.nativeEvent);
    const removedItem = selectedValue[index];
    clearActiveIndexForRemovedItem(removedItem);
    store.state.setSelectedValue(selectedValue.filter((_, i) => i !== index), eventDetails);
    store.state.inputRef.current?.focus();
    return eventDetails;
  }
  const element = useRenderElement('button', componentProps, {
    ref: [forwardedRef, buttonRef],
    state,
    props: [{
      tabIndex: -1,
      onMouseDown(event) {
        event.preventDefault();
      },
      onClick(event) {
        if (disabled || readOnly) {
          return;
        }
        const eventDetails = removeChip(event);
        if (!eventDetails.isPropagationAllowed) {
          event.stopPropagation();
        }
      },
      onKeyDown(event) {
        if (disabled || readOnly) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          const eventDetails = removeChip(event);
          if (!eventDetails.isPropagationAllowed) {
            stopEvent(event);
          }
        }
      }
    }, elementProps, getButtonProps]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ComboboxChipRemove.displayName = "ComboboxChipRemove";