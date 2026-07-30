"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NavigationMenuBackdrop = void 0;
var React = _interopRequireWildcard(require("react"));
var _useRenderElement = require("../../internals/useRenderElement");
var _NavigationMenuRootContext = require("../root/NavigationMenuRootContext");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _popupStateMapping = require("../../utils/popupStateMapping");
const stateAttributesMapping = {
  ..._popupStateMapping.popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * A backdrop for the navigation menu popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Navigation Menu](https://base-ui.com/react/components/navigation-menu)
 */
const NavigationMenuBackdrop = exports.NavigationMenuBackdrop = /*#__PURE__*/React.forwardRef(function NavigationMenuBackdrop(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    open,
    mounted,
    transitionStatus
  } = (0, _NavigationMenuRootContext.useNavigationMenuRootContext)();
  const state = {
    open,
    transitionStatus
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      role: 'presentation',
      hidden: !mounted,
      style: {
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }
    }, elementProps],
    stateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") NavigationMenuBackdrop.displayName = "NavigationMenuBackdrop";