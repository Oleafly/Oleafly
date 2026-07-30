'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const ToggleGroupContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") ToggleGroupContext.displayName = "ToggleGroupContext";
export function useToggleGroupContext(optional = true) {
  const context = React.useContext(ToggleGroupContext);
  if (context === undefined && !optional) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: ToggleGroupContext is missing. ToggleGroup parts must be placed within <ToggleGroup>.' : _formatErrorMessage(7));
  }
  return context;
}