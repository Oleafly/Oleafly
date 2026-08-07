import { Channel, invoke } from "@tauri-apps/api/core";

// One-shot completions routed through the Rust agent crate.
//
// The point of this path is that the provider credential never reaches the
// webview: the backend reads it from the config, calls the provider, and
// returns only the text. The in-webview AI SDK path still exists behind
// `OLEAFLY_AGENT=ts` so the two can be compared on a single build.

export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string };

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
}

export interface AgentCompletionResponse {
  text: string;
  usage: { input: number; output: number };
  provider_id: string;
  model_id: string;
}

let backendPromise: Promise<string> | null = null;

/**
 * Whether AI calls should go through Rust. Resolved once per session: the
 * backend reads an environment variable that cannot change while the app runs.
 */
export async function rustAgentEnabled(): Promise<boolean> {
  if (!backendPromise) {
    // A failure here means the command is missing, which is only possible on a
    // build without the Rust path. Falling back to TypeScript is the safe read.
    backendPromise = invoke<string>("agent_backend").catch(() => "ts");
  }
  return (await backendPromise) === "rust";
}

/** Test seam: forget the cached backend choice. */
export function resetAgentBackendCache(): void {
  backendPromise = null;
}

let counter = 0;

function nextRequestId(): string {
  counter += 1;
  return `agent-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

// Settle on abort rather than waiting for the backend to notice. A wedged
// connection would otherwise leave the caller hanging after the user gave up.
function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    }),
  ]);
}

/**
 * Run a completion in the backend, honouring an abort signal.
 *
 * Aborting tells Rust to drop the in-flight request rather than leaving it to
 * finish into a void, which matters for long reasoning calls the user cancels.
 */
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
    // The backend reports a cancelled request as a normal error. Callers
    // distinguish an abort by its name, so restore that here.
    if (signal?.aborted) throw abortError();
    throw new Error(typeof error === "string" ? error : String(error));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export type AgentEvent =
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

/** The common case: a system prompt and one user message, returning text. */
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
