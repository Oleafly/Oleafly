'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const DrawerViewportContext = /*#__PURE__*/React.createContext(null);
if (process.env.NODE_ENV !== "production") DrawerViewportContext.displayName = "DrawerViewportContext";
export function useDrawerViewportContext(optional) {
  const context = React.useContext(DrawerViewportContext);
  if (optional === false && context === null) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: DrawerViewportContext is missing. Drawer parts must be placed within <Drawer.Viewport>.' : _formatErrorMessage(92));
  }
  return context;
}