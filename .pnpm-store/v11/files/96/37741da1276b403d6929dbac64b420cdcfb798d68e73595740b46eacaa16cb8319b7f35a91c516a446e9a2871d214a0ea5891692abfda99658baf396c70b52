'use client';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useStore } from '@base-ui/utils/store';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useComboboxRootContext, useComboboxHasItemsContext, useComboboxDerivedItemsContext } from "../root/ComboboxRootContext.mjs";
import { useCompositeListItem, IndexGuessBehavior } from "../../internals/composite/list/useCompositeListItem.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { ComboboxItemContext } from "./ComboboxItemContext.mjs";
import { selectors } from "../store.mjs";
import { useButton } from "../../internals/use-button/index.mjs";
import { useComboboxRowContext } from "../row/ComboboxRowContext.mjs";
import { compareItemEquality, findItemIndex } from "../../internals/itemEquality.mjs";
import { jsx as _jsx } from "react/jsx-runtime";
function ComboboxItemInner(props) {
  const {
    componentProps,
    forwardedRef,
    virtualized,
    indexFromFilter
  } = props;
  const {
    render,
    className,
    style,
    value: itemValue = null,
    index: indexProp,
    disabled = false,
    nativeButton = false,
    ...elementProps
  } = componentProps;
  const didPointerDownRef = React.useRef(false);
  const textRef = React.useRef(null);
  const listItem = useCompositeListItem({
    index: indexProp,
    textRef,
    indexGuessBehavior: IndexGuessBehavior.GuessFromOrder
  });
  const store = useComboboxRootContext();
  const isRow = useComboboxRowContext();
  const hasItems = useComboboxHasItemsContext();
  const open = useStore(store, selectors.open);
  const selectionMode = useStore(store, selectors.selectionMode);
  const readOnly = useStore(store, selectors.readOnly);
  const isItemEqualToValue = useStore(store, selectors.isItemEqualToValue);
  const selectable = selectionMode !== 'none';
  const index = indexProp ?? (virtualized ? indexFromFilter ?? -1 : listItem.index);
  const hasRegistered = listItem.index !== -1;
  const rootId = useStore(store, selectors.id);
  const highlighted = useStore(store, selectors.isActive, index);
  const matchesSelectedValue = useStore(store, selectors.isSelected, itemValue);
  const itemProps = useStore(store, selectors.itemProps);
  const itemRef = React.useRef(null);
  const id = rootId != null && hasRegistered ? `${rootId}-${index}` : undefined;
  const selected = matchesSelectedValue && selectable;
  useIsoLayoutEffect(() => {
    const shouldRun = hasRegistered && (virtualized || indexProp != null);
    if (!shouldRun) {
      return undefined;
    }
    const list = store.state.listRef.current;
    list[index] = itemRef.current;
    return () => {
      delete list[index];
    };
  }, [hasRegistered, virtualized, index, indexProp, store]);
  useIsoLayoutEffect(() => {
    if (!hasRegistered || hasItems) {
      return undefined;
    }
    const visibleMap = store.state.valuesRef.current;
    visibleMap[index] = itemValue;

    // Stable registry that doesn't depend on filtering. Assume that no
    // filtering had occurred at this point; otherwise, an `items` prop is
    // required.
    if (selectionMode !== 'none') {
      store.state.allValuesRef.current.push(itemValue);
    }
    return () => {
      delete visibleMap[index];
    };
  }, [hasRegistered, hasItems, index, itemValue, store, selectionMode]);
  useIsoLayoutEffect(() => {
    if (!open) {
      didPointerDownRef.current = false;
      return;
    }
    if (!hasRegistered || hasItems) {
      return;
    }
    const selectedValue = store.state.selectedValue;
    const lastSelectedValue = Array.isArray(selectedValue) ? selectedValue[selectedValue.length - 1] : selectedValue;
    if (compareItemEquality(itemValue, lastSelectedValue, isItemEqualToValue)) {
      store.set('selectedIndex', index);
    }
  }, [hasRegistered, hasItems, open, store, index, itemValue, isItemEqualToValue]);
  const {
    getButtonProps,
    buttonRef
  } = useButton({
    disabled,
    focusableWhenDisabled: true,
    native: nativeButton,
    composite: true
  });
  const state = {
    disabled,
    selected,
    highlighted
  };
  function commitSelection(nativeEvent) {
    function selectItem() {
      store.state.handleSelection(nativeEvent, itemValue);
    }
    if (store.state.submitOnItemClick) {
      ReactDOM.flushSync(selectItem);
      store.state.requestSubmit();
    } else {
      selectItem();
    }
  }
  const defaultProps = {
    id,
    role: isRow ? 'gridcell' : 'option',
    'aria-selected': selectable ? selected : undefined,
    // Focusable items steal focus from the input upon mouseup.
    // Warn if the user renders a natively focusable element like `<button>`,
    // as it should be a `<div>` instead.
    tabIndex: undefined,
    onPointerDownCapture(event) {
      didPointerDownRef.current = true;
      event.preventDefault();
    },
    onMouseDown(event) {
      // iOS Safari can emit a synthetic mousedown for touch taps without a preceding
      // pointerdown. Prevent default here too so tapping an item does not blur the input.
      event.preventDefault();
    },
    onClick(event) {
      if (disabled || readOnly) {
        return;
      }
      commitSelection(event.nativeEvent);
    },
    onMouseUp(event) {
      const pointerStartedOnItem = didPointerDownRef.current;
      didPointerDownRef.current = false;
      if (disabled || readOnly || event.button !== 0 || pointerStartedOnItem || !highlighted) {
        return;
      }
      commitSelection(event.nativeEvent);
    }
  };
  const element = useRenderElement('div', componentProps, {
    ref: [buttonRef, forwardedRef, listItem.ref, itemRef],
    state,
    props: [itemProps, defaultProps, elementProps, getButtonProps]
  });
  const contextValue = React.useMemo(() => ({
    selected,
    textRef
  }), [selected, textRef]);
  return /*#__PURE__*/_jsx(ComboboxItemContext.Provider, {
    value: contextValue,
    children: element
  });
}

