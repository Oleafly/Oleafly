'use client';

import * as React from 'react';
import { useStore } from '@base-ui/utils/store';
import { FloatingPortal } from "../../floating-ui-react/index.mjs";
import { SelectPortalContext } from "./SelectPortalContext.mjs";
import { useSelectRootContext } from "../root/SelectRootContext.mjs";
import { selectors } from "../store.mjs";

/**
 * A portal element that moves the popup to a different part of the DOM.
 * By default, the portal element is appended to `<body>`.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
import { jsx as _jsx } from "react/jsx-runtime";
export const SelectPortal = /*#__PURE__*/React.forwardRef(function SelectPortal(portalProps, forwardedRef) {
  const {
    store
  } = useSelectRootContext();
  const mounted = useStore(store, selectors.mounted);
  const forceMount = useStore(store, selectors.forceMount);
  const shouldRender = mounted || forceMount;
  if (!shouldRender) {
    return null;
  }
  return /*#__PURE__*/_jsx(SelectPortalContext.Provider, {
    value: true,
    children: /*#__PURE__*/_jsx(FloatingPortal, {
      ref: forwardedRef,
      ...portalProps
    })
  });
});
if (process.env.NODE_ENV !== "production") SelectPortal.displayName = "SelectPortal";