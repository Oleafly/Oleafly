import { streamText as streamViaRust } from "@/lib/agent-backend";
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
  return streamViaRust({
    system: systemPromptForReview(args.mode),
    user: userPromptForReview(args.paperText),
    temperature: args.mode === "fire" ? 0.7 : 0.4,
    signal: args.signal,
    onToken: args.onChunk,
  });
}
