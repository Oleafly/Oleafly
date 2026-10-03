import { completeViaBackend } from "@/lib/agent-backend";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { modelSupportsVision } from "@/lib/ai-figure";
import { hasConfiguredProvider, pickActiveProvider } from "@/lib/ai-providers";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { getConfig } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { i18n } from "@/i18n";

export async function imageToLatexAvailable(): Promise<boolean> {
  try {
    const cfg = await getConfig();
    if (!hasConfiguredProvider(cfg)) return false;
    const { providerId, modelId } = pickActiveProvider(cfg);
    return modelSupportsVision(providerId, modelId);
  } catch {
    return false;
  }
}

const TRANSCRIBE_SYSTEM =
  "You transcribe images into LaTeX. Return ONLY a LaTeX snippet: an equation environment, a tabular, or plain text matching the image. No preamble, no documentclass, no markdown fences, no explanation. Transcribe exactly what is visible, never invent content. Never use em dashes.";

const TRANSCRIBE_PROMPT = "Transcribe this image to LaTeX.";

const TYPST_TRANSCRIBE_SYSTEM =
  "You transcribe images into Typst markup. Return ONLY a Typst snippet: a math equation in $ $, a #table or #figure, or plain markup matching the image. No #set or #import lines, no markdown fences, no explanation. Transcribe exactly what is visible, never invent content. Never use em dashes.";

const TYPST_TRANSCRIBE_PROMPT = "Transcribe this image to Typst.";

interface TranscriptionTarget {
  readonly system: string;
  readonly prompt: string;
  readonly failed: (detail: string) => string;
}

const LATEX_TARGET: TranscriptionTarget = {
  system: TRANSCRIBE_SYSTEM,
  prompt: TRANSCRIBE_PROMPT,
  failed: (detail) => i18n.t(($) => $.core.imageToLatex.failed, { detail }),
};

const TYPST_TARGET: TranscriptionTarget = {
  system: TYPST_TRANSCRIBE_SYSTEM,
  prompt: TYPST_TRANSCRIBE_PROMPT,
  failed: (detail) => i18n.t(($) => $.core.imageToTypst.failed, { detail }),
};

const IMAGE_TO_LATEX_TOAST_KEY = "image-to-latex";

let latestRun = 0;

function readImage(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error(i18n.t(($) => $.ai.acp.imageReadFailed)));
    r.readAsDataURL(file);
  });
}

function editorTarget(): string {
  const { projectId, activePath } = useFilesStore.getState();
  return JSON.stringify([projectId, activePath]);
}

export function imageToLatex(file: File): Promise<void> {
  return transcribeImage(file, LATEX_TARGET);
}

export function imageToTypst(file: File): Promise<void> {
  return transcribeImage(file, TYPST_TARGET);
}

async function transcribeImage(file: File, target: TranscriptionTarget): Promise<void> {
  const run = ++latestRun;
  const editor = editorTarget();
  const progress = toast.infoUnique(
    IMAGE_TO_LATEX_TOAST_KEY,
    i18n.t(($) => $.core.imageToLatex.transcribing),
    undefined,
    true,
  );
  try {
    const dataUrl = await readImage(file);
    const { text } = await completeViaBackend({
      system: target.system,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: target.prompt },
            { type: "image", image: dataUrl },
          ],
        },
      ],
    });
    const snippet = text
      .replace(/^```[a-zA-Z]*\n?/gm, "")
      .replace(/```$/gm, "")
      .trim();
    if (!snippet) throw new Error(i18n.t(($) => $.ai.conversation.noOutput));
    if (editorTarget() === editor) {
      insertAtCursor(snippet);
      if (run === latestRun) toast.dismiss(progress);
      return;
    }
    await navigator.clipboard.writeText(snippet);
    toast.infoUnique(IMAGE_TO_LATEX_TOAST_KEY, i18n.t(($) => $.library.pdfImport.copied));
  } catch (e) {
    void logError("image-to-latex", e);
    toast.errorUnique(
      IMAGE_TO_LATEX_TOAST_KEY,
      target.failed(describeError(e)),
    );
  }
}
