import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import {
  runViaBackend,
  type AgentContentPart,
  type AgentMessage,
  type AgentRunConfig,
  type AgentRunOutcome,
  type AgentToolSchema,
} from "@/lib/agent-backend";

export interface HarnessToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface HarnessHandlers {
  onActivity(): void;
  onThinking(label: string | null): void;
  onText(full: string): void;
  onReasoningStart(): void;
  onReasoningDelta(chunk: string): void;
  onReasoningEnd(): void;
  onToolCall(call: HarnessToolCall): void;
  onToolResult(result: { id: string; name: string; output: unknown }): void;
  onUsage(usage: { input: number; output: number }): void;
  onStep(step: number): void;
  onRetry(attempt: number, max: number): void;
}

export function toolSchemasFor(tools: ToolSet): AgentToolSchema[] {
  return Object.entries(tools).map(([name, tool]) => {
    const definition = tool as {
      description?: string;
      inputSchema?: { jsonSchema?: unknown };
    };
    return {
      name,
      description: definition.description ?? "",
      input_schema: definition.inputSchema?.jsonSchema ??
        definition.inputSchema ?? { type: "object", properties: {} },
    };
  });
}

function partsFromContent(content: unknown): AgentContentPart[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts: AgentContentPart[] = [];
  for (const raw of content) {
    const part = raw as Record<string, unknown>;
    switch (part.type) {
      case "text":
        if (part.text) parts.push({ type: "text", text: String(part.text) });
        break;
      case "image":
        parts.push({ type: "image", image: String(part.image) });
        break;
      case "tool-call":
        parts.push({
          type: "toolUse",
          id: String(part.toolCallId),
          name: String(part.toolName),
          arguments: JSON.stringify(part.input ?? {}),
        });
        break;
      case "tool-result": {
        const output = part.output as { value?: unknown } | undefined;
        const value = output && "value" in output ? output.value : part.output;
        parts.push({
          type: "toolResult",
          id: String(part.toolCallId),
          name: String(part.toolName),
          output: typeof value === "string" ? value : JSON.stringify(value ?? null),
        });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}

export function toAgentMessages(messages: ModelMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const message of messages) {
    const parts = partsFromContent(message.content);
    if (!parts.length) continue;
    out.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: parts,
    });
  }
  return out;
}

export function packToolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output ?? null);
  } catch {
    return String(output);
  }
}

export async function runAgentHarness(args: {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  signal: AbortSignal;
  config?: AgentRunConfig;
  providerOverride?: { provider_id: string; model_id: string };
  takePendingImages?: () => string[];
  handlers: HarnessHandlers;
}): Promise<AgentRunOutcome> {
  const { handlers } = args;
  const names = new Map<string, string>();
  let reasoningOpen = false;

  const endReasoning = () => {
    if (!reasoningOpen) return;
    reasoningOpen = false;
    handlers.onReasoningEnd();
  };

  return runViaBackend(
    {
      system: args.system,
      messages: toAgentMessages(args.messages),
      tools: toolSchemasFor(args.tools),
    },
    {
      onEvent: (event) => {
        handlers.onActivity();
        switch (event.kind) {
          case "stepStart":
            handlers.onStep(event.step);
            handlers.onThinking(event.step === 0 ? "Thinking…" : "Continuing…");
            break;
          case "retry":
            handlers.onRetry(event.attempt, event.max);
            break;
          case "textDelta":
            endReasoning();
            handlers.onThinking(null);
            handlers.onText(event.text);
            break;
          case "reasoningDelta":
            if (!reasoningOpen) {
              reasoningOpen = true;
              handlers.onReasoningStart();
            }
            handlers.onThinking("Reasoning…");
            handlers.onReasoningDelta(event.text);
            break;
          case "toolCallStart":
            endReasoning();
            names.set(event.id, event.name);
            handlers.onThinking(`Running ${event.name}…`);
            break;
          case "usage":
            handlers.onUsage(event.usage);
            break;
          case "done":
            endReasoning();
            break;
          default:
            break;
        }
      },
      onToolRequest: async (call) => {
        endReasoning();
        names.set(call.id, call.name);
        let parsed: unknown = {};
        try {
          parsed = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          parsed = {};
        }
        handlers.onToolCall({ id: call.id, name: call.name, args: parsed });
        handlers.onThinking(`Running ${call.name}…`);

        const tool = args.tools[call.name] as
          | { execute?: (input: unknown) => Promise<unknown> }
          | undefined;

        let output: unknown;
        if (!tool?.execute) {
          output = { error: `Unknown tool: ${call.name}` };
        } else {
          try {
            output = await tool.execute(parsed as Record<string, unknown>);
          } catch (error) {
            output = { error: error instanceof Error ? error.message : String(error) };
          }
        }

        handlers.onToolResult({ id: call.id, name: call.name, output });
        handlers.onThinking("Processing result…");
        return {
          output: packToolOutputText(output),
          images: args.takePendingImages?.() ?? [],
        };
      },
    },
    args.signal,
    args.config,
    args.providerOverride,
  );
}
