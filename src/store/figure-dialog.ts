import type { FigureGridSpec } from "@oleafly/latex/figure-grid";
import { create } from "zustand";
import type { TypstFigureFields } from "@/components/editor/typst-figure";

export interface FigureEditTarget {
  from: number;
  to: number;
  path: string;
  width: string | null;
  typst?: TypstFigureFields;
  grid?: FigureGridSpec;
}

interface FigureDialogState {
  open: boolean;
  edit: FigureEditTarget | null;
  setOpen: (open: boolean) => void;
  openForEdit: (target: FigureEditTarget) => void;
}

export const useFigureDialogStore = create<FigureDialogState>((set) => ({
  open: false,
  edit: null,
  setOpen: (open) => set(open ? { open: true, edit: null } : { open: false, edit: null }),
  openForEdit: (target) => set({ open: true, edit: target }),
}));
