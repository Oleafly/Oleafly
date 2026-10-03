import { create } from "zustand";
import type {
  MigrationErrorCode,
  MigrationReport,
  MigrationStep,
} from "@/features/latex-to-typst-migration";
import { useFilesStore } from "@/store/files";

export type TypstMigrationPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly step: MigrationStep }
  | { readonly kind: "failed"; readonly code: MigrationErrorCode | null; readonly message: string }
  | { readonly kind: "done"; readonly report: MigrationReport };

interface TypstMigrationStore {
  open: boolean;
  phase: TypstMigrationPhase;
  report: MigrationReport | null;
  openDialog: () => void;
  showReport: () => void;
  close: () => void;
  start: (name: string) => Promise<void>;
}

const LATEX_SOURCE = /\.(?:tex|ltx)$/iu;

async function defaultTypstVersion(): Promise<string | null> {
  try {
    const { useTypstToolchainStore } = await import("@/store/typst-toolchain");
    const status = await useTypstToolchainStore.getState().ensureLoaded();
    return status?.defaultVersion ?? null;
  } catch {
    return null;
  }
}

export const useTypstMigrationStore = create<TypstMigrationStore>((set, get) => ({
  open: false,
  phase: { kind: "idle" },
  report: null,
  openDialog: () => {
    if (get().phase.kind === "running") {
      set({ open: true });
      return;
    }
    set({ open: true, phase: { kind: "idle" } });
  },
  showReport: () => {
    const report = get().report;
    if (report) set({ open: true, phase: { kind: "done", report } });
  },
  close: () => set({ open: false }),
  start: async (name) => {
    if (get().phase.kind === "running") return;
    const files = useFilesStore.getState();
    const projectId = files.projectId;
    if (!projectId) return;
    const buffers = new Map(
      Object.entries(files.files)
        .filter(([path]) => LATEX_SOURCE.test(path))
        .map(([path, file]) => [path, file.content] as const),
    );
    set({ phase: { kind: "running", step: "reading" } });
    try {
      const [{ runLatexToTypstMigration }, typstVersion] = await Promise.all([
        import("@/features/latex-to-typst-migration"),
        defaultTypstVersion(),
      ]);
      const report = await runLatexToTypstMigration(
        { projectId, mainDoc: files.mainDoc, name, typstVersion, buffers },
        undefined,
        (step) => set({ phase: { kind: "running", step } }),
      );
      set({ phase: { kind: "done", report }, report });
      void useFilesStore.getState().refreshProjects().catch(() => {});
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? (error.code as MigrationErrorCode)
          : null;
      set({
        phase: {
          kind: "failed",
          code,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
}));
