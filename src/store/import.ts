import type {
  ConvertOptions,
  ConvertResult,
  ExtractedFigure,
  PageInput,
} from "@oleafly/pdf-to-latex";
import { convertPages } from "@oleafly/pdf-to-latex";
import { create } from "zustand";

interface ImportState {
  open: boolean;
  fileName: string;
  pdfBytes: Uint8Array | null;
  pages: PageInput[];
  figures: ExtractedFigure[];
  result: ConvertResult | null;
  busy: boolean;
  error: string | null;
  view: "preview" | "source" | "split";
  options: ConvertOptions;
  openWithPdf: (bytes: Uint8Array, fileName: string) => Promise<void>;
  rerun: (options: ConvertOptions) => void;
  setView: (v: "preview" | "source" | "split") => void;
  close: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  open: false,
  fileName: "",
  pdfBytes: null,
  pages: [],
  figures: [],
  result: null,
  busy: false,
  error: null,
  view: "split",
  options: {},
  openWithPdf: async (bytes, fileName) => {
    set({
      open: true,
      busy: true,
      error: null,
      fileName,
      pdfBytes: bytes,
      result: null,
      pages: [],
      figures: [],
      options: {},
    });
    try {
      const { extractPagesForConvert } = await import("@oleafly/pdf-to-latex/pdf-adapter");
      const { pages, figures } = await extractPagesForConvert(bytes);
      if (!get().open) return;
      set({ pages, figures, result: convertPages(pages, {}), busy: false });
    } catch (e) {
      set({ busy: false, error: String(e) });
    }
  },
  rerun: (options) => {
    const { pages } = get();
    set({ options, result: convertPages(pages, options) });
  },
  setView: (view) => set({ view }),
  close: () =>
    set({
      open: false,
      pdfBytes: null,
      pages: [],
      figures: [],
      result: null,
      error: null,
    }),
}));
