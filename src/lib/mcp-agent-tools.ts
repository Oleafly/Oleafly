import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConfirmFn, ToolApprovalRequest } from "@/lib/ai-tools";
import type { RuntimeToolset } from "@/lib/ai-tool-availability";
import {
  mcpAgentToolAuthorize,
  mcpAgentToolCall,
  mcpAgentToolsList,
  type McpAgentServer,
} from "@/lib/tauri";

export const MCP_AGENT_TOOLS_QUERY_KEY = ["mcp-agent-tools"] as const;
const MCP_AGENT_TOOLS_CHANGED_EVENT = "oleafly:mcp-agent-tools-changed";
const MCP_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MCP_ARGUMENT_PREVIEW_MAX_LENGTH = 1_200;
const MCP_ARGUMENT_PREVIEW_MAX_STRING_LENGTH = 160;
const MCP_ARGUMENT_PREVIEW_MAX_DEPTH = 3;
const MCP_ARGUMENT_PREVIEW_MAX_ENTRIES = 12;
const REDACTED_VALUE = "[redacted]";
const TRUNCATED_VALUE = "[truncated]";
const CREDENTIAL_KEY_PARTS = [
  "accesskey",
  "accesstoken",
  "apikey",
  "authorization",
  "bearer",
  "clientsecret",
  "cookie",
  "credential",
  "idtoken",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "sessionid",
  "token",
] as const;

export interface McpApprovalDetails {
  server: string;
  tool: string;
  argumentsPreview: string;
}

interface McpToolsetOptions {
  confirm: ConfirmFn;
  onImage: (dataUrl: string) => void;
  projectId: () => string | null;
  runId: () => string | null;
  isActive: () => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCredentialKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return CREDENTIAL_KEY_PARTS.some(
    (part) =>
      normalized === part ||
      normalized.startsWith(part) ||
      normalized.endsWith(part),
  );
}

function truncatePreviewString(value: string): string {
  if (value.length <= MCP_ARGUMENT_PREVIEW_MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MCP_ARGUMENT_PREVIEW_MAX_STRING_LENGTH)}... ${TRUNCATED_VALUE}`;
}

function sanitizePreviewValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return truncatePreviewString(value);
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return TRUNCATED_VALUE;
  if (depth >= MCP_ARGUMENT_PREVIEW_MAX_DEPTH) return TRUNCATED_VALUE;
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MCP_ARGUMENT_PREVIEW_MAX_ENTRIES)
      .map((item) => sanitizePreviewValue(item, depth + 1, seen));
    if (value.length > MCP_ARGUMENT_PREVIEW_MAX_ENTRIES) {
      items.push(TRUNCATED_VALUE);
    }
    return items;
  }
  const entries = Object.entries(value);
  const preview: Record<string, unknown> = {};
  for (const [key, entry] of entries.slice(0, MCP_ARGUMENT_PREVIEW_MAX_ENTRIES)) {
    preview[key] = isCredentialKey(key)
      ? REDACTED_VALUE
      : sanitizePreviewValue(entry, depth + 1, seen);
  }
  if (entries.length > MCP_ARGUMENT_PREVIEW_MAX_ENTRIES) {
    preview["..."] = TRUNCATED_VALUE;
  }
  return preview;
}

export function createMcpArgumentPreview(input: Record<string, unknown>): string {
  const preview = JSON.stringify(sanitizePreviewValue(input, 0, new WeakSet()), null, 2);
  if (preview.length <= MCP_ARGUMENT_PREVIEW_MAX_LENGTH) return preview;
  const suffix = `\n... ${TRUNCATED_VALUE}`;
  return `${preview.slice(0, MCP_ARGUMENT_PREVIEW_MAX_LENGTH - suffix.length)}${suffix}`;
}

function sanitizeMcpOutput(
  value: unknown,
  onImage: (dataUrl: string) => void,
): unknown {
  if (!isRecord(value) || !Array.isArray(value.content)) return value;
  const content = value.content.map((part) => {
    if (!isRecord(part) || part.type !== "image") return part;
    const mimeType =
      typeof part.mimeType === "string" ? part.mimeType : part.mime_type;
    if (
      typeof mimeType === "string" &&
      MCP_IMAGE_MIME_TYPES.has(mimeType.toLowerCase()) &&
      typeof part.data === "string"
    ) {
      onImage(`data:${mimeType.toLowerCase()};base64,${part.data}`);
    }
    return { type: "text", text: "The MCP server returned an image." };
  });
  return { ...value, content };
}

export function useMcpAgentTools() {
  const query = useQuery({
    queryKey: MCP_AGENT_TOOLS_QUERY_KEY,
    queryFn: mcpAgentToolsList,
    staleTime: 15_000,
    retry: false,
    meta: { silent: true },
  });
  const refetch = query.refetch;
  useEffect(() => {
    const refresh = () => void refetch();
    window.addEventListener(MCP_AGENT_TOOLS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(MCP_AGENT_TOOLS_CHANGED_EVENT, refresh);
  }, [refetch]);
  return query;
}

export function notifyMcpAgentToolsChanged(): void {
  window.dispatchEvent(new Event(MCP_AGENT_TOOLS_CHANGED_EVENT));
}

export function createMcpRuntimeToolsets(
  servers: readonly McpAgentServer[],
  options: McpToolsetOptions,
): RuntimeToolset[] {
  return servers.flatMap((server) => {
    const tools = Object.fromEntries(
      server.tools.map((tool) => [
        tool.name,
        {
          description: tool.description ?? "",
          inputSchema: tool.input_schema,
          execute: async (input: unknown) => {
            const projectId = options.projectId();
            const runId = options.runId();
            if (!projectId || !runId || !options.isActive()) {
              return { error: "MCP tool call is no longer active." };
            }
            const argumentsRecord = isRecord(input) ? input : {};
            const approvalRequest: ToolApprovalRequest & {
              mcp: McpApprovalDetails;
            } = {
              tool: tool.name,
              summary: `Use ${tool.tool_handle} from the ${server.name} MCP server`,
              mcp: {
                server: server.name,
                tool: tool.tool_handle,
                argumentsPreview: createMcpArgumentPreview(argumentsRecord),
              },
            };
            const approved = await options.confirm(approvalRequest);
            if (!approved) return { error: "MCP tool call was not approved." };
            if (
              !options.isActive() ||
              options.projectId() !== projectId ||
              options.runId() !== runId
            ) {
              return { error: "MCP tool call is no longer active." };
            }
            const approvalToken = await mcpAgentToolAuthorize(
              projectId,
              server.name,
              tool.tool_handle,
              argumentsRecord,
              runId,
            );
            if (
              !options.isActive() ||
              options.projectId() !== projectId ||
              options.runId() !== runId
            ) {
              return { error: "MCP tool call is no longer active." };
            }
            const result = await mcpAgentToolCall(
              projectId,
              server.name,
              tool.tool_handle,
              argumentsRecord,
              runId,
              approvalToken,
            );
            if (
              !options.isActive() ||
              options.projectId() !== projectId ||
              options.runId() !== runId
            ) {
              return { error: "MCP tool call is no longer active." };
            }
            return sanitizeMcpOutput(result, options.onImage);
          },
        },
      ]),
    );
    if (Object.keys(tools).length === 0) return [];
    return [
      {
        id: `mcp:${server.name}`,
        source: { kind: "mcp", server: server.name },
        tools,
      },
    ];
  });
}
