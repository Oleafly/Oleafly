import * as React from 'react';
import type { ToastObject } from "../useToastManager.js";
export interface ToastRootContext {
  toast: ToastObject<any>;
  rootRef: React.RefObject<HTMLElement | null>;
  titleId: string | undefined;
  setTitleId: React.Dispatch<React.SetStateAction<string | undefined>>;
  descriptionId: string | undefined;
  setDescriptionId: React.Dispatch<React.SetStateAction<string | undefined>>;
  swiping: boolean;
  swipeDirection: 'up' | 'down' | 'left' | 'right' | undefined;
  index: number;
  visibleIndex: number;
  expanded: boolean;
  recalculateHeight: (flushSync?: boolean) => void;
}
export declare const ToastRootContext: React.Context<ToastRootContext | undefined>;
export declare function useToastRootContext(): ToastRootContext;