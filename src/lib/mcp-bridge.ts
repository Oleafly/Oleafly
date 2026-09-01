// MCP bridge: exposes the in-app agent tools to the Rust MCP server.
//
// The Rust side is a transport. On `tools/call` it emits `mcp:tool-call`;
// this module executes the SAME tool implementations the chat panel uses
// (same host adapter, same approval cards) and replies via `mcp_tool_result`.
// The advertised tool list is registered from here, so the MCP surface can
// never drift from the in-app surface.
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import {
  createOleaflyTools,
  createFigureTools,
  type ConfirmFn,
} from "@/lib/ai-tools";
import { isAutoApprovable, useMcpApprovalStore } from "@/store/mcp-approvals";
import { summarizeMcpResult, useMcpActivityStore } from "@/store/mcp-activity";
import {
  appendAppLog,
  appVersion,
  getConfig,
  listProjects,
  mcpBeginRendererSession,
  mcpEndRendererSession,
  mcpRegisterTools,
  mcpRendererHeartbeat,
  mcpSetActiveProject,
  mcpStatus,
  mcpToolResult,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { E2E_HOOKS } from "@/lib/e2e-flags";

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
export interface McpResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpToolEntry {
  description: string;
  inputSchema: unknown;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

// Tools removed in read-only mode: anything that mutates the project or app.
const MUTATING_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "create_file",
  "rename_file",
  "delete_file",
  "set_main_doc",
  "insert_figure",
  "toggle_theme",
  "open_project",
  "update_todos",
  "remember_note",
  "forget_note",
  "run_command",
  "computer_use",
]);

const ALWAYS_PROMPT_TOOLS = new Set(["run_command", "computer_use"]);

export function rawSchemaOf(schema: unknown): unknown {
  if (schema && typeof schema === "object" && "jsonSchema" in schema) {
    return (schema as { jsonSchema: unknown }).jsonSchema;
  }
  return schema;
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
};

function validateSchemaValue(
  schema: JsonSchema,
  value: unknown,
  path: string,
  depth: number,
): string | null {
  if (depth > 12) return `${path} is nested too deeply`;
  const enumError = validateEnum(schema.enum, value, path);
  if (enumError) return enumError;
  switch (schema.type) {
    case "object":
      return validateObjectSchema(schema, value, path, depth);
    case "array":
      return validateArraySchema(schema, value, path, depth);
    case "string":
      return validateStringSchema(schema, value, path);
    case "number":
    case "integer":
      return validateNumberSchema(schema, value, path);
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    default:
      return null;
  }
}

function validateEnum(values: unknown[] | undefined, value: unknown, path: string): string | null {
  if (!values) return null;
  return values.some((candidate) => Object.is(candidate, value))
    ? null
    : `${path} must be one of the advertised values`;
}

