import { generateText } from "ai";
import { getConfig } from "@/lib/tauri";
import { resolveActiveModel } from "@/lib/ai-providers";

/**
 * Live `CompleteChatFn` adapter: resolves the user's active AI provider/model
 * and runs a single-shot chat completion via the Vercel AI SDK.
 */
export async function completeChatWithActiveModel(args: {
  system: string;
  user: string;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string> {
  const cfg = await getConfig();
  const { model } = resolveActiveModel(cfg);
  const result = await generateText({
    model,
    system: args.system,
    prompt: args.user,
    temperature: args.temperature,
    abortSignal: args.signal,
  });
  return result.text ?? "";
}
