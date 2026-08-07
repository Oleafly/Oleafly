import { completeText } from "@/lib/agent-backend";

export async function completeChatWithActiveModel(args: {
  system: string;
  user: string;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string> {
  return completeText({
    system: args.system,
    user: args.user,
    temperature: args.temperature,
    signal: args.signal,
  });
}
