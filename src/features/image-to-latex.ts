// The editor toolbar's Image to LaTeX and Image to Typst. They use the Tools
// model (Settings, AI, Tools), the same one the converters use: local Ollama
// unless the user picked another. With nothing picked and no local model that
// can run, they use the assistant's model when it reads images, as before
// 0.4.8. A hosted model says where the image goes while it works.
import { insertAtCursor } from "@/components/editor/cm/controller";
import { toolsImageReady } from "@/features/tools-ai/tools-choice";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { getConfigCached } from "@/lib/config-cache";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { i18n } from "@/i18n";

/** Whether the toolbar shows the button: with the automatic choice, any AI
 * set up; with a picked model, that model can run. */
export async function imageToLatexAvailable(): Promise<boolean> {
  try {
    return toolsImageReady(await getConfigCached());
  } catch {
    return false;
  }
}

interface TranscriptionTarget {
  readonly kind: "LaTeX" | "Typst";
  readonly failed: (detail: string) => string;
  readonly copied: () => string;
  /** The result could not be inserted or copied for the user. */
  readonly notInserted: () => string;
}

const LATEX_TARGET: TranscriptionTarget = {
  kind: "LaTeX",
  failed: (detail) => i18n.t(($) => $.core.imageToLatex.failed, { detail }),
  copied: () => i18n.t(($) => $.library.pdfImport.copied),
  notInserted: () => i18n.t(($) => $.core.imageToLatex.notInserted),
};

const TYPST_TARGET: TranscriptionTarget = {
  kind: "Typst",
  failed: (detail) => i18n.t(($) => $.core.imageToTypst.failed, { detail }),
  copied: () => i18n.t(($) => $.core.imageToTypst.copied),
  notInserted: () => i18n.t(($) => $.core.imageToTypst.notInserted),
};

const IMAGE_TO_LATEX_TOAST_KEY = "image-to-latex";

function writeClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return Promise.reject(new Error("clipboard unavailable"));
  }
  return navigator.clipboard.writeText(text);
}

/** The user switched files while the model worked. The copy comes long
 * after the click, and WKWebView and WebKitGTK refuse a clipboard write that
 * no click started, so the result stays in a toast whose Copy button carries
 * the gesture instead of being lost. */
async function copyResult(snippet: string, target: TranscriptionTarget): Promise<void> {
  try {
    await writeClipboard(snippet);
    toast.infoUnique(IMAGE_TO_LATEX_TOAST_KEY, target.copied());
  } catch {
    toast.infoUnique(
      IMAGE_TO_LATEX_TOAST_KEY,
      target.notInserted(),
      {
        label: i18n.t(($) => $.common.actions.copy),
        onClick: () => {
          void writeClipboard(snippet).then(
            () => toast.infoUnique(IMAGE_TO_LATEX_TOAST_KEY, target.copied()),
            () => undefined,
          );
        },
      },
      true,
    );
  }
}

let latestRun = 0;

function editorTarget(): string {
  const { projectId, activePath } = useFilesStore.getState();
  return JSON.stringify([projectId, activePath]);
}

function typstVersion(): string | null {
  const engine = useFilesStore.getState().engine;
  return engine?.id === "typst" ? (engine.typst_resolved?.version ?? null) : null;
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
    const { transcribeEditorImage, modelInfo } = await import("@/features/tools-ai/transcribe");
    // Set when the assistant's model reads the image because no Tools model
    // is saved and Ollama cannot: the user should know it left this computer.
    const resolved: { fallbackTo: string | null } = { fallbackTo: null };
    const text = await transcribeEditorImage(file, target.kind, {
      typstVersion: target.kind === "Typst" ? typstVersion() : null,
      onModel: (model) => {
        const sentTo = modelInfo(model).sentTo;
        if (!sentTo) return;
        const fallback = model.engine === "llm" && model.assistantFallback === true;
        if (fallback) resolved.fallbackTo = sentTo;
        toast.infoUnique(
          IMAGE_TO_LATEX_TOAST_KEY,
          fallback
            ? i18n.t(($) => $.researchTools.converterModel.transcribingFallback, { provider: sentTo })
            : i18n.t(($) => $.researchTools.converterModel.transcribingHosted, { provider: sentTo }),
          undefined,
          true,
        );
      },
    });
    const snippet = text.trim();
    if (!snippet) throw new Error(i18n.t(($) => $.ai.conversation.noOutput));
    if (editorTarget() === editor) {
      insertAtCursor(snippet);
      if (run !== latestRun) return;
      if (resolved.fallbackTo) {
        toast.infoUnique(
          IMAGE_TO_LATEX_TOAST_KEY,
          i18n.t(($) => $.researchTools.converterModel.sentFallback, { provider: resolved.fallbackTo }),
        );
      } else {
        toast.dismiss(progress);
      }
      return;
    }
    await copyResult(snippet, target);
  } catch (e) {
    void logError("image-to-latex", e);
    toast.errorUnique(
      IMAGE_TO_LATEX_TOAST_KEY,
      target.failed(describeError(e)),
    );
  }
}
