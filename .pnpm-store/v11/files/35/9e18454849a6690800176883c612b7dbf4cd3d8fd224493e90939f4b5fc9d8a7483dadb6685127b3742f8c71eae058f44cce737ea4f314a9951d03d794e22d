import { ReactStore } from '@base-ui/utils/store';
import { ToastManagerAddOptions, ToastManagerPromiseOptions, ToastManagerUpdateOptions, ToastObject } from "./useToastManager.js";
type ToastInternalUpdateOptions<Data extends object> = Partial<Omit<ToastObject<Data>, 'id'>>;
type UpdateToastBehavior = {
  resetTimer?: boolean | undefined;
  markUpdated?: boolean | undefined;
};
type RemoveToastBehavior = {
  skipOnRemove?: boolean | undefined;
};
export type State = {
  toasts: ToastObject<any>[];
  toastMetadata: Map<string, ToastMetadata>;
  hovering: boolean;
  focused: boolean;
  timeout: number;
  limit: number;
  isWindowFocused: boolean;
  viewport: HTMLElement | null;
  prevFocusElement: HTMLElement | null;
};
type ToastMetadata = {
  value: ToastObject<any>;
  domIndex: number;
  visibleIndex: number;
  offsetY: number;
};
type InitialState = Omit<State, 'toastMetadata'>;
export declare const selectors: {
  toasts: (state: State) => ToastObject<any>[];
  isEmpty: (state: State) => boolean;
  toast: (args_0: State, id: string) => ToastObject<any> | undefined;
  toastIndex: (args_0: State, id: string) => number;
  toastOffsetY: (args_0: State, id: string) => number;
  toastVisibleIndex: (args_0: State, id: string) => number;
  hovering: (state: State) => boolean;
  focused: (state: State) => boolean;
  expanded: (state: State) => boolean;
  expandedOrOutOfFocus: (state: State) => boolean;
  prevFocusElement: (state: State) => HTMLElement | null;
};
export declare class ToastStore extends ReactStore<State, {}, typeof selectors> {
  private timers;
  private areTimersPaused;
  constructor(initialState: InitialState);
  setFocused(focused: boolean): void;
  setHovering(hovering: boolean): void;
  setIsWindowFocused(isWindowFocused: boolean): void;
  setPrevFocusElement(prevFocusElement: HTMLElement | null): void;
  setViewport: (viewport: HTMLElement | null) => void;
  syncProviderProps(props: Pick<State, 'timeout' | 'limit'>): void;
  disposeEffect: () => () => void;
  removeToast(toastId: string, behavior?: RemoveToastBehavior): void;
  addToast: <Data extends object>(toast: ToastManagerAddOptions<Data>) => string;
  updateToast: <Data extends object>(id: string, updates: ToastManagerUpdateOptions<Data>) => void;
  updateToastInternal: <Data extends object>(id: string, updates: ToastInternalUpdateOptions<Data>, behavior?: UpdateToastBehavior) => void;
  closeToast: (toastId?: string) => void;
  promiseToast: <Value, Data extends object>(promiseValue: Promise<Value>, options: ToastManagerPromiseOptions<Value, Data>) => Promise<Value>;
  pauseTimers(): void;
  resumeTimers(): void;
  restoreFocusToPrevElement(): void;
  handleDocumentPointerDown: (event: PointerEvent) => void;
  private scheduleTimer;
  private clearTimers;
  private clearTimer;
  private handleTimerFired;
  private resetPausedStateIfNoTimersRemain;
  private setToasts;
  private handleFocusManagement;
}
export {};