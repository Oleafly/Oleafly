import type { PresentMode } from "@/components/preview/PdfToolbarControls";
import type { PresentationSource } from "@/features/presentation/navigation";
import { logError } from "@/lib/log";
import { useSettingsStore } from "@/store/settings";
import { useTypstVariantStore } from "@/store/typst-variant";

export interface PresentRequest {
  readonly projectId: string | null;
  readonly mode: PresentMode;
  readonly page: number;
  readonly mainDoc: string | null;
  readonly typst: boolean;
  readonly source?: PresentationSource;
}

export async function present(request: PresentRequest): Promise<void> {
  if (!request.projectId) return;
  try {
    const { startPresentation } = await import("@/features/presentation/open");
    await startPresentation({
      projectId: request.projectId,
      source: request.source ?? { kind: "compiled" },
      start: request.mode === "page" ? request.page : 1,
      presenter: request.mode === "presenter",
      main: request.mainDoc,
      typst: request.typst,
      variant: request.typst ? (useTypstVariantStore.getState().selections[request.projectId] ?? null) : null,
      offline: useSettingsStore.getState().offline,
    });
  } catch (error) {
    void logError("start presentation", error);
  }
}
