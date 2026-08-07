import { invoke } from "@tauri-apps/api/core";

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
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const onAbort = () => {
    void invoke("agent_cancel", { requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await invoke<AgentCompletionResponse>("agent_complete", {
      requestId,
      request,
      providerOverride: providerOverride ?? null,
    });
  } catch (error) {
    // The backend reports a cancelled request as a normal error. Callers
    // distinguish an abort by its name, so restore that here.
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new Error(typeof error === "string" ? error : String(error));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
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
