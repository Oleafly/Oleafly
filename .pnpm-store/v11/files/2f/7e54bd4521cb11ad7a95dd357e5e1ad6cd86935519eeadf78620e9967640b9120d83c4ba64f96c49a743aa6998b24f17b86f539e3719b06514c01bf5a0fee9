'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const DrawerProviderContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") DrawerProviderContext.displayName = "DrawerProviderContext";
export function useDrawerProviderContext(optional) {
  const context = React.useContext(DrawerProviderContext);
  if (optional === false && context === undefined) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: DrawerProviderContext is missing. Use <Drawer.Provider>.' : _formatErrorMessage(91));
  }
  return context;
}