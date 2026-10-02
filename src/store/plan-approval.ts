import { create } from "zustand";
import { readString, removeKey, writeString } from "@/lib/local-storage";

export type PlanApprovalStatus = "planning" | "awaiting" | "approved";

export interface PlanApprovalState {
  byChat: Record<string, PlanApprovalStatus>;
  loaded: Record<string, boolean>;
  load: (chatId: string | null) => PlanApprovalStatus;
  status: (chatId: string | null) => PlanApprovalStatus;
  setStatus: (chatId: string | null, status: PlanApprovalStatus) => void;
  discardForChats: (chatIds: readonly string[]) => void;
}

const STORAGE_PREFIX = "oleafly.plan-approval.";

const storageKey = (chatId: string) => `${STORAGE_PREFIX}${chatId}`;

function readStored(chatId: string): PlanApprovalStatus {
  const raw = readString(storageKey(chatId));
  return raw === "awaiting" || raw === "approved" ? raw : "planning";
}

function writeStored(chatId: string, status: PlanApprovalStatus): void {
  if (status === "planning") removeKey(storageKey(chatId));
  else writeString(storageKey(chatId), status);
}

function clearStored(chatIds: readonly string[]): void {
  for (const chatId of chatIds) removeKey(storageKey(chatId));
}

export function planApprovalForChat(
  byChat: Readonly<Record<string, PlanApprovalStatus>>,
  chatId: string | null,
): PlanApprovalStatus {
  return chatId ? (byChat[chatId] ?? "planning") : "planning";
}

export const usePlanApprovalStore = create<PlanApprovalState>((set, get) => ({
  byChat: {},
  loaded: {},
  load: (chatId) => {
    if (!chatId) return "planning";
    if (get().loaded[chatId]) return planApprovalForChat(get().byChat, chatId);
    const status = readStored(chatId);
    set((state) => ({
      byChat: { ...state.byChat, [chatId]: status },
      loaded: { ...state.loaded, [chatId]: true },
    }));
    return status;
  },
  status: (chatId) => {
    if (!chatId) return "planning";
    if (!get().loaded[chatId]) return get().load(chatId);
    return planApprovalForChat(get().byChat, chatId);
  },
  setStatus: (chatId, status) => {
    if (!chatId) return;
    writeStored(chatId, status);
    set((state) => ({
      byChat: { ...state.byChat, [chatId]: status },
      loaded: { ...state.loaded, [chatId]: true },
    }));
  },
  discardForChats: (chatIds) => {
    if (chatIds.length === 0) return;
    clearStored(chatIds);
    set((state) => {
      const byChat = { ...state.byChat };
      const loaded = { ...state.loaded };
      for (const chatId of chatIds) {
        delete byChat[chatId];
        delete loaded[chatId];
      }
      return { byChat, loaded };
    });
  },
}));