/**
 * Resolves the index from the filtered items for the virtualized fallback (no `index` prop).
 * Isolated here so that this per-keystroke subscription to the derived-items context is only
 * paid by virtualized items. Those re-render on every input change anyway — the parent
 * virtualizer re-windows the list as the filtered set changes — so the extra subscription costs
 * them nothing, while it keeps every non-virtualized item off that context.
 */
function ComboboxItemVirtualizedIndex(props) {
  const {
    componentProps,
    forwardedRef
  } = props;
  const store = useComboboxRootContext();
  const isItemEqualToValue = useStore(store, selectors.isItemEqualToValue);
  const {
    flatFilteredItems
  } = useComboboxDerivedItemsContext();
  const indexFromFilter = findItemIndex(flatFilteredItems, componentProps.value ?? null, isItemEqualToValue);

  // Only reached when `virtualized` is true (see the wrapper below).
  return /*#__PURE__*/_jsx(ComboboxItemInner, {
    componentProps: componentProps,
    forwardedRef: forwardedRef,
    virtualized: true,
    indexFromFilter: indexFromFilter
  });
}

/**
 * An individual item in the list.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
export const ComboboxItem = /*#__PURE__*/React.memo(/*#__PURE__*/React.forwardRef(function ComboboxItem(componentProps, forwardedRef) {
  const store = useComboboxRootContext();
  const virtualized = useStore(store, selectors.virtualized);

  // `virtualized` (and whether an item provides an explicit `index`) must be stable for an
  // item's lifetime: the two branches return different component types, so flipping it at
  // runtime remounts the item and resets its refs and effects.
  if (virtualized && componentProps.index == null) {
    return /*#__PURE__*/_jsx(ComboboxItemVirtualizedIndex, {
      componentProps: componentProps,
      forwardedRef: forwardedRef
    });
  }
  return /*#__PURE__*/_jsx(ComboboxItemInner, {
    componentProps: componentProps,
    forwardedRef: forwardedRef,
    virtualized: virtualized,
    indexFromFilter: undefined
  });
}));
if (process.env.NODE_ENV !== "production") ComboboxItem.displayName = "ComboboxItem";