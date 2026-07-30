'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const ToolbarGroupContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") ToolbarGroupContext.displayName = "ToolbarGroupContext";
export function useToolbarGroupContext(optional) {
  const context = React.useContext(ToolbarGroupContext);
  if (context === undefined && !optional) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: ToolbarGroupContext is missing. ToolbarGroup parts must be placed within <Toolbar.Group>.' : _formatErrorMessage(68));
  }
  return context;
}