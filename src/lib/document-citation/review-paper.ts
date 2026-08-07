import { streamText } from "ai";
import { rustAgentEnabled, streamText as streamViaRust } from "@/lib/agent-backend";
import { getConfig } from "@/lib/tauri";
import { resolveActiveModel } from "@/lib/ai-providers";
import {
  systemPromptForReview,
  userPromptForReview,
  type PaperReviewMode,
} from "./review-prompts";

export type { PaperReviewMode };

export async function runPaperReview(args: {
  mode: PaperReviewMode;
  paperText: string;
  signal?: AbortSignal;
  onChunk?: (full: string) => void;
}): Promise<string> {
  const temperature = args.mode === "fire" ? 0.7 : 0.4;

  if (await rustAgentEnabled()) {
    return streamViaRust({
      system: systemPromptForReview(args.mode),
      user: userPromptForReview(args.paperText),
      temperature,
      signal: args.signal,
      onToken: args.onChunk,
    });
  }

  const cfg = await getConfig();
  const { model } = resolveActiveModel(cfg);
  const result = streamText({
    model,
    system: systemPromptForReview(args.mode),
    prompt: userPromptForReview(args.paperText),
    temperature,
    abortSignal: args.signal,
  });

  let full = "";
  for await (const delta of result.textStream) {
    full += delta;
    args.onChunk?.(full);
  }
  return full;
}