function validateObjectSchema(
  schema: JsonSchema,
  value: unknown,
  path: string,
  depth: number,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${path} must be an object`;
  }
  const record = value as Record<string, unknown>;
  const requiredError = validateRequiredProperties(schema, record, path);
  if (requiredError) return requiredError;
  const unknownError = validateKnownProperties(schema, record, path);
  if (unknownError) return unknownError;
  return validateChildProperties(schema, record, path, depth);
}

function validateRequiredProperties(
  schema: JsonSchema,
  record: Record<string, unknown>,
  path: string,
): string | null {
  const missing = (schema.required ?? []).find((required) => !Object.hasOwn(record, required));
  return missing ? `${path}.${missing} is required` : null;
}

function validateKnownProperties(
  schema: JsonSchema,
  record: Record<string, unknown>,
  path: string,
): string | null {
  if (schema.additionalProperties !== false) return null;
  const unknown = Object.keys(record).find(
    (key) => !Object.hasOwn(schema.properties ?? {}, key),
  );
  return unknown ? `${path}.${unknown} is not allowed` : null;
}

function validateChildProperties(
  schema: JsonSchema,
  record: Record<string, unknown>,
  path: string,
  depth: number,
): string | null {
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (!Object.hasOwn(record, key)) continue;
    const error = validateSchemaValue(child, record[key], `${path}.${key}`, depth + 1);
    if (error) return error;
  }
  return null;
}

function validateArraySchema(
  schema: JsonSchema,
  value: unknown,
  path: string,
  depth: number,
): string | null {
  if (!Array.isArray(value)) return `${path} must be an array`;
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    return `${path} must contain at least ${schema.minItems} items`;
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    return `${path} must contain at most ${schema.maxItems} items`;
  }
  if (!schema.items) return null;
  for (let index = 0; index < value.length; index += 1) {
    const error = validateSchemaValue(schema.items, value[index], `${path}[${index}]`, depth + 1);
    if (error) return error;
  }
  return null;
}

function validateStringSchema(schema: JsonSchema, value: unknown, path: string): string | null {
  if (typeof value !== "string") return `${path} must be a string`;
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    return `${path} must contain at least ${schema.minLength} characters`;
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    return `${path} must contain at most ${schema.maxLength} characters`;
  }
  return null;
}

function validateNumberSchema(schema: JsonSchema, value: unknown, path: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
  if (schema.type === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
  if (schema.minimum !== undefined && value < schema.minimum) {
    return `${path} must be at least ${schema.minimum}`;
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return `${path} must be at most ${schema.maximum}`;
  }
  return null;
}

export function validateToolInput(schema: unknown, input: unknown): string | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return "tool schema is unavailable";
  }
  return validateSchemaValue(schema as JsonSchema, input, "arguments", 0);
}

export function toMcpResult(raw: unknown, images: string[]): McpResult {
  const MAX_RESULT_TEXT_CHARS = 2 * 1024 * 1024;
  const content: McpContent[] = [];
  for (const dataUrl of images) {
    const comma = dataUrl.indexOf(",");
    const mimeMatch = /^data:(image\/(?:png|jpeg|gif));base64,/i.exec(dataUrl);
    content.push({
      type: "image",
      data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
      mimeType: mimeMatch?.[1].toLowerCase() ?? "image/png",
    });
  }
  let text: string;
  let serializationError = false;
  try {
    text = JSON.stringify(raw ?? {});
  } catch {
    text = JSON.stringify({ error: "Tool result could not be serialized." });
    serializationError = true;
  }
  if (text.length > MAX_RESULT_TEXT_CHARS) {
    text = JSON.stringify({
      error: `Tool result exceeds the ${MAX_RESULT_TEXT_CHARS / (1024 * 1024)} MiB response limit. Narrow the request and retry.`,
    });
    serializationError = true;
  }
  content.push({ type: "text", text });
  const isError = serializationError ||
    typeof raw === "object" && raw !== null && "error" in (raw as Record<string, unknown>);
  return isError ? { content, isError: true } : { content };
}

// MCP-only orientation tools: thin wrappers over existing app services.
function createMcpOnlyTools(
  confirm: ConfirmFn,
  mutationAllowed: () => boolean,
): Record<string, McpToolEntry> {
  return {
    get_status: {
      description:
        "Get the app status: Oleafly version, the currently open project, its main document, and the last compile outcome. Call this first to orient yourself.",
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      execute: async () => {
        const files = useFilesStore.getState();
        const compile = useCompileStore.getState();
        return {
          app_version: await appVersion().catch(() => "unknown"),
          project_id: files.projectId,
          main_doc: files.mainDoc ?? null,
          compile_status: compile.status,
        };
      },
    },
    list_projects: {
      description: "List all projects in the Oleafly library with their ids and names.",
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      execute: async () => {
        try {
          return { projects: await listProjects() };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
    open_project: {
      description:
        "Open a project by id (see list_projects). All other tools operate on the currently open project.",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "string", description: "The project id to open" } },
        required: ["project_id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const id = input.project_id as string;
        try {
          const known = await listProjects();
          if (!known.some((p) => p.id === id)) {
            return { error: `unknown project id: ${id}` };
          }
          if (!(await confirm({ tool: "open_project", summary: `Open project ${id}` }))) {
            return { error: "The user declined this change.", declined: true };
          }
          if (!mutationAllowed()) {
            return { error: "MCP request was cancelled before opening the project." };
          }
          await useFilesStore.getState().openProject(id, mutationAllowed);
          const files = useFilesStore.getState();
          if (files.projectId !== id || files.loading) {
            return { error: `Project ${id} could not be opened.` };
          }
          return { success: true, project_id: id };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  };
}

export function buildMcpToolRegistry(opts: {
  confirm: ConfirmFn;
  readOnly: boolean;
  onImage: (dataUrl: string) => void;
  mutationAllowed?: () => boolean;
}): Record<string, McpToolEntry> {
  const all: Record<string, McpToolEntry> = {
    ...(createOleaflyTools({
      confirm: opts.confirm,
      mutationAllowed: opts.mutationAllowed,
      alwaysConfirmComputerUse: true,
    }) as Record<string, McpToolEntry>),
    ...(createFigureTools({
      confirm: opts.confirm,
      onImage: opts.onImage,
      mutationAllowed: opts.mutationAllowed,
    }) as Record<
      string,
      McpToolEntry
    >),
    ...createMcpOnlyTools(opts.confirm, opts.mutationAllowed ?? (() => true)),
  };
  if (opts.readOnly) {
    for (const name of MUTATING_TOOLS) delete all[name];
  }
  return all;
}

// ---- runtime wiring ----

const bridgeCalls = {
  registry: {} as Record<string, McpToolEntry>,
  registryReady: false,
  registryBuildChain: Promise.resolve() as Promise<void>,
  // Images captured by figure tools during the current call (onImage callback).
  pendingImages: [] as string[],
  pendingImageChars: 0,
  // Serialize tool execution just like the in-app chat; parallel writes to the
  // same file would race.
  executionChain: Promise.resolve() as Promise<void>,
  queuedCalls: 0,
  generation: 0,
  activeGeneration: null as number | null,
  activeKey: null as string | null,
  admittedKeys: new Set<string>(),
  cancelledKeys: new Set<string>(),
  nativeActivityLogs: new Map<string, number>(),
};
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;
const MAX_AGGREGATE_IMAGE_CHARS = 16 * 1024 * 1024;
const MAX_QUEUED_CALLS = 4;
const rendererRuntime = {
  listenersReady: null as Promise<void> | null,
  startupReady: null as Promise<void> | null,
  sessionReady: null as Promise<number> | null,
  heartbeatTimer: null as number | null,
  heartbeatInFlight: false,
  superseded: false,
  pageLifecycleInstalled: false,
  latestServerEpoch: 0,
};
let rendererSession: number | null = null;
const RENDERER_HEARTBEAT_MS = 5_000;

function nativeActivityKey(epoch: number, activityId: string): string {
  return `${epoch}:${activityId}`;
}

function toolCallKey(rendererSession: number, epoch: number, callId: number): string {
  return `${rendererSession}:${epoch}:${callId}`;
}

function cancelNativeActivityLogs(epoch?: number): void {
  for (const [key, logId] of bridgeCalls.nativeActivityLogs) {
    if (epoch !== undefined && !key.startsWith(`${epoch}:`)) continue;
    useMcpActivityStore.getState().endCall(logId, {
      ok: false,
      summary: "cancelled because the MCP server stopped",
    });
    bridgeCalls.nativeActivityLogs.delete(key);
  }
}

const confirm: ConfirmFn = async (req) => {
  const generation = bridgeCalls.activeGeneration;
  const callKey = bridgeCalls.activeKey;
  const approved = await useMcpApprovalStore.getState().request(req);
  return (
    approved &&
    generation !== null &&
    generation === bridgeCalls.generation &&
    callKey !== null &&
    callKey === bridgeCalls.activeKey &&
    !bridgeCalls.cancelledKeys.has(callKey)
  );
};

function mutationAllowed(): boolean {
  return (
    bridgeCalls.activeGeneration !== null &&
    bridgeCalls.activeGeneration === bridgeCalls.generation &&
    bridgeCalls.activeKey !== null &&
    !bridgeCalls.cancelledKeys.has(bridgeCalls.activeKey)
  );
}

function invalidateMcpBridgeCalls(preserveRegistry: boolean): void {
  bridgeCalls.generation += 1;
  bridgeCalls.activeGeneration = null;
  bridgeCalls.activeKey = null;
  bridgeCalls.cancelledKeys.clear();
  if (!preserveRegistry) {
    bridgeCalls.registryReady = false;
    bridgeCalls.registry = {};
  }
  bridgeCalls.pendingImages = [];
  bridgeCalls.pendingImageChars = 0;
  useMcpApprovalStore.getState().cancelAll();
}

export function revokeMcpBridgeCalls(): void {
  invalidateMcpBridgeCalls(false);
}

function stopRendererHeartbeat(): void {
  if (rendererRuntime.heartbeatTimer !== null) {
    window.clearInterval(rendererRuntime.heartbeatTimer);
    rendererRuntime.heartbeatTimer = null;
  }
}

function supersedeRendererSession(): void {
  rendererRuntime.superseded = true;
  rendererSession = null;
  rendererRuntime.sessionReady = null;
  stopRendererHeartbeat();
  revokeMcpBridgeCalls();
}

function isStaleRendererError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("stale MCP renderer session") ||
    message.includes("MCP renderer lease is unavailable")
  );
}

export function confirmForPolicy(policy: string, request: ConfirmFn): ConfirmFn {
  if (policy === "trust") {
    return async (req) => (ALWAYS_PROMPT_TOOLS.has(req.tool) ? request(req) : true);
  }
  if (policy === "auto_writes") {
    return async (req) => (isAutoApprovable(req.tool) ? true : request(req));
  }
  return request;
}

function captureImage(dataUrl: string): void {
  if (
    dataUrl.length > MAX_IMAGE_CHARS ||
    bridgeCalls.pendingImageChars + dataUrl.length > MAX_AGGREGATE_IMAGE_CHARS
  ) {
    return;
  }
  bridgeCalls.pendingImages.push(dataUrl);
  bridgeCalls.pendingImageChars += dataUrl.length;
}

function rebuildRegistry(): Promise<void> {
  const generation = bridgeCalls.generation;
  const session = rendererSession;
  bridgeCalls.registryReady = false;
  bridgeCalls.registry = {};
  const build = bridgeCalls.registryBuildChain
    .catch(() => {})
    .then(() => buildRegistry(generation, session));
  bridgeCalls.registryBuildChain = build.catch(() => {});
  return build;
}

function bridgeSessionIsCurrent(generation: number, session: number | null): session is number {
  return generation === bridgeCalls.generation && session !== null && session === rendererSession;
}

async function buildRegistry(generation: number, session: number | null): Promise<void> {
  if (!bridgeSessionIsCurrent(generation, session)) return;
  const cfg = await getConfig();
  if (!bridgeSessionIsCurrent(generation, session)) return;
  const nextRegistry = buildMcpToolRegistry({
    confirm: confirmForPolicy(cfg.mcp_approval_policy, confirm),
    readOnly: !!cfg.mcp_read_only,
    onImage: captureImage,
    mutationAllowed,
  });
  try {
    await mcpRegisterTools(
      Object.entries(nextRegistry).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: rawSchemaOf(tool.inputSchema),
      })),
      session,
    );
  } catch (error) {
    if (session === rendererSession && isStaleRendererError(error)) {
      supersedeRendererSession();
    }
    throw error;
  }
  if (!bridgeSessionIsCurrent(generation, session)) return;
  bridgeCalls.registry = nextRegistry;
  bridgeCalls.registryReady = true;
}

export async function refreshMcpRegistry(): Promise<void> {
  await ensureMcpListeners();
  await ensureRendererSession();
  await mcpSetActiveProject(useFilesStore.getState().projectId);
  revokeMcpBridgeCalls();
  await rebuildRegistry();
}


async function handleCall(payload: {
  callId: number;
  epoch: number;
  rendererSession: number;
  name: string;
  arguments: Record<string, unknown>;
}, generation: number): Promise<void> {
  const callKey = toolCallKey(payload.rendererSession, payload.epoch, payload.callId);
  if (
    generation !== bridgeCalls.generation ||
    payload.rendererSession !== rendererSession ||
    !bridgeCalls.registryReady ||
    bridgeCalls.cancelledKeys.has(callKey)
  ) {
    await mcpToolResult(
      payload.callId,
      toMcpResult({ error: "MCP request was cancelled because the server or policy changed." }, []),
      payload.rendererSession,
    ).catch(() => {});
    return;
  }
  bridgeCalls.activeGeneration = generation;
  bridgeCalls.activeKey = callKey;
  const args = payload.arguments ?? {};
  const toolName = payload.name.slice(0, 128);
  const logId = useMcpActivityStore.getState().beginCall(toolName, args);
  const tool = payload.name.length <= 128 ? bridgeCalls.registry[payload.name] : undefined;
  let result: McpResult;
  let summary: string | undefined;
  try {
    if (!tool) {
      result = toMcpResult({ error: `tool not available: ${toolName}` }, []);
      summary = `tool not available: ${toolName}`;
    } else {
      bridgeCalls.pendingImages = [];
      bridgeCalls.pendingImageChars = 0;
      try {
        const validationError = validateToolInput(rawSchemaOf(tool.inputSchema), args);
        let raw = validationError
          ? { error: `Invalid tool arguments: ${validationError}` }
          : await tool.execute(args);
        if (bridgeCalls.cancelledKeys.has(callKey)) {
          raw = { error: "MCP request was cancelled before the tool completed." };
          bridgeCalls.pendingImages = [];
          bridgeCalls.pendingImageChars = 0;
        }
        result = toMcpResult(raw, bridgeCalls.pendingImages);
        const textResult = result.content.find((part) => part.type === "text");
        summary = summarizeMcpResult(textResult?.text, result.isError);
      } catch (e) {
        result = toMcpResult({ error: String(e) }, []);
        summary = String(e);
      }
      bridgeCalls.pendingImages = [];
      bridgeCalls.pendingImageChars = 0;
    }
  } finally {
    if (bridgeCalls.activeGeneration === generation) bridgeCalls.activeGeneration = null;
    if (bridgeCalls.activeKey === callKey) bridgeCalls.activeKey = null;
  }
  useMcpActivityStore.getState().endCall(logId, {
    ok: !result.isError,
    summary,
  });
  void appendAppLog(`[mcp] ${toolName} ${result.isError ? "error" : "ok"}`).catch(() => {});
  await mcpToolResult(payload.callId, result, payload.rendererSession).catch(() => {});
}

async function ensureMcpListeners(): Promise<void> {
  if (!rendererRuntime.listenersReady) {
    rendererRuntime.listenersReady = (async () => {
      const unlisteners: UnlistenFn[] = [];
      const install = async <T>(name: string, handler: EventCallback<T>) => {
        unlisteners.push(await listen<T>(name, handler));
      };
      try {
        await install<{
          callId: number;
          epoch: number;
          rendererSession: number;
          name: string;
          arguments: Record<string, unknown>;
        }>("mcp:tool-call", (event) => {
          if (event.payload.rendererSession !== rendererSession) return;
          const generation = bridgeCalls.generation;
          if (!bridgeCalls.registryReady || bridgeCalls.queuedCalls >= MAX_QUEUED_CALLS) {
            void mcpToolResult(
              event.payload.callId,
              toMcpResult(
                {
                  error: bridgeCalls.registryReady
                    ? "MCP tool queue is full. Retry after current calls finish."
                    : "MCP tools are being refreshed. Retry shortly.",
                },
                [],
              ),
              event.payload.rendererSession,
            ).catch(() => {});
            return;
          }
          const callKey = toolCallKey(
            event.payload.rendererSession,
            event.payload.epoch,
            event.payload.callId,
          );
          bridgeCalls.admittedKeys.add(callKey);
          bridgeCalls.queuedCalls += 1;
          bridgeCalls.executionChain = bridgeCalls.executionChain
            .then(() => handleCall(event.payload, generation))
            .catch(() => {})
            .finally(() => {
              bridgeCalls.queuedCalls -= 1;
              bridgeCalls.admittedKeys.delete(callKey);
              bridgeCalls.cancelledKeys.delete(callKey);
            });
        });
        await install<{
          callId: number;
          epoch: number;
          rendererSession: number;
          reason: "client-disconnected" | "timeout";
        }>("mcp:tool-call-cancelled", (event) => {
          if (event.payload.rendererSession !== rendererSession) return;
          const callKey = toolCallKey(
            event.payload.rendererSession,
            event.payload.epoch,
            event.payload.callId,
          );
          if (!bridgeCalls.admittedKeys.has(callKey)) return;
          bridgeCalls.cancelledKeys.add(callKey);
          if (bridgeCalls.activeKey === callKey) {
            bridgeCalls.activeGeneration = null;
            bridgeCalls.activeKey = null;
            bridgeCalls.pendingImages = [];
            bridgeCalls.pendingImageChars = 0;
            useMcpApprovalStore.getState().cancelAll();
          }
        });
        await install<{ epoch: number }>("mcp:server-started", (event) => {
          if (event.payload.epoch < rendererRuntime.latestServerEpoch) return;
          rendererRuntime.latestServerEpoch = event.payload.epoch;
          useMcpActivityStore.getState().setServerRunning(true);
        });
        await install<{ epoch: number }>("mcp:server-stopped", (event) => {
          if (event.payload.epoch < rendererRuntime.latestServerEpoch) return;
          rendererRuntime.latestServerEpoch = event.payload.epoch;
          revokeMcpBridgeCalls();
          cancelNativeActivityLogs(event.payload.epoch);
          useMcpActivityStore.getState().setServerRunning(false);
        });
        await install<{
          epoch: number;
          rendererSession: number;
          reason:
            | "renderer-session-changed"
            | "renderer-lease-expired"
            | "tool-registry-changed"
            | "credential-regenerated";
        }>("mcp:requests-revoked", (event) => {
          const { reason, rendererSession: eventSession } = event.payload;
          if (reason === "renderer-session-changed") {
            if (rendererSession !== null && eventSession !== rendererSession) {
              supersedeRendererSession();
            }
            return;
          }
          if (eventSession !== rendererSession) return;
          if (reason === "tool-registry-changed") return;
          if (reason === "renderer-lease-expired") {
            invalidateMcpBridgeCalls(true);
            return;
          }
          revokeMcpBridgeCalls();
        });
        await install<{ activityId: string; epoch: number; name: string }>(
          "mcp:native-tool-started",
          (event) => {
            const { activityId, epoch, name } = event.payload;
            const key = nativeActivityKey(epoch, activityId);
            if (bridgeCalls.nativeActivityLogs.has(key)) return;
            bridgeCalls.nativeActivityLogs.set(key, useMcpActivityStore.getState().beginCall(name, {}));
          },
        );
        await install<{
          activityId: string;
          epoch: number;
          name: string;
          ok: boolean;
          cancelled: boolean;
        }>("mcp:native-tool-finished", (event) => {
          const { activityId, epoch, ok, cancelled } = event.payload;
          const key = nativeActivityKey(epoch, activityId);
          const logId = bridgeCalls.nativeActivityLogs.get(key);
          if (logId === undefined) return;
          bridgeCalls.nativeActivityLogs.delete(key);
          useMcpActivityStore.getState().endCall(logId, {
            ok,
            summary: cancelled ? "cancelled" : ok ? "ok" : "error",
          });
        });
      } catch (error) {
        for (const unlisten of unlisteners.reverse()) unlisten();
        throw error;
      }
    })().catch((error) => {
      rendererRuntime.listenersReady = null;
      throw error;
    });
  }
  await rendererRuntime.listenersReady;
}

async function heartbeatRendererSession(session: number): Promise<void> {
  if (rendererRuntime.heartbeatInFlight || rendererSession !== session) return;
  rendererRuntime.heartbeatInFlight = true;
  try {
    await mcpRendererHeartbeat(session);
    if (rendererSession === session && !bridgeCalls.registryReady) await rebuildRegistry();
  } catch (error) {
    if (rendererSession === session && isStaleRendererError(error)) {
      supersedeRendererSession();
    }
  } finally {
    rendererRuntime.heartbeatInFlight = false;
  }
}

function startRendererHeartbeat(session: number): void {
  stopRendererHeartbeat();
  rendererRuntime.heartbeatTimer = window.setInterval(() => {
    void heartbeatRendererSession(session);
  }, RENDERER_HEARTBEAT_MS);
}

async function disconnectRendererSession(): Promise<void> {
  const session = rendererSession;
  if (session === null) return;
  rendererSession = null;
  rendererRuntime.sessionReady = null;
  rendererRuntime.startupReady = null;
  stopRendererHeartbeat();
  await mcpEndRendererSession(session);
}

function installRendererPageLifecycle(): void {
  if (rendererRuntime.pageLifecycleInstalled) return;
  rendererRuntime.pageLifecycleInstalled = true;
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    void disconnectRendererSession().catch(() => {});
  });
}

async function ensureRendererSession(): Promise<number> {
  if (rendererRuntime.superseded) throw new Error("This renderer no longer owns the MCP session");
  if (rendererSession !== null) return rendererSession;
  if (!rendererRuntime.sessionReady) {
    revokeMcpBridgeCalls();
    rendererRuntime.sessionReady = mcpBeginRendererSession()
      .then((session) => {
        if (!Number.isSafeInteger(session) || session <= 0) {
          throw new Error("The MCP backend returned an invalid renderer session");
        }
        rendererSession = session;
        startRendererHeartbeat(session);
        installRendererPageLifecycle();
        return session;
      })
      .catch((error) => {
        rendererRuntime.sessionReady = null;
        throw error;
      });
  }
  return rendererRuntime.sessionReady;
}

async function initializeMcpBridge(): Promise<void> {
  await ensureMcpListeners();
  await ensureRendererSession();
  await mcpSetActiveProject(useFilesStore.getState().projectId);
  await rebuildRegistry();
  try {
    const status = await mcpStatus();
    useMcpActivityStore.getState().setServerRunning(status.running);
  } catch {
    useMcpActivityStore.getState().setServerRunning(false);
  }
}

export async function startMcpBridge(): Promise<() => void> {
  if (E2E_HOOKS) {
    const w = window as unknown as {
      __mcpDecide?: (verb: string) => string;
      __mcpDisconnectRenderer?: () => Promise<void>;
      __mcpStopHeartbeat?: () => void;
      __mcpQueue?: () => string[];
    };
    w.__mcpDecide = (verb) => {
      const head = useMcpApprovalStore.getState().queue[0];
      if (!head) return "empty";
      const ok = verb === "approve";
      useMcpApprovalStore.getState().decide(head.id, ok);
      return `${verb}:${head.req.tool}:id=${head.id}:left=${useMcpApprovalStore.getState().queue.length}`;
    };
    w.__mcpQueue = () =>
      useMcpApprovalStore.getState().queue.map((q) => `${q.id}:${q.req.tool}`);
    w.__mcpDisconnectRenderer = disconnectRendererSession;
    w.__mcpStopHeartbeat = stopRendererHeartbeat;
  }

  if (!rendererRuntime.startupReady) {
    rendererRuntime.startupReady = initializeMcpBridge().catch((error) => {
      rendererRuntime.startupReady = null;
      throw error;
    });
  }
  await rendererRuntime.startupReady;
  return () => {};
}
