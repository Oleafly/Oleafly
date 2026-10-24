import type {
  ConvertOptions,
  ConvertResult,
  ExtractedFigure,
  PageInput,
} from "@oleafly/pdf-to-latex";
import { convertPages } from "@oleafly/pdf-to-latex";
import { create } from "zustand";
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
  /** The Tools model that transcribed the scan, and where the pages went. */
  scanModel: TranscriptionModelInfo | null;
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
  scanModel: null,
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
      busy: false,
      error: null,
    }));
  },
  transcribeScan: async () => {
    const { pdfBytes, result, requestGeneration, busy, pages, options } = get();
    if (!pdfBytes || !result?.report.likelyScanned || busy) return;
    const controller = new AbortController();
    scanController = controller;
    set({ busy: true, error: null });
    try {
      const [{ selectedPages }, { transcribePdfPages }] = await Promise.all([
        import("@/features/tools-ai/scan-estimate"),
        import("@/features/ad-hoc-converters"),
      ]);
      // The pages the conversion shows: the chosen range, not the first N.
      const numbers = selectedPages(pages.length, options.pageRange);
      const { text, model } = await transcribePdfPages(
        pdfBytes,
        numbers,
        "LaTeX",
        undefined,
        controller.signal,
      );
      if (!get().open || get().requestGeneration !== requestGeneration) return;
      set({ result: { ...result, tex: text }, scanTranscribed: true, scanModel: model, busy: false });
    } catch (error) {
      if (get().open && get().requestGeneration === requestGeneration) {
        set({
          busy: false,
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
        error: null,
      };
    }),
}));
