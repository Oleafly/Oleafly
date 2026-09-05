import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import { packToolOutput, truncateText } from "@/lib/ai-context-pack";

const ATTACHMENT_MAX_CHARS = 48_000;
import {
  runViaBackend,
  type AgentContentPart,
  type AgentEvent,
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
  onToolCall(call: HarnessToolCall): void | Promise<void>;
  onToolResult(result: { id: string; name: string; output: unknown }): void;
  onUsage(usage: { input: number; output: number }): void;
  onStep(step: number): void;
  onRetry(attempt: number, max: number): void;
  onSubagentUpdate(update: {
    id: string;
    label: string;
    state: string;
    detail: string | null;
  }): void;
  onSteered?(text: string): void;
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

const TEXT_FILE_EXTENSIONS = /\.(txt|tex|typ|bib|md|csv|json|ya?ml|toml|log)$/i;

function isTextAttachment(mediaType: string, name: string): boolean {
  if (mediaType.startsWith("text/")) return true;
  if (mediaType === "application/json") return true;
  return TEXT_FILE_EXTENSIONS.test(name);
}

function decodeDataUrl(dataUrl: string): string | null {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

export function fileAttachmentText(part: {
  data?: unknown;
  mediaType?: unknown;
  name?: unknown;
}): string {
  const name = typeof part.name === "string" && part.name ? part.name : "attachment";
  const mediaType = typeof part.mediaType === "string" ? part.mediaType : "";
  const data = typeof part.data === "string" ? part.data : "";
  if (isTextAttachment(mediaType, name)) {
    const text = data ? decodeDataUrl(data) : null;
    if (text !== null) {
      return `Attached file "${name}":\n\n${truncateText(text, ATTACHMENT_MAX_CHARS)}`;
    }
  }
  return `[The attachment "${name}" (${mediaType || "unknown type"}) could not be included. Only text based files are supported here. Ask the user to paste the relevant content instead.]`;
}

function toolUsePart(part: Record<string, unknown>): AgentContentPart {
  return {
    type: "toolUse",
    id: String(part.toolCallId),
    name: String(part.toolName),
    arguments: JSON.stringify(part.input ?? {}),
  };
}

function toolResultPart(part: Record<string, unknown>): AgentContentPart {
  const output = part.output as { value?: unknown } | undefined;
  const value = output && "value" in output ? output.value : part.output;
  return {
    type: "toolResult",
    id: String(part.toolCallId),
    name: String(part.toolName),
    output: typeof value === "string" ? value : JSON.stringify(value ?? null),
  };
}

function convertPart(part: Record<string, unknown>): AgentContentPart | null {
  switch (part.type) {
    case "text":
      return part.text ? { type: "text", text: String(part.text) } : null;
    case "image":
      return { type: "image", image: String(part.image) };
    case "file":
      return { type: "text", text: fileAttachmentText(part) };
    case "tool-call":
      return toolUsePart(part);
    case "tool-result":
      return toolResultPart(part);
    default:
      return null;
  }
}

function partsFromContent(content: unknown): AgentContentPart[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content
    .map((raw) => convertPart(raw as Record<string, unknown>))
    .filter((part): part is AgentContentPart => part !== null);
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
  const packed = packToolOutput(output);
  if (typeof packed === "string") return packed;
  try {
    return JSON.stringify(packed ?? null);
  } catch {
    return String(packed);
  }
}

const TOOL_REPLY_ID_PREFIX = /^tool-\d+-\d+-/;

export function providerCallIdFromToolReplyId(id: string): string {
  return id.replace(TOOL_REPLY_ID_PREFIX, "");
}

export async function runAgentHarness(args: {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  signal: AbortSignal;
  config?: AgentRunConfig;
  providerOverride?: { provider_id: string; model_id: string };
  takePendingImages?: () => string[];
  imageInstruction?: string;
  /** The project this run is pinned to; enables native backend tool dispatch. */
  projectId?: string | null;
  /** Thread the turn records into (rollouts + SQLite mirror). */
  threadId?: string;
  /** Client-generated turn id for the optimistic-turn rebind. */
  clientTurnId?: string;
  /** Backend request id, needed to steer or interrupt by id. */
  onRequestId?: (id: string) => void;
  /** Raw event tap (fold into the authoritative turn record). */
  onRawEvent?: (event: AgentEvent) => void;
  /**
   * Run-context guard, called before every tool execution. Returning a
   * message refuses the call with a structured error instead of executing —
   * the mechanism that keeps a run pinned to the project it started in.
   */
  guardToolCall?: (call: HarnessToolCall) => string | null;
  handlers: HarnessHandlers;
}): Promise<AgentRunOutcome> {
  const { handlers } = args;
  const names = new Map<string, string>();
  // Tools the webview executed itself (via onToolRequest); their toolOutcome
  // events must not render a second call/result pair.
  const locallyExecuted = new Set<string>();
  const callArguments = new Map<string, unknown>();
  let reasoningOpen = false;

  const parseJson = (raw: string): unknown => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return raw;
    }
  };

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
        if (args.signal.aborted) return;
        args.onRawEvent?.(event);
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
          case "toolCallEnd":
            callArguments.set(event.id, parseJson(event.arguments));
            break;
          case "toolOutcome": {
            // Natively executed tools never reach onToolRequest; render them
            // from the loop's own outcome event instead.
            if (locallyExecuted.has(event.id)) break;
            const name = names.get(event.id) ?? "tool";
            handlers.onToolCall({
              id: event.id,
              name,
              args: callArguments.get(event.id) ?? {},
            });
            handlers.onToolResult({
              id: event.id,
              name,
              output: parseJson(event.output),
            });
            handlers.onThinking("Processing result…");
            break;
          }
          case "usage":
            handlers.onUsage(event.usage);
            break;
          case "subagentUpdate":
            handlers.onActivity();
            handlers.onSubagentUpdate(event);
            break;
          case "compacted":
            handlers.onThinking("Summarizing earlier conversation…");
            break;
          case "steered":
            handlers.onActivity();
            handlers.onSteered?.(event.text);
            break;
          case "done":
            endReasoning();
            break;
          default:
            break;
        }
      },
      onToolRequest: async (call) => {
        if (args.signal.aborted) return { output: "" };
        endReasoning();
        // The request id is namespaced (tool-{gen}-{seq}-{providerId}) while
        // the loop's toolOutcome event carries the bare provider id; record
        // both so the outcome of a locally executed tool is not re-rendered.
        locallyExecuted.add(call.id);
        locallyExecuted.add(providerCallIdFromToolReplyId(call.id));
        names.set(call.id, call.name);
        let parsed: unknown = {};
        try {
          parsed = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          parsed = {};
        }
        await handlers.onToolCall({ id: call.id, name: call.name, args: parsed });
        handlers.onThinking(`Running ${call.name}…`);

        const tool = args.tools[call.name] as
          | { execute?: (input: unknown) => Promise<unknown> }
          | undefined;

        const refusal = args.guardToolCall?.({ id: call.id, name: call.name, args: parsed });
        let output: unknown;
        if (refusal) {
          output = { error: refusal };
        } else if (!tool?.execute) {
          output = { error: `Unknown tool: ${call.name}` };
        } else {
          try {
            output = await tool.execute(parsed as Record<string, unknown>);
          } catch (error) {
            output = { error: error instanceof Error ? error.message : String(error) };
          }
        }

        if (args.signal.aborted) return { output: "" };
        handlers.onToolResult({ id: call.id, name: call.name, output });
        handlers.onThinking("Processing result…");
        const images = args.takePendingImages?.() ?? [];
        let packed = packToolOutputText(output);
        if (images.length && args.imageInstruction) {
          packed = `${packed}\n\n${args.imageInstruction}`;
        }
        return { output: packed, images };
      },
    },
    args.signal,
    args.config,
    args.providerOverride,
    args.projectId ?? null,
    {
      threadId: args.threadId,
      clientTurnId: args.clientTurnId,
      onRequestId: args.onRequestId,
    },
  );
}
