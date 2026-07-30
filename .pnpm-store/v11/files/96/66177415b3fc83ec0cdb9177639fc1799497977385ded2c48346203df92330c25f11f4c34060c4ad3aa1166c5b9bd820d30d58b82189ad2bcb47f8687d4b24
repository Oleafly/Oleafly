"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ComboboxItem = void 0;
var React = _interopRequireWildcard(require("react"));
var ReactDOM = _interopRequireWildcard(require("react-dom"));
var _store = require("@base-ui/utils/store");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _ComboboxRootContext = require("../root/ComboboxRootContext");
var _useCompositeListItem = require("../../internals/composite/list/useCompositeListItem");
var _useRenderElement = require("../../internals/useRenderElement");
var _ComboboxItemContext = require("./ComboboxItemContext");
var _store2 = require("../store");
var _useButton = require("../../internals/use-button");
var _ComboboxRowContext = require("../row/ComboboxRowContext");
var _itemEquality = require("../../internals/itemEquality");
var _jsxRuntime = require("react/jsx-runtime");
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
  const listItem = (0, _useCompositeListItem.useCompositeListItem)({
    index: indexProp,
    textRef,
    indexGuessBehavior: _useCompositeListItem.IndexGuessBehavior.GuessFromOrder
  });
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const isRow = (0, _ComboboxRowContext.useComboboxRowContext)();
  const hasItems = (0, _ComboboxRootContext.useComboboxHasItemsContext)();
  const open = (0, _store.useStore)(store, _store2.selectors.open);
  const selectionMode = (0, _store.useStore)(store, _store2.selectors.selectionMode);
  const readOnly = (0, _store.useStore)(store, _store2.selectors.readOnly);
  const isItemEqualToValue = (0, _store.useStore)(store, _store2.selectors.isItemEqualToValue);
  const selectable = selectionMode !== 'none';
  const index = indexProp ?? (virtualized ? indexFromFilter ?? -1 : listItem.index);
  const hasRegistered = listItem.index !== -1;
  const rootId = (0, _store.useStore)(store, _store2.selectors.id);
  const highlighted = (0, _store.useStore)(store, _store2.selectors.isActive, index);
  const matchesSelectedValue = (0, _store.useStore)(store, _store2.selectors.isSelected, itemValue);
  const itemProps = (0, _store.useStore)(store, _store2.selectors.itemProps);
  const itemRef = React.useRef(null);
  const id = rootId != null && hasRegistered ? `${rootId}-${index}` : undefined;
  const selected = matchesSelectedValue && selectable;
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
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
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
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
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!open) {
      didPointerDownRef.current = false;
      return;
    }
    if (!hasRegistered || hasItems) {
      return;
    }
    const selectedValue = store.state.selectedValue;
    const lastSelectedValue = Array.isArray(selectedValue) ? selectedValue[selectedValue.length - 1] : selectedValue;
    if ((0, _itemEquality.compareItemEquality)(itemValue, lastSelectedValue, isItemEqualToValue)) {
      store.set('selectedIndex', index);
    }
  }, [hasRegistered, hasItems, open, store, index, itemValue, isItemEqualToValue]);
  const {
    getButtonProps,
    buttonRef
  } = (0, _useButton.useButton)({
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
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [buttonRef, forwardedRef, listItem.ref, itemRef],
    state,
    props: [itemProps, defaultProps, elementProps, getButtonProps]
  });
  const contextValue = React.useMemo(() => ({
    selected,
    textRef
  }), [selected, textRef]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_ComboboxItemContext.ComboboxItemContext.Provider, {
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
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const isItemEqualToValue = (0, _store.useStore)(store, _store2.selectors.isItemEqualToValue);
  const {
    flatFilteredItems
  } = (0, _ComboboxRootContext.useComboboxDerivedItemsContext)();
  const indexFromFilter = (0, _itemEquality.findItemIndex)(flatFilteredItems, componentProps.value ?? null, isItemEqualToValue);

  // Only reached when `virtualized` is true (see the wrapper below).
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(ComboboxItemInner, {
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
const ComboboxItem = exports.ComboboxItem = /*#__PURE__*/React.memo(/*#__PURE__*/React.forwardRef(function ComboboxItem(componentProps, forwardedRef) {
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const virtualized = (0, _store.useStore)(store, _store2.selectors.virtualized);

  // `virtualized` (and whether an item provides an explicit `index`) must be stable for an
  // item's lifetime: the two branches return different component types, so flipping it at
  // runtime remounts the item and resets its refs and effects.
  if (virtualized && componentProps.index == null) {
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(ComboboxItemVirtualizedIndex, {
      componentProps: componentProps,
      forwardedRef: forwardedRef
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(ComboboxItemInner, {
    componentProps: componentProps,
    forwardedRef: forwardedRef,
    virtualized: virtualized,
    indexFromFilter: undefined
  });
}));
if (process.env.NODE_ENV !== "production") ComboboxItem.displayName = "ComboboxItem";