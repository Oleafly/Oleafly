import { create } from "zustand";

interface StyleRuleDialogState {
  open: boolean;
  find: string;
  show: (find?: string) => void;
  setOpen: (open: boolean) => void;
}

export const useStyleRuleDialogStore = create<StyleRuleDialogState>((set) => ({
  open: false,
  find: "",
  show: (find = "") => set({ open: true, find }),
  setOpen: (open) => set(open ? { open } : { open, find: "" }),
}));
