import { create } from "zustand";

export interface ConfirmRequest {
  /** The question the dialog asks. */
  message: string;
  /** The confirm button's label, also the dialog's title. */
  confirmLabel?: string;
  destructive?: boolean;
}

export interface PendingConfirm extends ConfirmRequest {
  id: number;
  settle: (confirmed: boolean) => void;
}

interface ConfirmDialogState {
  queue: PendingConfirm[];
}

export const useConfirmDialogStore = create<ConfirmDialogState>(() => ({ queue: [] }));

let nextId = 0;

/** Asks in the app's own dialog, which `ConfirmHost` shows. */
export function askInApp(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    nextId += 1;
    const id = nextId;
    const settle = (confirmed: boolean) => {
      useConfirmDialogStore.setState((state) => ({
        queue: state.queue.filter((item) => item.id !== id),
      }));
      resolve(confirmed);
    };
    useConfirmDialogStore.setState((state) => ({
      queue: [...state.queue, { ...request, id, settle }],
    }));
  });
}

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

/**
 * Asks before a step that deletes or overwrites. Tauri's dialog plugin
 * replaces `window.confirm` with an async call, and its Promise is always
 * truthy, so `if (window.confirm(...))` went ahead without asking. That
 * replacement is skipped for the app's own dialog; a synchronous confirm (a
 * browser's, or one a test installs) still answers directly.
 */
export async function confirmAction(request: ConfirmRequest): Promise<boolean> {
  if (!(window.confirm instanceof AsyncFunction)) {
    const answer: unknown = window.confirm(request.message);
    if (typeof answer === "boolean") return answer;
    // Another replacement that answers with a Promise isn't the user's answer.
    Promise.resolve(answer).catch(() => undefined);
  }
  return askInApp(request);
}
