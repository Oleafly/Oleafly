import * as React from 'react';
interface DrawerViewportContextValue {
  swiping: boolean;
  getDragStyles: () => React.CSSProperties;
  swipeStrength: number | null;
  setSwipeDismissed: (dismissed: boolean) => void;
}
export declare const DrawerViewportContext: React.Context<DrawerViewportContextValue | null>;
export declare function useDrawerViewportContext(optional?: false): DrawerViewportContextValue;
export declare function useDrawerViewportContext(optional: true): DrawerViewportContextValue | null;
export {};