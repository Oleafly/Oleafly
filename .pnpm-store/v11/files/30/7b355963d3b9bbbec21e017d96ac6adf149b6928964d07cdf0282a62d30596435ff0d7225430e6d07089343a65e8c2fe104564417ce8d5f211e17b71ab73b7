'use client';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useFloatingPortalNode } from "../floating-ui-react/index.mjs";

/**
 * `FloatingPortal` includes tabbable logic handling for focus management.
 * For components that don't need tabbable logic, use `FloatingPortalLite`.
 * @internal
 */
import { jsxs as _jsxs } from "react/jsx-runtime";
export const FloatingPortalLite = /*#__PURE__*/React.forwardRef(function FloatingPortalLite(componentProps, forwardedRef) {
  const {
    children,
    container,
    className,
    render,
    style,
    ...elementProps
  } = componentProps;
  const {
    portalNode,
    portalSubtree
  } = useFloatingPortalNode({
    container,
    ref: forwardedRef,
    componentProps,
    elementProps
  });
  if (!portalSubtree && !portalNode) {
    return null;
  }
  return /*#__PURE__*/_jsxs(React.Fragment, {
    children: [portalSubtree, portalNode && /*#__PURE__*/ReactDOM.createPortal(children, portalNode)]
  });
});
if (process.env.NODE_ENV !== "production") FloatingPortalLite.displayName = "FloatingPortalLite";