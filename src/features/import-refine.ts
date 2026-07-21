import { modelSupportsVision } from "@oleafly/ai-core";
import { hasConfiguredProvider, resolveActiveModel } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import { getConfig } from "@/lib/tauri";
import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useImportStore } from "@/store/import";
import { createProjectFromConversion } from "@/features/import";

const MAX_REFINE_PAGES = 8;

export async function refineAvailable(): Promise<boolean> {
  try {
    const cfg = await getConfig();
    if (!hasConfiguredProvider(cfg)) return false;
    const { providerId, modelId } = resolveActiveModel(cfg);
    return modelSupportsVision(providerId, modelId);
  } catch {
    return false;
  }
}

export async function refineWithAi(): Promise<void> {
  const { pdfBytes, result } = useImportStore.getState();
  if (!pdfBytes || !result) return;
  const pages = Math.min(Math.max(result.report.pages, 1), MAX_REFINE_PAGES);
  const images: string[] = [];
  for (let p = 1; p <= pages; p++) {
    try {
      images.push(await pdfPageToPng(pdfBytes, p, 1.5, "#ffffff"));
    } catch {
      break;
    }
  }
  await createProjectFromConversion();
  useAgentHandoffStore.getState().handoff(
    [
      "This project was imported from a PDF by a deterministic converter. The attached images are the original PDF pages (ground truth).",
      "Improve main.tex to match the originals: fix display math, rebuild tables as tabular, and repair layout. Never invent content that is not visible in the page images.",
      "Work loop: edit main.tex with write_file, then compile. If compilation fails, read the log and fix. Stop after at most 3 compile attempts and report remaining issues.",
      pages < result.report.pages
        ? `Only the first ${pages} pages are attached; leave later pages as they are.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    { autoSend: true, images },
  );
}
