import { create } from "zustand";

export type ToastKind = "error" | "success" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  key?: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  sticky?: boolean;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, action?: ToastAction, sticky?: boolean) => number;
  pushUnique: (
    key: string,
    kind: ToastKind,
    message: string,
    action?: ToastAction,
    sticky?: boolean,
  ) => number;
  update: (id: number, message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, action, sticky) => {
    const id = ++seq;
    // Cap the stack so a burst of failures can't fill the screen.
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, action, sticky }].slice(-4) }));
    return id;
  },
  pushUnique: (key, kind, message, action, sticky) => {
    const existing = get().toasts.find((toast) => toast.key === key);
    if (existing) {
      set((s) => ({
        toasts: s.toasts.map((toast) =>
          toast.id === existing.id ? { ...toast, kind, message, action, sticky } : toast,
        ),
      }));
      return existing.id;
    }
    const id = ++seq;
    set((s) => ({
      toasts: [...s.toasts, { id, key, kind, message, action, sticky }].slice(-4),
    }));
    return id;
  },
  update: (id, message) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, message } : t)) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
