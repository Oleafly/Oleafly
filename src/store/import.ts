import type {
  ConvertOptions,
  ConvertResult,
  ExtractedFigure,
  PageInput,
} from "@oleafly/pdf-to-latex";
import { convertPages } from "@oleafly/pdf-to-latex";
import { create } from "zustand";
import type { ConverterProgress } from "@/features/ad-hoc-converters";
import type { TranscriptionModelInfo } from "@/features/tools-ai/transcribe";
import { describeError } from "@/lib/app-error";
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
  scanModel: TranscriptionModelInfo | null;
  scanProgress: ConverterProgress | null;
  busy: boolean;
  error: string | null;
  view: "preview" | "source" | "split";
  options: ConvertOptions;
  openWithPdf: (bytes: Uint8Array, fileName: string) => Promise<void>;
  rerun: (options: ConvertOptions) => void;
  transcribeScan: () => Promise<void>;
  cancelScan: () => void;
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
  scanModel: null,
  scanProgress: null,
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
      scanModel: null,
      scanProgress: null,
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
      scanModel: null,
      scanProgress: null,
      busy: false,
      error: null,
    }));
  },
  transcribeScan: async () => {
    const { pdfBytes, result, requestGeneration, busy, pages, options } = get();
    if (!pdfBytes || !result?.report.likelyScanned || busy) return;
    const controller = new AbortController();
    scanController = controller;
    set({ busy: true, error: null, scanProgress: { step: "readingPages" } });
    const current = () =>
      !controller.signal.aborted && get().open && get().requestGeneration === requestGeneration;
    try {
      const [{ selectedPages }, { transcribePdfPages }] = await Promise.all([
        import("@/features/tools-ai/scan-estimate"),
        import("@/features/ad-hoc-converters"),
      ]);
      const numbers = selectedPages(pages.length, options.pageRange);
      const { text, model } = await transcribePdfPages(
        pdfBytes,
        numbers,
        "LaTeX",
        (progress) => {
          if (current()) set({ scanProgress: progress });
        },
        controller.signal,
      );
      if (!current()) return;
      set({
        result: { ...result, tex: text },
        scanTranscribed: true,
        scanModel: model,
        scanProgress: null,
        busy: false,
      });
    } catch (error) {
      if (get().open && get().requestGeneration === requestGeneration) {
        set({
          busy: false,
          scanProgress: null,
          error:
            error instanceof DOMException && error.name === "AbortError"
              ? null
              : describeError(error).replace(/^\[[a-z_]+\]\s*/, ""),
        });
      }
    } finally {
      if (scanController === controller) scanController = null;
    }
  },
  cancelScan: () => {
    if (!scanController) return;
    scanController.abort();
    scanController = null;
    set((state) => ({
      requestGeneration: state.requestGeneration + 1,
      busy: false,
      scanProgress: null,
      error: null,
    }));
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
        scanModel: null,
        scanProgress: null,
        error: null,
      };
    }),
}));
