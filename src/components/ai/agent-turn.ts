import type { AgentUsage, EffortLevel, WebToggle } from "@oleafly/ai-core";
import { i18n } from "@/i18n";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import { packToolOutput, truncateText } from "@/lib/ai-context-pack";
import { logError } from "@/lib/log";

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

export interface UsageExtras {
  lastStep?: AgentUsage;
  contextWindow?: number;
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
  onUsage(usage: AgentUsage, extras?: UsageExtras): void;
  onStep(step: number): void;
  onRetry(attempt: number, max: number): void;
  onSubagentUpdate(update: Extract<AgentEvent, { kind: "subagentUpdate" }>): void;
  onSteered?(text: string): void;
  onNotice?(code: string, detail: string | null): void;
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
    const bytes = Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0);
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
    case "reasoning":
      return typeof part.text === "string" && part.text ? { type: "reasoning", text: part.text } : null;
    case "image":
      return { type: "image", image: String(part.image) };
    case "attachment":
      return typeof part.sha256 === "string" &&
        typeof part.name === "string" &&
        typeof part.mime === "string"
        ? { type: "attachment", sha256: part.sha256, name: part.name, mime: part.mime }
        : null;
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
    if (parts.every((part) => part.type === "reasoning")) continue;
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

export function appendStepText(content: string, chunk: string, stepStart: string): string {
  const firstChunkOfStep = content === stepStart;
  if (firstChunkOfStep && content.length > 0 && !/\s$/u.test(content) && !/^\s/u.test(chunk)) {
    return `${content}\n\n${chunk}`;
  }
  return content + chunk;
}

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
  projectId?: string | null;
  threadId?: string;
  clientTurnId?: string;
  onRequestId?: (id: string) => void;
  onRawEvent?: (event: AgentEvent) => void;
  guardToolCall?: (call: HarnessToolCall) => string | null;
  effort?: EffortLevel;
  web?: WebToggle;
  handlers: HarnessHandlers;
}): Promise<AgentRunOutcome> {
  const { handlers } = args;
  const names = new Map<string, string>();
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

  const request: Parameters<typeof runViaBackend>[0] = {
    system: args.system,
    messages: toAgentMessages(args.messages),
    tools: toolSchemasFor(args.tools),
  };
  if (args.effort) request.effort = args.effort;
  if (args.web && (args.web.search || args.web.fetch)) request.web = { ...args.web };

  return runViaBackend(
    request,
    {
      onEvent: (event) => {
        if (args.signal.aborted) return;
        args.onRawEvent?.(event);
        handlers.onActivity();
        switch (event.kind) {
          case "stepStart":
            handlers.onStep(event.step);
            handlers.onThinking(
              event.step === 0
                ? i18n.t(($) => $.ai.turn.thinking)
                : i18n.t(($) => $.ai.turn.continuing),
            );
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
            handlers.onThinking(i18n.t(($) => $.ai.turn.reasoning));
            handlers.onReasoningDelta(event.text);
            break;
          case "toolCallStart":
            endReasoning();
            names.set(event.id, event.name);
            handlers.onThinking(i18n.t(($) => $.ai.turn.runningTool, { name: event.name }));
            break;
          case "toolCallEnd":
            callArguments.set(event.id, parseJson(event.arguments));
            break;
          case "toolOutcome": {
            if (locallyExecuted.has(event.id)) break;
            const name = names.get(event.id) ?? "tool";
            void Promise.resolve(
              handlers.onToolCall({
                id: event.id,
                name,
                args: callArguments.get(event.id) ?? {},
              }),
            ).catch((error) => void logError("agent tool call", error));
            handlers.onToolResult({
              id: event.id,
              name,
              output: parseJson(event.output),
            });
            handlers.onThinking(i18n.t(($) => $.ai.turn.processingResult));
            break;
          }
          case "usage":
            handlers.onUsage(event.usage, {
              lastStep: event.lastStep ?? undefined,
              contextWindow: event.contextWindow ?? undefined,
            });
            break;
          case "notice":
            handlers.onNotice?.(event.code, event.detail ?? null);
            break;
          case "subagentUpdate":
            handlers.onActivity();
            handlers.onSubagentUpdate(event);
            break;
          case "compacted":
            handlers.onThinking(i18n.t(($) => $.ai.turn.summarizing));
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
        handlers.onThinking(i18n.t(($) => $.ai.turn.runningTool, { name: call.name }));

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
        handlers.onThinking(i18n.t(($) => $.ai.turn.processingResult));
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
