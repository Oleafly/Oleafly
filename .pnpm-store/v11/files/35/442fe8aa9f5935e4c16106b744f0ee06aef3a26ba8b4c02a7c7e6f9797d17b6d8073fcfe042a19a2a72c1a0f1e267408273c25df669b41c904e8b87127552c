"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DrawerBackdrop = void 0;
var React = _interopRequireWildcard(require("react"));
var _DialogRootContext = require("../../dialog/root/DialogRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _DrawerPopupCssVars = require("../popup/DrawerPopupCssVars");
var _DrawerBackdropCssVars = require("./DrawerBackdropCssVars");
const stateAttributesMapping = {
  ..._popupStateMapping.popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * An overlay displayed beneath the popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Drawer](https://base-ui.com/react/components/drawer)
 */
const DrawerBackdrop = exports.DrawerBackdrop = /*#__PURE__*/React.forwardRef(function DrawerBackdrop(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    forceRender = false,
    ...elementProps
  } = componentProps;
  const {
    store
  } = (0, _DialogRootContext.useDialogRootContext)();
  const open = store.useState('open');
  const nested = store.useState('nested');
  const mounted = store.useState('mounted');
  const transitionStatus = store.useState('transitionStatus');
  const state = {
    open,
    transitionStatus
  };
  return (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [store.context.backdropRef, forwardedRef],
    stateAttributesMapping,
    props: [{
      role: 'presentation',
      hidden: !mounted,
      style: {
        pointerEvents: !open ? 'none' : undefined,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        [_DrawerBackdropCssVars.DrawerBackdropCssVars.swipeProgress]: '0',
        [_DrawerPopupCssVars.DrawerPopupCssVars.swipeStrength]: '1'
      }
    }, elementProps],
    enabled: forceRender || !nested
  });
});
if (process.env.NODE_ENV !== "production") DrawerBackdrop.displayName = "DrawerBackdrop";