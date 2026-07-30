'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const CheckboxGroupContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") CheckboxGroupContext.displayName = "CheckboxGroupContext";
export function useCheckboxGroupContext(optional = true) {
  const context = React.useContext(CheckboxGroupContext);
  if (context === undefined && !optional) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: CheckboxGroupContext is missing. CheckboxGroup parts must be placed within <CheckboxGroup>.' : _formatErrorMessage(3));
  }
  return context;
}