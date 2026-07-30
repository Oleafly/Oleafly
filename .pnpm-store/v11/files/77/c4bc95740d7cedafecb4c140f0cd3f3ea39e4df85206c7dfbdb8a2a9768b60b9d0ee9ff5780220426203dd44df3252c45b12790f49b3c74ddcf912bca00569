"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectPortal = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _floatingUiReact = require("../../floating-ui-react");
var _SelectPortalContext = require("./SelectPortalContext");
var _SelectRootContext = require("../root/SelectRootContext");
var _store2 = require("../store");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * A portal element that moves the popup to a different part of the DOM.
 * By default, the portal element is appended to `<body>`.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
const SelectPortal = exports.SelectPortal = /*#__PURE__*/React.forwardRef(function SelectPortal(portalProps, forwardedRef) {
  const {
    store
  } = (0, _SelectRootContext.useSelectRootContext)();
  const mounted = (0, _store.useStore)(store, _store2.selectors.mounted);
  const forceMount = (0, _store.useStore)(store, _store2.selectors.forceMount);
  const shouldRender = mounted || forceMount;
  if (!shouldRender) {
    return null;
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_SelectPortalContext.SelectPortalContext.Provider, {
    value: true,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_floatingUiReact.FloatingPortal, {
      ref: forwardedRef,
      ...portalProps
    })
  });
});
if (process.env.NODE_ENV !== "production") SelectPortal.displayName = "SelectPortal";