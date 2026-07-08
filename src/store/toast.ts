import { create } from "zustand";

export type ToastKind = "error" | "success" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /** When true, the toast stays until the user dismisses it (no auto-timeout). */
  sticky?: boolean;
}

interface ToastState {
  toasts: Toast[];
  /** Show a toast; returns its id. */
  push: (kind: ToastKind, message: string, action?: ToastAction, sticky?: boolean) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

/**
 * App-wide transient notifications. Kept deliberately tiny (no dependency):
 * a list of toasts plus push/dismiss. The <Toaster/> renders them and handles
 * auto-dismiss timing. Use the helpers in `@/lib/toast` from call sites.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message, action, sticky) => {
    const id = ++seq;
    // Cap the stack so a burst of failures can't fill the screen.
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, action, sticky }].slice(-4) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
