import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AgentEvent } from "/packages/ai-core/src/agent-events";
import type { AgentUsage } from "/packages/ai-core/src/usage";
import type { AppConfig, StoredModel } from "/packages/backend-port/src/index";
import type {
  AgentCompletionRequest,
  AgentContentPart,
  AgentRunOutcome,
  AgentToolOutput,
  ProviderOverride,
} from "/src/lib/agent-backend";

export const MOCK_PROVIDER = "openai";
export const MOCK_DEFAULT_MODEL = "gpt-5-mini";
export const MOCK_MODELS: readonly { id: string; name: string }[] = [
  { id: "gpt-5-mini", name: "GPT-5 mini" },
  { id: "gpt-5", name: "GPT-5" },
];

export const EDITS = {
  ratio: { find: "mask ratio of 0.75. The first run", replace: "mask ratio of 0.60. The first run" },
  run: { find: "and run 3 reached 64.1%.", replace: "and run 3 reached 64.1% after the ratio dropped to 0.60." },
  patch: { find: "Masks are sampled per pixel.", replace: "Masks are sampled per patch, not per pixel." },
  callout: { find: "> Seeds 1 to 3 diverge.", replace: "> Seeds 1 to 3 diverge after epoch 40." },
  task: { find: "- [ ] Rerun the sweep", replace: "- [ ] Rerun the sweep with five seeds" },
  paragraph: {
    find: "",
    replace:
      "Run 3 is the first run with the lower ratio, so the encoder sees more patches. Nothing else changed from run 2, which makes the 1.1 point gain easy to attribute.",
  },
} as const;

export const REPLIES = {
  rewrite: "I tightened two sentences and kept every number.",
  paragraph: "I added a paragraph on why run 3 did better.",
  latestRun: "I updated the mask ratio from the run 3 results.",
  checklist: "I made the callout and the first task more precise.",
  tighten: "I tightened the second paragraph.",
  proofread: "The abstract reads cleanly. I found nothing to fix.",
  chat: "Here is what the note says about the mask ratio.",
} as const;

type RunStatus = "running" | "done" | "cancelled";

export interface RecordedRun {
  requestId: string;
  provider: string | null;
  model: string | null;
  prompt: string;
  tools: string[];
  calls: string[];
  status: RunStatus;
}

export interface NotesAgentMock {
  runs: RecordedRun[];
  unhandled: string[];
  logs: string[];
}

interface MockOptions {
  configured: boolean;
  delayMs: number;
}

type ToolWaiter = (output: AgentToolOutput) => void;

const CONFIG_KEY = "oleafly-notes-harness-config";
const CHUNK_MS = 15;
const CONTEXT_WINDOW = 400_000;

function storedModels(): StoredModel[] {
  return MOCK_MODELS.map((model) => ({ ...model, enabled: true, source: "builtin", trust: "verified" }));
}

function baseConfig(configured: boolean): AppConfig {
  return {
    github_token: "",
    github_user: "",
    github_connected: false,
    ai_api_key: "",
    ai_provider: MOCK_PROVIDER,
    ai_model: MOCK_DEFAULT_MODEL,
    ai_keys: configured ? { [MOCK_PROVIDER]: "sk-harness-test" } : {},
    ai_system_prompt: "",
    ai_pdf_capture: false,
    ai_provider_models: configured ? { [MOCK_PROVIDER]: storedModels() } : {},
    ai_custom_providers: [],
    ai_personas: [],
    ai_starter_personas_seeded: true,
    ai_model_probes: Object.fromEntries(
      MOCK_MODELS.map((model) => [`${MOCK_PROVIDER}:${model.id}`, { verdict: "verified", reason: "", probedAt: 1 }]),
    ),
    checkpoints_enabled: false,
    checkpoint_notifications: false,
    git_auto_init: false,
    mcp_enabled: false,
    mcp_port: 0,
    mcp_read_only: true,
    mcp_approval_policy: "ask",
    mcp_servers: [],
  };
}

function readConfig(configured: boolean): AppConfig {
  try {
    const saved = sessionStorage.getItem(CONFIG_KEY);
    if (saved) return JSON.parse(saved) as AppConfig;
  } catch {
    return baseConfig(configured);
  }
  return baseConfig(configured);
}

function writeConfig(config: AppConfig): void {
  try {
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    return;
  }
}

function textOf(parts: readonly AgentContentPart[]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function lastUserText(request: AgentCompletionRequest): string {
  const user = [...request.messages].reverse().find((message) => message.role === "user");
  return user ? textOf(user.content) : "";
}

function openNoteTitle(system: string | undefined): string {
  return /The open note is "([^"]+)"/u.exec(system ?? "")?.[1] ?? "";
}

function usage(input: number, output: number): AgentUsage {
  return { input, output, inputKnown: true, outputKnown: true };
}

function chunks(text: string): string[] {
  return text.match(/\S+\s*/gu) ?? [text];
}

