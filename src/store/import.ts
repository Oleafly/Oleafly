import type {
  ConvertOptions,
  ConvertResult,
  ExtractedFigure,
  PageInput,
} from "@oleafly/pdf-to-latex";
import { convertPages } from "@oleafly/pdf-to-latex";
import { create } from "zustand";
import { useHomeViewStore } from "@/store/home-view";

let scanController: AbortController | null = null;

interface ImportState {
  requestGeneration: number;
  open: boolean;
  fileName: string;
  pdfBytes: Uint8Array | null;
  pages: PageInput[];
  figures: ExtractedFigure[];
  result: ConvertResult | null;
  scanTranscribed: boolean;
  busy: boolean;
  error: string | null;
  view: "preview" | "source" | "split";
  options: ConvertOptions;
  openWithPdf: (bytes: Uint8Array, fileName: string) => Promise<void>;
  rerun: (options: ConvertOptions) => void;
  transcribeScan: () => Promise<void>;
  setView: (v: "preview" | "source" | "split") => void;
  close: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  requestGeneration: 0,
  open: false,
  fileName: "",
  pdfBytes: null,
  pages: [],
  figures: [],
  result: null,
  scanTranscribed: false,
  busy: false,
  error: null,
  view: "split",
  options: {},
  openWithPdf: async (bytes, fileName) => {
    scanController?.abort();
    scanController = null;
    const requestGeneration = get().requestGeneration + 1;
    useHomeViewStore.getState().goTo("pdf-import");
    set({
      requestGeneration,
      open: true,
      busy: true,
      error: null,
      fileName,
      pdfBytes: bytes,
      result: null,
      scanTranscribed: false,
      pages: [],
      figures: [],
      options: {},
    });
    try {
      const { extractPagesForConvert } = await import("@oleafly/pdf-to-latex/pdf-adapter");
      const { pages, figures } = await extractPagesForConvert(bytes);
      if (!get().open || get().requestGeneration !== requestGeneration) return;
      set({ pages, figures, result: convertPages(pages, {}), busy: false });
    } catch (e) {
      if (get().open && get().requestGeneration === requestGeneration) {
        set({ busy: false, error: String(e) });
      }
    }
  },
  rerun: (options) => {
    scanController?.abort();
    scanController = null;
    const { pages } = get();
    set((state) => ({
      requestGeneration: state.requestGeneration + 1,
      options,
      result: convertPages(pages, options),
      scanTranscribed: false,
      busy: false,
      error: null,
    }));
  },
  transcribeScan: async () => {
    const { pdfBytes, result, requestGeneration, busy } = get();
    if (!pdfBytes || !result?.report.likelyScanned || busy) return;
    const controller = new AbortController();
    scanController = controller;
    set({ busy: true, error: null });
    try {
      const { transcribePdfPages } = await import("@/features/ad-hoc-converters");
      const tex = await transcribePdfPages(
        pdfBytes,
        result.report.pages,
        "LaTeX",
        undefined,
        controller.signal,
      );
      if (!get().open || get().requestGeneration !== requestGeneration) return;
      set({ result: { ...result, tex }, scanTranscribed: true, busy: false });
    } catch (error) {
      if (get().open && get().requestGeneration === requestGeneration) {
        set({
          busy: false,
          error:
            error instanceof DOMException && error.name === "AbortError"
              ? null
              : error instanceof Error
                ? error.message
                : String(error),
        });
      }
    } finally {
      if (scanController === controller) scanController = null;
    }
  },
  setView: (view) => set({ view }),
  close: () =>
    set((state) => {
      scanController?.abort();
      scanController = null;
      return {
        requestGeneration: state.requestGeneration + 1,
        open: false,
        busy: false,
        pdfBytes: null,
        pages: [],
        figures: [],
        result: null,
        scanTranscribed: false,
        error: null,
      };
    }),
}));
