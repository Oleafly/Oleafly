"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectArrow = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _SelectPositionerContext = require("../positioner/SelectPositionerContext");
var _SelectRootContext = require("../root/SelectRootContext");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _useRenderElement = require("../../internals/useRenderElement");
var _store2 = require("../store");
const stateAttributesMapping = {
  ..._popupStateMapping.popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * Displays an element positioned against the select popup anchor.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
const SelectArrow = exports.SelectArrow = /*#__PURE__*/React.forwardRef(function SelectArrow(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    store
  } = (0, _SelectRootContext.useSelectRootContext)();
  const {
    side,
    align,
    arrowRef,
    arrowStyles,
    arrowUncentered,
    alignItemWithTriggerActive
  } = (0, _SelectPositionerContext.useSelectPositionerContext)();
  const open = (0, _store.useStore)(store, _store2.selectors.open);
  const state = {
    open,
    side,
    align,
    uncentered: arrowUncentered
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [arrowRef, forwardedRef],
    props: [{
      style: arrowStyles,
      'aria-hidden': true
    }, elementProps],
    stateAttributesMapping
  });
  if (alignItemWithTriggerActive) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") SelectArrow.displayName = "SelectArrow";