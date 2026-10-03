import { modelSupportsVision } from "@oleafly/ai-core";
import { hasConfiguredProvider, pickActiveProvider } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import { getConfig } from "@/lib/tauri";
import { handoffToAssistant } from "@/features/assistant-handoff";
import { useImportStore } from "@/store/import";
import { useFilesStore } from "@/store/files";
import { createProjectFromConversion } from "@/features/import";

const MAX_REFINE_PAGES = 8;

const REPAIRS_BY_PROFILE: Record<string, string> = {
  latex: "fix display math, rebuild tables as tabular, and repair layout",
  typst: "fix display math in Typst math syntax, rebuild tables with #table, and repair layout",
  markdown: "fix display math, rebuild tables as pipe tables, and repair layout",
};

export function refinePrompt(options: {
  profile: string;
  mainDoc: string;
  attached: number;
  total: number;
}): string {
  const { profile, mainDoc, attached, total } = options;
  const repairs = REPAIRS_BY_PROFILE[profile] ?? "fix display math, rebuild tables, and repair layout";
  return [
    "This project was imported from a PDF by a deterministic converter. The attached images are the original PDF pages (ground truth).",
    `Improve ${mainDoc} to match the originals: ${repairs}. Never invent content that is not visible in the page images.`,
    `Work loop: edit ${mainDoc} with write_file, then compile. If compilation fails, read the log and fix. Stop after at most 3 compile attempts and report remaining issues.`,
    attached < total ? `Only the first ${attached} pages are attached. Leave later pages as they are.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function refineAvailable(): Promise<boolean> {
  try {
    const cfg = await getConfig();
    if (!hasConfiguredProvider(cfg)) return false;
    const { providerId, modelId } = pickActiveProvider(cfg);
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
  if (!(await createProjectFromConversion())) return;
  const { engine, mainDoc } = useFilesStore.getState();
  handoffToAssistant(
    refinePrompt({
      profile: engine.capabilities.formatting_profile,
      mainDoc: mainDoc || engine.main_document || "main.tex",
      attached: pages,
      total: result.report.pages,
    }),
    { autoSend: true, images },
  );
}
