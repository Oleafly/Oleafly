import { generateText } from "ai";
import { completeText, rustAgentEnabled } from "@/lib/agent-backend";
import { getConfig } from "@/lib/tauri";
import { resolveActiveModel } from "@/lib/ai-providers";

/**
 * Live `CompleteChatFn` adapter: resolves the user's active AI provider/model
 * and runs a single-shot chat completion.
 *
 * The Rust backend owns this call by default, which keeps the provider key out
 * of the webview. `OLEAFLY_AGENT=ts` runs the in-webview AI SDK path instead.
 */
export async function completeChatWithActiveModel(args: {
  system: string;
  user: string;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (await rustAgentEnabled()) {
    return completeText({
      system: args.system,
      user: args.user,
      temperature: args.temperature,
      signal: args.signal,
    });
  }

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