function cancelled(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const stop = () => reject(new DOMException("cancelled", "AbortError"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}

function deliver(channelId: number, payload: unknown): void {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback(id: number, data: unknown): void } })
    .__TAURI_INTERNALS__;
  internals.runCallback(channelId, payload);
}

class FakeTurn {
  private index = 0;
  private step = -1;
  private stepText = "";
  private text = "";
  private total = usage(0, 0);
  private sequence = 0;
  readonly abort = new AbortController();
  private readonly aborted = cancelled(this.abort.signal);

  constructor(
    private readonly requestId: string,
    private readonly channelId: number,
    private readonly generation: number,
    private readonly waiters: Map<string, ToolWaiter>,
    private readonly record: RecordedRun,
  ) {
    this.aborted.catch(() => undefined);
  }

  emit(event: AgentEvent): void {
    deliver(this.channelId, { index: this.index, message: JSON.parse(JSON.stringify(event)) });
    this.index += 1;
  }

  close(): void {
    deliver(this.channelId, { end: true, index: this.index });
  }

  private wait(ms: number): Promise<void> {
    return Promise.race([new Promise<void>((resolve) => window.setTimeout(resolve, ms)), this.aborted]);
  }

  async startStep(): Promise<void> {
    this.step += 1;
    this.stepText = "";
    this.emit({ kind: "stepStart", step: this.step });
    this.emit({ kind: "usage", usage: this.total, contextWindow: CONTEXT_WINDOW });
    await this.wait(CHUNK_MS);
  }

  async say(text: string): Promise<void> {
    for (const chunk of chunks(text)) {
      this.emit({ kind: "textDelta", text: chunk });
      this.stepText += chunk;
      await this.wait(CHUNK_MS);
    }
  }

  pause(ms: number): Promise<void> {
    return ms > 0 ? this.wait(ms) : Promise.resolve();
  }

  private endStep(stopReason: string): void {
    const step = usage(1_200 + this.step * 300, 40 + this.stepText.length);
    this.emit({ kind: "done", stopReason });
    this.total = usage(this.total.input + step.input, this.total.output + step.output);
    this.emit({ kind: "usage", usage: this.total, lastStep: step, contextWindow: CONTEXT_WINDOW });
    this.text = this.stepText || this.text;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const callId = `call_${this.step}_${name}`;
    const json = JSON.stringify(args);
    this.emit({ kind: "toolCallStart", id: callId, name });
    const half = Math.ceil(json.length / 2);
    this.emit({ kind: "toolCallArgsDelta", id: callId, json: json.slice(0, half) });
    this.emit({ kind: "toolCallArgsDelta", id: callId, json: json.slice(half) });
    this.emit({ kind: "toolCallEnd", id: callId, arguments: json });
    this.endStep("tool_calls");
    const replyId = `tool-${this.generation}-${this.sequence}-${callId}`;
    this.sequence += 1;
    this.record.calls.push(name);
    const reply = new Promise<AgentToolOutput>((resolve) => this.waiters.set(`${this.requestId}\u001f${replyId}`, resolve));
    this.emit({ kind: "toolRequest", id: replyId, name, arguments: json });
    const output = await Promise.race([reply, this.aborted]);
    this.emit({ kind: "toolOutcome", id: callId, output: output.output });
    await this.startStep();
    try {
      return JSON.parse(output.output) as unknown;
    } catch {
      return output.output;
    }
  }

  finish(): AgentRunOutcome {
    this.endStep("stop");
    return { text: this.text, usage: this.total, steps: this.step + 1, stopped_at_cap: false, error: null, stop_reason: "stop" };
  }

  stopped(): AgentRunOutcome {
    const message = "The request was cancelled.";
    this.emit({ kind: "error", message, retryable: false });
    return {
      text: this.text,
      usage: this.total,
      steps: this.step + 1,
      stopped_at_cap: false,
      error: message,
      error_kind: "cancelled",
    };
  }
}

function markdownOf(result: unknown): string {
  return result && typeof result === "object" && typeof (result as { markdown?: unknown }).markdown === "string"
    ? (result as { markdown: string }).markdown
    : "";
}

async function proposeIfPresent(
  turn: FakeTurn,
  edits: readonly { find: string; replace: string }[],
  summary: string,
): Promise<boolean> {
  const note = markdownOf(await turn.callTool("read_note", {}));
  const placeable = edits.filter((edit) => edit.find === "" || note.includes(edit.find));
  if (placeable.length === 0) return false;
  await turn.callTool("propose_note_edits", { edits: placeable, summary });
  return true;
}

