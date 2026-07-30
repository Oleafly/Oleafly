"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MenuPortal = void 0;
var React = _interopRequireWildcard(require("react"));
var _floatingUiReact = require("../../floating-ui-react");
var _MenuRootContext = require("../root/MenuRootContext");
var _MenuPortalContext = require("./MenuPortalContext");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * A portal element that moves the popup to a different part of the DOM.
 * By default, the portal element is appended to `<body>`.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Menu](https://base-ui.com/react/components/menu)
 */
const MenuPortal = exports.MenuPortal = /*#__PURE__*/React.forwardRef(function MenuPortal(props, forwardedRef) {
  const {
    keepMounted = false,
    ...portalProps
  } = props;
  const {
    store
  } = (0, _MenuRootContext.useMenuRootContext)();
  const mounted = store.useState('mounted');
  const shouldRender = mounted || keepMounted;
  if (!shouldRender) {
    return null;
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_MenuPortalContext.MenuPortalContext.Provider, {
    value: keepMounted,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_floatingUiReact.FloatingPortal, {
      ref: forwardedRef,
      ...portalProps
    })
  });
});
if (process.env.NODE_ENV !== "production") MenuPortal.displayName = "MenuPortal";