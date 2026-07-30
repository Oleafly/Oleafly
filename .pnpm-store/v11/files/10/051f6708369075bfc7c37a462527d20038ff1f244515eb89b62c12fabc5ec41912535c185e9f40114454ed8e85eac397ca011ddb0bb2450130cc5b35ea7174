'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
import { ToastContext } from "./provider/ToastProviderContext.mjs";
/**
 * Returns the array of toasts and methods to manage them.
 */
export function useToastManager() {
  const store = React.useContext(ToastContext);
  if (!store) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: useToastManager must be used within <Toast.Provider>.' : _formatErrorMessage(73));
  }
  const toasts = store.useState('toasts');
  return React.useMemo(() => ({
    toasts,
    add: store.addToast,
    close: store.closeToast,
    update: store.updateToast,
    promise: store.promiseToast
  }), [toasts, store]);
}