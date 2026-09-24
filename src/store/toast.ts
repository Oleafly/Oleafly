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
  count: number;
}

export const TOAST_LIMIT = 4;
export const TOAST_DURATION_MS = 5000;
export const TOAST_QUIET_MS = 2000;

interface ToastState {
  toasts: Toast[];
  quietUntil: Record<string, number>;
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
  close: (id: number) => void;
  reset: () => void;
}

let seq = 0;

function signature(kind: ToastKind, message: string): string {
  return `${kind}:${message}`;
}

function sameContent(toast: Toast, kind: ToastKind, message: string): boolean {
  return toast.kind === kind && toast.message === message;
}

function repeatCount(toasts: Toast[], skipId: number, kind: ToastKind, message: string): number {
  const duplicate = toasts.find(
    (toast) => toast.id !== skipId && sameContent(toast, kind, message),
  );
  return duplicate ? duplicate.count + 1 : 1;
}

function refreshed(toasts: Toast[], next: Toast): Toast[] {
  return [
    ...toasts.filter(
      (toast) => toast.id !== next.id && !sameContent(toast, next.kind, next.message),
    ),
    next,
  ];
}

function withinLimit(toasts: Toast[], newestId: number): Toast[] {
  const kept = [...toasts];
  while (kept.length > TOAST_LIMIT) {
    const transient = kept.findIndex((toast) => !toast.sticky && toast.id !== newestId);
    const oldest = kept.findIndex((toast) => toast.id !== newestId);
    kept.splice(transient >= 0 ? transient : oldest, 1);
  }
  return kept;
}

function activeQuiet(quietUntil: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(quietUntil).filter(([, until]) => until > now));
}

export const useToastStore = create<ToastState>((set, get) => {
  const show = (
    key: string | undefined,
    kind: ToastKind,
    message: string,
    action: ToastAction | undefined,
    sticky: boolean | undefined,
  ): number => {
    const { toasts, quietUntil } = get();
    const slot = key === undefined ? undefined : toasts.find((toast) => toast.key === key);
    if (slot) {
      const count = sameContent(slot, kind, message)
        ? slot.count + 1
        : repeatCount(toasts, slot.id, kind, message);
      set({ toasts: refreshed(toasts, { ...slot, kind, message, action, sticky, count }) });
      return slot.id;
    }
    const match = toasts.find((toast) => sameContent(toast, kind, message));
    if (match) {
      set({
        toasts: refreshed(toasts, {
          ...match,
          key: match.key ?? key,
          action: action ?? match.action,
          sticky: match.sticky || sticky,
          count: match.count + 1,
        }),
      });
      return match.id;
    }
    const id = ++seq;
    if ((quietUntil[signature(kind, message)] ?? 0) > Date.now()) return id;
    const next: Toast = { id, key, kind, message, action, sticky, count: 1 };
    set({ toasts: withinLimit([...toasts, next], id) });
    return id;
  };

  return {
    toasts: [],
    quietUntil: {},
    push: (kind, message, action, sticky) => show(undefined, kind, message, action, sticky),
    pushUnique: (key, kind, message, action, sticky) => show(key, kind, message, action, sticky),
    update: (id, message) => {
      const { toasts } = get();
      const target = toasts.find((toast) => toast.id === id);
      if (!target || target.message === message) return;
      const count = repeatCount(toasts, id, target.kind, message);
      set({ toasts: refreshed(toasts, { ...target, message, count }) });
    },
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((toast) => toast.id !== id) })),
    close: (id) => {
      const { toasts, quietUntil } = get();
      const target = toasts.find((toast) => toast.id === id);
      if (!target) return;
      const now = Date.now();
      set({
        toasts: toasts.filter((toast) => toast.id !== id),
        quietUntil: {
          ...activeQuiet(quietUntil, now),
          [signature(target.kind, target.message)]: now + TOAST_QUIET_MS,
        },
      });
    },
    reset: () => set({ toasts: [], quietUntil: {} }),
  };
});
