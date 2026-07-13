/**
 * MCP bridge: exposes the in-app agent tools to the Rust MCP server.
 *
 * The Rust side is a transport. On `tools/call` it emits `mcp:tool-call`;
 * this module executes the SAME tool implementations the chat panel uses
 * (same host adapter, same approval cards) and replies via `mcp_tool_result`.
 * The advertised tool list is registered from here, so the MCP surface can
 * never drift from the in-app surface.
 */
import { listen } from "@tauri-apps/api/event";
import {
  createOpenLeafTools,
  createFigureTools,
  type ConfirmFn,
} from "@/lib/ai-tools";
import { isAutoApprovable } from "@/components/ai/ToolConfirm";
import { useMcpApprovalStore } from "@/store/mcp-approvals";
import {
  appendAppLog,
  appVersion,
  getConfig,
  listProjects,
  mcpRegisterTools,
  mcpToolResult,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";

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

/** Tools removed in read-only mode: anything that mutates the project or app. */
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
]);

/** The ai SDK wraps schemas via jsonSchema(); unwrap back to plain JSON. */
export function rawSchemaOf(schema: unknown): unknown {
  if (schema && typeof schema === "object" && "jsonSchema" in schema) {
    return (schema as { jsonSchema: unknown }).jsonSchema;
  }
  return schema;
}

export function toMcpResult(raw: unknown, images: string[]): McpResult {
  const content: McpContent[] = [];
  for (const dataUrl of images) {
    const comma = dataUrl.indexOf(",");
    content.push({
      type: "image",
      data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
      mimeType: "image/png",
    });
  }
  content.push({ type: "text", text: JSON.stringify(raw ?? {}) });
  const isError =
    typeof raw === "object" && raw !== null && "error" in (raw as Record<string, unknown>);
  return isError ? { content, isError: true } : { content };
}

/** MCP-only orientation tools: thin wrappers over existing app services. */
function createMcpOnlyTools(): Record<string, McpToolEntry> {
  return {
    get_status: {
      description:
        "Get the app status: OpenLeaf version, the currently open project, its main document, and the last compile outcome. Call this first to orient yourself.",
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
      description: "List all projects in the OpenLeaf library with their ids and names.",
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
          await useFilesStore.getState().openProject(id);
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
}): Record<string, McpToolEntry> {
  const all: Record<string, McpToolEntry> = {
    ...(createOpenLeafTools({ confirm: opts.confirm }) as Record<string, McpToolEntry>),
    ...(createFigureTools({ confirm: opts.confirm, onImage: opts.onImage }) as Record<
      string,
      McpToolEntry
    >),
    ...createMcpOnlyTools(),
  };
  if (opts.readOnly) {
    for (const name of MUTATING_TOOLS) delete all[name];
  }
  return all;
}

// ---- runtime wiring ----

let registry: Record<string, McpToolEntry> = {};
/** Images captured by figure tools during the current call (onImage callback). */
let pendingImages: string[] = [];
/** Serialize tool execution: the in-app chat runs tools serially too, and
 *  parallel writes to the same file would race. */
let chain: Promise<void> = Promise.resolve();
/** Guard against React Strict Mode double-mount starting two listeners. */
let bridgeLive = false;

const confirm: ConfirmFn = (req) => useMcpApprovalStore.getState().request(req);

/**
 * Map an approval policy to the confirm function the tools run with:
 * - "trust":       never prompt in OpenLeaf. The MCP client's own approval
 *                  (e.g. Claude's Allow/Deny) is the only gate, deletes included.
 * - "auto_writes": auto-approve edits; deletes and figure inserts still prompt
 *                  in OpenLeaf with a diff.
 * - "ask" (default): prompt in OpenLeaf for every change.
 */
export function confirmForPolicy(policy: string, request: ConfirmFn): ConfirmFn {
  if (policy === "trust") return async () => true;
  if (policy === "auto_writes") {
    return async (req) => (isAutoApprovable(req.tool) ? true : request(req));
  }
  return request;
}

async function rebuildRegistry(): Promise<void> {
  const cfg = await getConfig();
  registry = buildMcpToolRegistry({
    confirm: confirmForPolicy(cfg.mcp_approval_policy, confirm),
    readOnly: !!cfg.mcp_read_only,
    onImage: (dataUrl) => pendingImages.push(dataUrl),
  });
  await mcpRegisterTools(
    Object.entries(registry).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: rawSchemaOf(t.inputSchema),
    })),
  );
}

/** Re-register after Settings changes (policy, read-only). */
export async function refreshMcpRegistry(): Promise<void> {
  await rebuildRegistry();
}

async function handleCall(payload: {
  callId: number;
  name: string;
  arguments: Record<string, unknown>;
}): Promise<void> {
  const tool = registry[payload.name];
  let result: McpResult;
  if (!tool) {
    result = toMcpResult({ error: `tool not available: ${payload.name}` }, []);
  } else {
    pendingImages = [];
    try {
      const raw = await tool.execute(payload.arguments ?? {});
      result = toMcpResult(raw, pendingImages);
    } catch (e) {
      result = toMcpResult({ error: String(e) }, []);
    }
    pendingImages = [];
  }
  void appendAppLog(`[mcp] ${payload.name} ${result.isError ? "error" : "ok"}`).catch(() => {});
  await mcpToolResult(payload.callId, result).catch(() => {});
}

/** Start listening for forwarded calls and register the tool surface. */
export async function startMcpBridge(): Promise<() => void> {
  await rebuildRegistry();
  // Test hook: e2e (and devtools) can resolve the head of the MCP approval
  // queue without relying on Playwright click targeting inside the webview.
  // Use string verbs so eval bridges cannot coerce a bare `false` argument away.
  const w = window as unknown as {
    __mcpDecide?: (verb: string) => string;
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

  // Singleton listener: Strict Mode mounts effects twice; two listeners would
  // run every tools/call twice and leave zombie approval cards in the queue.
  if (!bridgeLive) {
    bridgeLive = true;
    await listen<{
      callId: number;
      name: string;
      arguments: Record<string, unknown>;
    }>("mcp:tool-call", (event) => {
      chain = chain.then(() => handleCall(event.payload)).catch(() => {});
    });
  }

  // No-op cleanup: the listener and test hooks are page-lifetime singletons.
  // React Strict Mode double-mounts would otherwise race a late first-mount
  // cleanup and delete hooks the second mount just installed.
  return () => {};
}
