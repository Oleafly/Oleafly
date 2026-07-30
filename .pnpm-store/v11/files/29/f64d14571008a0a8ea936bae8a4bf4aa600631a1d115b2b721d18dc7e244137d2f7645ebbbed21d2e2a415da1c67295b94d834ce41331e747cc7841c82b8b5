'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const SelectRootContext = /*#__PURE__*/React.createContext(null);
if (process.env.NODE_ENV !== "production") SelectRootContext.displayName = "SelectRootContext";
export const SelectFloatingContext = /*#__PURE__*/React.createContext(null);
if (process.env.NODE_ENV !== "production") SelectFloatingContext.displayName = "SelectFloatingContext";
export function useSelectRootContext() {
  const context = React.useContext(SelectRootContext);
  if (context === null) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: SelectRootContext is missing. Select parts must be placed within <Select.Root>.' : _formatErrorMessage(60));
  }
  return context;
}
export function useSelectFloatingContext() {
  const context = React.useContext(SelectFloatingContext);
  if (context === null) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: SelectFloatingContext is missing. Select parts must be placed within <Select.Root>.' : _formatErrorMessage(61));
  }
  return context;
}