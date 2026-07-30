'use client';

import * as React from 'react';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useStore } from '@base-ui/utils/store';
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useComboboxDerivedItemsContext, useComboboxRootContext } from "../root/ComboboxRootContext.mjs";
import { selectors } from "../store.mjs";
import { triggerStateAttributesMapping } from "../utils/stateAttributesMapping.mjs";
import { handleInputPress } from "../utils/handleInputPress.mjs";
import { contains } from "../../floating-ui-react/utils/element.mjs";

/**
 * A wrapper for the input and its associated controls.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
export const ComboboxInputGroup = /*#__PURE__*/React.forwardRef(function ComboboxInputGroup(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    state: fieldState
  } = useFieldRootContext();
  const store = useComboboxRootContext();
  const {
    filteredItems
  } = useComboboxDerivedItemsContext();
  const open = useStore(store, selectors.open);
  const mounted = useStore(store, selectors.mounted);
  const popupSideValue = useStore(store, selectors.popupSide);
  const positionerElement = useStore(store, selectors.positionerElement);
  const comboboxDisabled = useStore(store, selectors.disabled);
  const readOnly = useStore(store, selectors.readOnly);
  const hasSelectedValue = useStore(store, selectors.hasSelectedValue);
  const selectionMode = useStore(store, selectors.selectionMode);
  const popupSide = mounted && positionerElement ? popupSideValue : null;
  const disabled = comboboxDisabled;
  const listEmpty = filteredItems.length === 0;
  const placeholder = selectionMode === 'none' ? false : !hasSelectedValue;
  const state = {
    ...fieldState,
    open,
    disabled,
    readOnly,
    popupSide,
    listEmpty,
    placeholder
  };
  const setInputGroupElement = useStableCallback(element => {
    store.set('inputGroupElement', element);
  });
  return useRenderElement('div', componentProps, {
    ref: [forwardedRef, setInputGroupElement],
    props: [{
      role: 'group',
      onMouseDown(event) {
        handleInputPress(event, store, disabled, readOnly, target => {
          return contains(store.state.chipsContainerRef.current, target);
        });
      }
    }, elementProps],
    state,
    stateAttributesMapping: triggerStateAttributesMapping
  });
});
if (process.env.NODE_ENV !== "production") ComboboxInputGroup.displayName = "ComboboxInputGroup";