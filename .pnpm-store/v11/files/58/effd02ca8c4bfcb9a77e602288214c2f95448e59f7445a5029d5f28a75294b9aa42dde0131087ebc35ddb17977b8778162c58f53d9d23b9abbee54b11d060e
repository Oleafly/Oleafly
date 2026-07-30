'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
export const PreviewCardPositionerContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") PreviewCardPositionerContext.displayName = "PreviewCardPositionerContext";
export function usePreviewCardPositionerContext() {
  const context = React.useContext(PreviewCardPositionerContext);
  if (context === undefined) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: <PreviewCard.Popup> and <PreviewCard.Arrow> must be used within the <PreviewCard.Positioner> component' : _formatErrorMessage(49));
  }
  return context;
}