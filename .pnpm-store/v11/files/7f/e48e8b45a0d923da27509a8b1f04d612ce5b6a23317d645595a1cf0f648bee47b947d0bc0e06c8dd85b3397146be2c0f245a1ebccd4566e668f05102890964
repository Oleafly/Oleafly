'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const SelectPortalContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") SelectPortalContext.displayName = "SelectPortalContext";
export function useSelectPortalContext() {
  const value = React.useContext(SelectPortalContext);
  if (value === undefined) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: <Select.Portal> is missing.' : _formatErrorMessage(58));
  }
  return value;
}