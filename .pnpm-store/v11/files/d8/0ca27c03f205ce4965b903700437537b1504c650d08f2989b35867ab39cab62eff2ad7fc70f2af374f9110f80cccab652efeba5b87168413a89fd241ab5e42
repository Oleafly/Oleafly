'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const IsDrawerContext = /*#__PURE__*/React.createContext(false);
if (process.env.NODE_ENV !== "production") IsDrawerContext.displayName = "IsDrawerContext";
export const DialogRootContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") DialogRootContext.displayName = "DialogRootContext";
export function useDialogRootContext(optional) {
  const dialogRootContext = React.useContext(DialogRootContext);
  if (optional === false && dialogRootContext === undefined) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: DialogRootContext is missing. Dialog parts must be placed within <Dialog.Root>.' : _formatErrorMessage(27));
  }
  return dialogRootContext;
}