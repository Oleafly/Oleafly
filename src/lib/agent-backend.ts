import { Channel, invoke } from "@tauri-apps/api/core";

export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "toolUse"; id: string; name: string; arguments: string }
  | { type: "toolResult"; id: string; name: string; output: string };

export interface AgentToolSchema {
  name: string;
  description: string;
  input_schema: unknown;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: AgentContentPart[];
}

export interface AgentCompletionRequest {
  system?: string;
  messages: AgentMessage[];
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  tools?: AgentToolSchema[];
}

export interface AgentCompletionResponse {
  text: string;
  usage: { input: number; output: number };
  provider_id: string;
  model_id: string;
}

let counter = 0;

function nextRequestId(): string {
  counter += 1;
  return `agent-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    }),
  ]);
}

export async function completeViaBackend(
  request: AgentCompletionRequest,
  signal?: AbortSignal,
  providerOverride?: { provider_id: string; model_id: string },
): Promise<AgentCompletionResponse> {
  const requestId = nextRequestId();
  if (signal?.aborted) throw abortError();

  const onAbort = () => {
    void invoke("agent_cancel", { requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await withAbort(
      invoke<AgentCompletionResponse>("agent_complete", {
        requestId,
        request,
        providerOverride: providerOverride ?? null,
      }),
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new Error(typeof error === "string" ? error : String(error));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export type AgentEvent =
  | { kind: "stepStart"; step: number }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "toolRequest"; id: string; name: string; arguments: string }
  | { kind: "toolOutcome"; id: string; output: string }
  | { kind: "textDelta"; text: string }
  | { kind: "reasoningDelta"; text: string }
  | { kind: "toolCallStart"; id: string; name: string }
  | { kind: "toolCallArgsDelta"; id: string; json: string }
  | { kind: "toolCallEnd"; id: string; arguments: string }
  | { kind: "usage"; usage: { input: number; output: number } }
  | { kind: "done"; stopReason: string | null }
  | { kind: "error"; message: string; retryable: boolean };

export class AgentStreamError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "AgentStreamError";
    this.retryable = retryable;
  }
}

export async function streamViaBackend(
  request: AgentCompletionRequest,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  providerOverride?: { provider_id: string; model_id: string },
): Promise<void> {
  const requestId = nextRequestId();
  if (signal?.aborted) throw abortError();

  const onAbort = () => {
    void invoke("agent_cancel", { requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const channel = new Channel<AgentEvent>();
  let failure: AgentStreamError | null = null;
  channel.onmessage = (event) => {
    if (event.kind === "error") {
      failure = new AgentStreamError(event.message, event.retryable);
      return;
    }
    onEvent(event);
  };

  try {
    await withAbort(
      invoke("agent_stream", {
        requestId,
        request,
        providerOverride: providerOverride ?? null,
        onEvent: channel,
      }),
      signal,
    );
    if (signal?.aborted) throw abortError();
    if (failure) throw failure;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof AgentStreamError || error instanceof DOMException) throw error;
    throw new Error(typeof error === "string" ? error : String(error));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface AgentRunOutcome {
  text: string;
  usage: { input: number; output: number };
  steps: number;
  stopped_at_cap: boolean;
  error: string | null;
}

export interface AgentRunConfig {
  max_steps: number;
  max_retries: number;
  retry_base_ms: number;
}

export interface AgentToolRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentToolOutput {
  output: string;
  images?: string[];
}

export async function runViaBackend(
  request: AgentCompletionRequest,
  handlers: {
    onEvent: (event: AgentEvent) => void;
    onToolRequest: (call: AgentToolRequest) => Promise<AgentToolOutput>;
  },
  signal?: AbortSignal,
  config?: AgentRunConfig,
  providerOverride?: { provider_id: string; model_id: string },
): Promise<AgentRunOutcome> {
  const requestId = nextRequestId();
  if (signal?.aborted) throw abortError();

  const onAbort = () => {
    void invoke("agent_cancel", { requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const channel = new Channel<AgentEvent>();
  channel.onmessage = (event) => {
    if (event.kind === "toolRequest") {
      const call: AgentToolRequest = {
        id: event.id,
        name: event.name,
        arguments: event.arguments,
      };
      void handlers
        .onToolRequest(call)
        .catch<AgentToolOutput>((error) => ({
          output: JSON.stringify({ error: String(error) }),
        }))
        .then((output) =>
          invoke("agent_tool_result", {
            requestId,
            callId: call.id,
            output: { output: output.output, images: output.images ?? [] },
          }).catch(() => {}),
        );
      return;
    }
    handlers.onEvent(event);
  };

  try {
    return await withAbort(
      invoke<AgentRunOutcome>("agent_run", {
        requestId,
        request,
        config: config ?? null,
        providerOverride: providerOverride ?? null,
        onEvent: channel,
      }),
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new Error(typeof error === "string" ? error : String(error));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function streamText(args: {
  system?: string;
  user: string;
  temperature?: number;
  signal?: AbortSignal;
  onToken?: (full: string) => void;
}): Promise<string> {
  let full = "";
  await streamViaBackend(
    {
      system: args.system,
      messages: [{ role: "user", content: [{ type: "text", text: args.user }] }],
      temperature: args.temperature,
    },
    (event) => {
      if (event.kind !== "textDelta") return;
      full += event.text;
      args.onToken?.(full);
    },
    args.signal,
  );
  return full;
}

export async function completeText(args: {
  system?: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await completeViaBackend(
    {
      system: args.system,
      messages: [{ role: "user", content: [{ type: "text", text: args.user }] }],
      temperature: args.temperature,
      timeout_ms: args.timeoutMs,
    },
    args.signal,
  );
  return response.text;
}
