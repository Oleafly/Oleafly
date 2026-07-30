"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectPositioner = void 0;
var React = _interopRequireWildcard(require("react"));
var _inertValue = require("@base-ui/utils/inertValue");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _store = require("@base-ui/utils/store");
var _SelectRootContext = require("../root/SelectRootContext");
var _CompositeList = require("../../internals/composite/list/CompositeList");
var _useAnchorPositioning = require("../../utils/useAnchorPositioning");
var _SelectPositionerContext = require("./SelectPositionerContext");
var _InternalBackdrop = require("../../utils/InternalBackdrop");
var _constants = require("../../internals/constants");
var _utils = require("../popup/utils");
var _store2 = require("../store");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _itemEquality = require("../../internals/itemEquality");
var _usePositioner = require("../../utils/usePositioner");
var _useAnchoredPopupScrollLock = require("../../utils/useAnchoredPopupScrollLock");
var _jsxRuntime = require("react/jsx-runtime");
const FIXED = {
  position: 'fixed'
};

/**
 * Positions the select popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
const SelectPositioner = exports.SelectPositioner = /*#__PURE__*/React.forwardRef(function SelectPositioner(componentProps, forwardedRef) {
  const {
    anchor,
    positionMethod = 'absolute',
    className,
    render,
    side = 'bottom',
    align = 'center',
    sideOffset = 0,
    alignOffset = 0,
    collisionBoundary = 'clipping-ancestors',
    collisionPadding,
    arrowPadding = 5,
    sticky = false,
    disableAnchorTracking,
    alignItemWithTrigger = true,
    collisionAvoidance = _constants.DROPDOWN_COLLISION_AVOIDANCE,
    style,
    ...elementProps
  } = componentProps;
  const {
    store,
    listRef,
    labelsRef,
    alignItemWithTriggerActiveRef,
    selectedItemTextRef,
    valuesRef,
    initialValueRef,
    popupRef,
    setValue
  } = (0, _SelectRootContext.useSelectRootContext)();
  const floatingRootContext = (0, _SelectRootContext.useSelectFloatingContext)();
  const open = (0, _store.useStore)(store, _store2.selectors.open);
  const mounted = (0, _store.useStore)(store, _store2.selectors.mounted);
  const modal = (0, _store.useStore)(store, _store2.selectors.modal);
  const value = (0, _store.useStore)(store, _store2.selectors.value);
  const openMethod = (0, _store.useStore)(store, _store2.selectors.openMethod);
  const positionerElement = (0, _store.useStore)(store, _store2.selectors.positionerElement);
  const triggerElement = (0, _store.useStore)(store, _store2.selectors.triggerElement);
  const isItemEqualToValue = (0, _store.useStore)(store, _store2.selectors.isItemEqualToValue);
  const transitionStatus = (0, _store.useStore)(store, _store2.selectors.transitionStatus);
  const scrollUpArrowRef = React.useRef(null);
  const scrollDownArrowRef = React.useRef(null);
  const [controlledAlignItemWithTrigger, setControlledAlignItemWithTrigger] = React.useState(alignItemWithTrigger);
  const alignItemWithTriggerActive = mounted && controlledAlignItemWithTrigger && openMethod !== 'touch';
  if (!mounted && controlledAlignItemWithTrigger !== alignItemWithTrigger) {
    setControlledAlignItemWithTrigger(alignItemWithTrigger);
  }
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!mounted) {
      if (_store2.selectors.scrollUpArrowVisible(store.state)) {
        store.set('scrollUpArrowVisible', false);
      }
      if (_store2.selectors.scrollDownArrowVisible(store.state)) {
        store.set('scrollDownArrowVisible', false);
      }
    }
  }, [store, mounted]);
  React.useImperativeHandle(alignItemWithTriggerActiveRef, () => alignItemWithTriggerActive);
  (0, _useAnchoredPopupScrollLock.useAnchoredPopupScrollLock)((alignItemWithTriggerActive || modal) && open, openMethod === 'touch', positionerElement, triggerElement);
  const positioning = (0, _useAnchorPositioning.useAnchorPositioning)({
    anchor,
    floatingRootContext,
    positionMethod,
    mounted,
    side,
    sideOffset,
    align,
    alignOffset,
    arrowPadding,
    collisionBoundary,
    collisionPadding,
    sticky,
    disableAnchorTracking: disableAnchorTracking ?? alignItemWithTriggerActive,
    collisionAvoidance,
    keepMounted: true
  });
  const renderedSide = alignItemWithTriggerActive ? 'none' : positioning.side;
  const positionerStyles = alignItemWithTriggerActive ? FIXED : positioning.positionerStyles;
  const state = {
    open,
    side: renderedSide,
    align: positioning.align,
    anchorHidden: positioning.anchorHidden
  };
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    store.set('popupSide', positioning.side);
  }, [store, positioning.side]);
  const setPositionerElement = (0, _useStableCallback.useStableCallback)(element => {
    store.set('positionerElement', element);
  });
  const element = (0, _usePositioner.usePositioner)(componentProps, state, {
    styles: positionerStyles,
    transitionStatus,
    props: elementProps,
    refs: [forwardedRef, setPositionerElement],
    hidden: !mounted,
    inert: !open
  });
  const prevMapSizeRef = React.useRef(0);
  const onMapChange = (0, _useStableCallback.useStableCallback)(map => {
    if (map.size === 0 && prevMapSizeRef.current === 0) {
      return;
    }
    if (valuesRef.current.length === 0) {
      return;
    }
    const prevSize = prevMapSizeRef.current;
    prevMapSizeRef.current = map.size;
    if (map.size === prevSize) {
      return;
    }
    const eventDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none);
    if (prevSize !== 0 && !store.state.multiple && value !== null) {
      const selectedValueIndex = (0, _itemEquality.findItemIndex)(valuesRef.current, value, isItemEqualToValue);
      if (selectedValueIndex === -1) {
        const initialSelectedValue = initialValueRef.current;
        const hasInitial = initialSelectedValue != null && (0, _itemEquality.findItemIndex)(valuesRef.current, initialSelectedValue, isItemEqualToValue) !== -1;
        const nextValue = hasInitial ? initialSelectedValue : null;
        setValue(nextValue, eventDetails);
        if (nextValue === null) {
          store.set('selectedIndex', null);
          selectedItemTextRef.current = null;
        }
      }
    }
    if (prevSize !== 0 && store.state.multiple && Array.isArray(value)) {
      const hasVisibleItem = selectedItemValue => (0, _itemEquality.findItemIndex)(valuesRef.current, selectedItemValue, isItemEqualToValue) !== -1;
      const nextValue = value.filter(selectedItemValue => hasVisibleItem(selectedItemValue));
      if (nextValue.length !== value.length || nextValue.some(selectedItemValue => !(0, _itemEquality.selectedValueIncludes)(value, selectedItemValue, isItemEqualToValue))) {
        setValue(nextValue, eventDetails);
        if (nextValue.length === 0) {
          store.set('selectedIndex', null);
          selectedItemTextRef.current = null;
        }
      }
    }
    if (open && alignItemWithTriggerActive) {
      store.update({
        scrollUpArrowVisible: false,
        scrollDownArrowVisible: false
      });
      const stylesToClear = {
        height: ''
      };
      (0, _utils.clearStyles)(positionerElement, stylesToClear);
      (0, _utils.clearStyles)(popupRef.current, stylesToClear);
    }
  });
  const contextValue = React.useMemo(() => ({
    ...positioning,
    side: renderedSide,
    alignItemWithTriggerActive,
    setControlledAlignItemWithTrigger,
    scrollUpArrowRef,
    scrollDownArrowRef
  }), [positioning, renderedSide, alignItemWithTriggerActive, setControlledAlignItemWithTrigger]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_CompositeList.CompositeList, {
    elementsRef: listRef,
    labelsRef: labelsRef,
    onMapChange: onMapChange,
    children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_SelectPositionerContext.SelectPositionerContext.Provider, {
      value: contextValue,
      children: [mounted && modal && /*#__PURE__*/(0, _jsxRuntime.jsx)(_InternalBackdrop.InternalBackdrop, {
        inert: (0, _inertValue.inertValue)(!open),
        cutout: triggerElement
      }), element]
    })
  });
});
if (process.env.NODE_ENV !== "production") SelectPositioner.displayName = "SelectPositioner";