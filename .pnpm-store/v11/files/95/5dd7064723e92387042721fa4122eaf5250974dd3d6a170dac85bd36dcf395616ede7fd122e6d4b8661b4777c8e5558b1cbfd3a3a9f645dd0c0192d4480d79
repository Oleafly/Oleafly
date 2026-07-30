"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectItem = void 0;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _store = require("@base-ui/utils/store");
var _SelectRootContext = require("../root/SelectRootContext");
var _useCompositeListItem = require("../../internals/composite/list/useCompositeListItem");
var _useRenderElement = require("../../internals/useRenderElement");
var _SelectItemContext = require("./SelectItemContext");
var _store2 = require("../store");
var _useButton = require("../../internals/use-button");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _itemEquality = require("../../internals/itemEquality");
var _event = require("../../floating-ui-react/utils/event");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * An individual option in the select popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
const SelectItem = exports.SelectItem = /*#__PURE__*/React.memo(/*#__PURE__*/React.forwardRef(function SelectItem(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    value: itemValue = null,
    label,
    disabled = false,
    nativeButton = false,
    ...elementProps
  } = componentProps;
  const textRef = React.useRef(null);
  const listItem = (0, _useCompositeListItem.useCompositeListItem)({
    label,
    textRef,
    indexGuessBehavior: _useCompositeListItem.IndexGuessBehavior.GuessFromOrder
  });
  const {
    store,
    itemProps,
    setOpen,
    setValue,
    selectionRef,
    typingRef,
    valuesRef,
    multiple,
    selectedItemTextRef,
    disabled: selectDisabled,
    readOnly
  } = (0, _SelectRootContext.useSelectRootContext)();
  const highlighted = (0, _store.useStore)(store, _store2.selectors.isActive, listItem.index);
  const open = (0, _store.useStore)(store, _store2.selectors.open);
  const selected = (0, _store.useStore)(store, _store2.selectors.isSelected, itemValue);
  const selectedByFocus = (0, _store.useStore)(store, _store2.selectors.isSelectedByFocus, listItem.index);
  const isItemEqualToValue = (0, _store.useStore)(store, _store2.selectors.isItemEqualToValue);
  const index = listItem.index;
  const hasRegistered = index !== -1;
  const itemRef = React.useRef(null);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!hasRegistered) {
      return undefined;
    }
    const values = valuesRef.current;
    values[index] = itemValue;
    return () => {
      delete values[index];
    };
  }, [hasRegistered, index, itemValue, valuesRef]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!hasRegistered) {
      return;
    }
    const selectedValue = store.state.value;
    let selectedCandidate = selectedValue;
    if (multiple && Array.isArray(selectedValue)) {
      // Compare against the last selected item, or `undefined` when nothing is selected — never
      // the raw array, which a custom `isItemEqualToValue` isn't expected to receive.
      selectedCandidate = selectedValue.length > 0 ? selectedValue[selectedValue.length - 1] : undefined;
    }
    if (selectedCandidate !== undefined && (0, _itemEquality.compareItemEquality)(itemValue, selectedCandidate, isItemEqualToValue)) {
      store.set('selectedIndex', index);
      // Make sure SelectPopup can measure the selected item on first open.
      // SelectItemText can still update this ref later when focus moves.
      if (textRef.current) {
        selectedItemTextRef.current = textRef.current;
      }
    }
  }, [hasRegistered, index, multiple, isItemEqualToValue, store, itemValue, selectedItemTextRef]);
  const lastKeyRef = React.useRef(null);
  const pointerTypeRef = React.useRef('mouse');
  const allowMouseSelectionRef = React.useRef(false);
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
  function commitSelection(event) {
    // A forced-open select (`open`/`defaultOpen`) can still receive item activations even
    // when the root is disabled or read-only, so guard the commit here too.
    if (selectDisabled || readOnly) {
      return;
    }
    const selectedValue = store.state.value;
    if (multiple) {
      const currentValue = Array.isArray(selectedValue) ? selectedValue : [];
      const nextValue = selected ? (0, _itemEquality.removeItem)(currentValue, itemValue, isItemEqualToValue) : [...currentValue, itemValue];
      setValue(nextValue, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.itemPress, event));
    } else {
      setValue(itemValue, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.itemPress, event));
      setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.itemPress, event));
    }
  }
  function resetDragMovement() {
    selectionRef.current.dragY = 0;
  }
  const defaultProps = {
    role: 'option',
    'aria-selected': selected,
    tabIndex: open && highlighted ? 0 : -1,
    onKeyDown(event) {
      lastKeyRef.current = event.key;
      store.set('activeIndex', index);
      if (event.key === ' ' && typingRef.current) {
        event.preventDefault();
      }
    },
    onClick(event) {
      const isMouseClick = event.type === 'click' && pointerTypeRef.current !== 'touch';
      const clickPointerType = event.nativeEvent.pointerType;
      const isVirtualMouseClick = isMouseClick && (0, _event.isVirtualClick)(event.nativeEvent) && (
      // Generic no-pointer `detail === 0` clicks stay tied to highlight state. Virtual
      // clicks that carry browser pointer data, including an empty string from assistive
      // technology, can activate unhighlighted items.
      clickPointerType !== undefined || highlighted);
      // With alignItemWithTrigger, opening can place an item under the cursor. Real mouse
      // clicks must start on the item, while virtual clicks represent explicit keyboard or
      // assistive technology activation.
      const isInvalidMouseClick = isMouseClick && !isVirtualMouseClick && !allowMouseSelectionRef.current;
      allowMouseSelectionRef.current = false;

      // Prevent double commit on {Enter}
      if (event.type === 'keydown' && lastKeyRef.current === null) {
        return;
      }
      if (disabled || event.type === 'keydown' && lastKeyRef.current === ' ' && typingRef.current || isInvalidMouseClick) {
        return;
      }
      lastKeyRef.current = null;
      commitSelection(event.nativeEvent);
    },
    onPointerEnter(event) {
      pointerTypeRef.current = event.pointerType;
    },
    onPointerMove(event) {
      if (event.pointerType === 'mouse' && event.buttons === 1) {
        const selection = selectionRef.current;
        selection.dragY += event.movementY;
        if (selection.dragY ** 2 >= 64) {
          selection.allowUnselectedMouseUp = true;
        }
      }
    },
    onPointerDown(event) {
      pointerTypeRef.current = event.pointerType;
      allowMouseSelectionRef.current = true;
      resetDragMovement();
    },
    onMouseUp() {
      resetDragMovement();
      if (disabled || pointerTypeRef.current === 'touch') {
        return;
      }

      // Regular clicks are committed by the click event.
      if (allowMouseSelectionRef.current) {
        return;
      }
      const disallowSelectedMouseUp = !selectionRef.current.allowSelectedMouseUp && selected;
      const disallowUnselectedMouseUp = !selectionRef.current.allowUnselectedMouseUp && !selected;
      if (disallowSelectedMouseUp || disallowUnselectedMouseUp) {
        return;
      }
      allowMouseSelectionRef.current = true;
      itemRef.current?.click();
      allowMouseSelectionRef.current = false;
    }
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [buttonRef, forwardedRef, listItem.ref, itemRef],
    state,
    props: [itemProps, defaultProps, elementProps, getButtonProps]
  });
  const contextValue = React.useMemo(() => ({
    selected,
    index,
    textRef,
    selectedByFocus,
    hasRegistered
  }), [selected, index, textRef, selectedByFocus, hasRegistered]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_SelectItemContext.SelectItemContext.Provider, {
    value: contextValue,
    children: element
  });
}));
if (process.env.NODE_ENV !== "production") SelectItem.displayName = "SelectItem";