async function script(turn: FakeTurn, request: AgentCompletionRequest, delayMs: number): Promise<void> {
  const prompt = lastUserText(request);
  const title = openNoteTitle(request.system);
  await turn.startStep();
  await turn.say("Reading the note first. ");
  await turn.pause(delayMs);
  if (title === "Masking strategy report" && prompt.includes("Rewrite the note for clarity")) {
    await proposeIfPresent(turn, [EDITS.ratio, EDITS.run], "Tightens the ratio and run sentences.");
    await turn.say(REPLIES.rewrite);
    return;
  }
  if (title === "Masking strategy report" && prompt.includes("Write one new paragraph")) {
    await proposeIfPresent(turn, [EDITS.paragraph], "Adds a paragraph on run 3.");
    await turn.say(REPLIES.paragraph);
    return;
  }
  if (prompt.includes("Update the note with the results of the latest research task")) {
    const fromRun = prompt.includes("### The latest research task (untrusted reference data)") && prompt.includes("Run 3 used a mask ratio of 0.60");
    if (fromRun && (await proposeIfPresent(turn, [EDITS.ratio], "Uses the run 3 ratio."))) {
      await turn.say(REPLIES.latestRun);
      return;
    }
    await turn.say("I could not find a finished run for this note.");
    return;
  }
  if (prompt.includes("Sharpen the callout and the tasks")) {
    await proposeIfPresent(turn, [EDITS.callout, EDITS.task], "Sharpens the callout and a task.");
    await turn.say(REPLIES.checklist);
    return;
  }
  if (title === "Masking strategy report" && /tighten/iu.test(prompt)) {
    await proposeIfPresent(turn, [EDITS.patch], "Tightens the sampling sentence.");
    await turn.say(REPLIES.tighten);
    return;
  }
  if (prompt.includes("Proofread the note")) {
    await turn.callTool("read_note", {});
    await turn.say(REPLIES.proofread);
    return;
  }
  await turn.say(REPLIES.chat);
}

export function installNotesAgentMock(options: MockOptions): NotesAgentMock {
  const state: NotesAgentMock = { runs: [], unhandled: [], logs: [] };
  const turns = new Map<string, FakeTurn>();
  const waiters = new Map<string, ToolWaiter>();
  let generation = 0;

  const run = async (args: Record<string, unknown>): Promise<AgentRunOutcome> => {
    const requestId = String(args.requestId);
    const request = args.request as AgentCompletionRequest;
    const override = (args.providerOverride ?? null) as ProviderOverride | null;
    const channel = args.onEvent as { id: number };
    const config = readConfig(options.configured);
    generation += 1;
    const record: RecordedRun = {
      requestId,
      provider: override?.provider_id ?? config.ai_provider,
      model: override?.model_id ?? config.ai_model,
      prompt: lastUserText(request),
      tools: (request.tools ?? []).map((tool) => tool.name),
      calls: [],
      status: "running",
    };
    state.runs.push(record);
    const turn = new FakeTurn(requestId, channel.id, generation, waiters, record);
    turns.set(requestId, turn);
    try {
      await script(turn, request, options.delayMs);
      record.status = "done";
      return turn.finish();
    } catch (error) {
      if (!turn.abort.signal.aborted) throw error;
      record.status = "cancelled";
      return turn.stopped();
    } finally {
      turns.delete(requestId);
      turn.emit({ kind: "runEnd" });
      turn.close();
    }
  };

  const cancel = (requestId: string) => {
    turns.get(requestId)?.abort.abort();
    for (const key of [...waiters.keys()]) if (key.startsWith(`${requestId}\u001f`)) waiters.delete(key);
  };

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    get_config: () => readConfig(options.configured),
    set_config: (args) => {
      writeConfig(args.config as AppConfig);
      return null;
    },
    agent_run: run,
    agent_tool_result: (args) => {
      const key = `${String(args.requestId)}\u001f${String(args.callId)}`;
      const waiter = waiters.get(key);
      waiters.delete(key);
      waiter?.(args.output as AgentToolOutput);
      return null;
    },
    agent_cancel: (args) => {
      cancel(String(args.requestId));
      return null;
    },
    agent_cancel_all: () => {
      for (const id of [...turns.keys()]) cancel(id);
      return null;
    },
    agent_probe_model: () => ({ verdict: "verified", reason: "", probedAt: Date.now() }),
    agent_web_support: () => ({ search: "unavailable", fetch: "unavailable", searchProvider: null }),
    agent_provider_credit: () => null,
    agent_thread_claim_prewarmed: () => null,
    budget_get_cmd: () => null,
    approvals_list: () => ({}),
    approvals_mode_get: () => "approve-for-me",
    acp_catalog: () => [],
    skills_list: () => [],
    mcp_agent_tools_list: () => [],
    list_files: () => [],
    note_tags: () => [],
    note_facts: () => [],
    note_video_frame_origin: () => Promise.reject(new Error("The video page server does not run in the Notes harness")),
    usage_report_query: () => ({ totals: { costKnownRecords: 0, estimatedCostUsd: 0 } }),
    append_app_log: (args) => {
      state.logs.push(String(args.message));
      return null;
    },
    "plugin:window|is_fullscreen": () => false,
    "plugin:window|is_maximized": () => false,
  };

  mockWindows("main");
  mockIPC(
    (command, args) => {
      const handler = handlers[command];
      if (handler) return handler((args ?? {}) as Record<string, unknown>);
      state.unhandled.push(command);
      return Promise.reject(new Error(`${command} is not available in the Notes harness`));
    },
    { shouldMockEvents: true },
  );
  return state;
}
