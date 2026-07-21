import { generateText } from "ai";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { modelSupportsVision } from "@/lib/ai-figure";
import { hasConfiguredProvider, resolveActiveModel } from "@/lib/ai-providers";
import { logError } from "@/lib/log";
import { getConfig } from "@/lib/tauri";
import { toast } from "@/lib/toast";

export async function imageToLatexAvailable(): Promise<boolean> {
  try {
    const cfg = await getConfig();
    if (!hasConfiguredProvider(cfg)) return false;
    const { providerId, modelId } = resolveActiveModel(cfg);
    return modelSupportsVision(providerId, modelId);
  } catch {
    return false;
  }
}

export async function imageToLatex(file: File): Promise<void> {
  const cfg = await getConfig();
  const { model } = resolveActiveModel(cfg);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("could not read image"));
    r.readAsDataURL(file);
  });
  toast.info("Transcribing image ...");
  try {
    const { text } = await generateText({
      model,
      system:
        "You transcribe images into LaTeX. Return ONLY a LaTeX snippet: an equation environment, a tabular, or plain text matching the image. No preamble, no documentclass, no markdown fences, no explanation. Transcribe exactly what is visible, never invent content. Never use em dashes.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this image to LaTeX." },
            { type: "image", image: dataUrl },
          ],
        },
      ],
    });
    const snippet = text
      .replace(/^```[a-zA-Z]*\n?/gm, "")
      .replace(/```$/gm, "")
      .trim();
    if (!snippet) throw new Error("empty transcription");
    insertAtCursor(snippet);
    toast.success("Inserted LaTeX from image");
  } catch (e) {
    logError("image-to-latex", e);
    toast.error(`Image to LaTeX failed: ${e}`);
  }
}
