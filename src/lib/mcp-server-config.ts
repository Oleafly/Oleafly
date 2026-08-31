import type { McpManagedServer, McpServerConfig } from "@oleafly/backend-port";

const ACCEPTED_JSON_FORMS =
  'Expected either {"server-name": {...}} or {"mcpServers": {"server-name": {...}}}.';

function structuralError(detail: string): Error {
  return new Error(`${detail} ${ACCEPTED_JSON_FORMS}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(
  server: Record<string, unknown>,
  name: string,
  field: "type" | "transport",
): string | undefined {
  if (!Object.hasOwn(server, field)) return undefined;
  if (typeof server[field] !== "string") {
    throw new Error(`MCP server '${name}' field '${field}' must be a string.`);
  }
  return server[field];
}

function enabledValue(server: Record<string, unknown>, name: string): boolean {
  if (!Object.hasOwn(server, "enabled")) return true;
  if (typeof server.enabled !== "boolean") {
    throw new Error(`MCP server '${name}' field 'enabled' must be a boolean.`);
  }
  return server.enabled;
}

function stringValue(server: Record<string, unknown>, name: string, field: string): string {
  if (typeof server[field] !== "string") {
    throw new Error(`MCP server '${name}' field '${field}' must be a string.`);
  }
  return server[field];
}

function stringArrayValue(
  server: Record<string, unknown>,
  name: string,
  field: string,
): string[] {
  if (!Object.hasOwn(server, field)) return [];
  const value = server[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`MCP server '${name}' field '${field}' must be an array of strings.`);
  }
  return value;
}

function stringRecordValue(
  server: Record<string, unknown>,
  name: string,
  field: string,
): Record<string, string> {
  if (!Object.hasOwn(server, field)) return {};
  const value = server[field];
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new Error(
      `MCP server '${name}' field '${field}' must be an object of string values.`,
    );
  }
  return value as Record<string, string>;
}

export function parseMcpServerJson(source: string): McpServerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw structuralError("MCP server JSON is malformed.");
  }
  if (!isRecord(parsed)) {
    throw structuralError("MCP server JSON must be an object.");
  }
  const root = parsed;
  let servers: Record<string, unknown> = root;
  if (Object.hasOwn(root, "mcpServers")) {
    if (!isRecord(root.mcpServers)) {
      throw structuralError("MCP server JSON field 'mcpServers' must be an object.");
    }
    servers = root.mcpServers;
  }
  const entries = Object.entries(servers);
  if (entries.length !== 1) {
    throw structuralError("MCP server JSON must contain exactly one server.");
  }
  const [entryName, server] = entries[0];
  const name = entryName.trim();
  if (!isRecord(server)) {
    throw structuralError(`MCP server '${name}' must be an object.`);
  }
  const type = optionalString(server, name, "type");
  const transport = optionalString(server, name, "transport");
  if (
    type !== undefined &&
    type !== "stdio" &&
    type !== "http" &&
    type !== "sse" &&
    type !== "streamable-http"
  ) {
    throw new Error(`MCP server '${name}' has unsupported type '${type}'.`);
  }
  if (transport !== undefined && transport !== "stdio" && transport !== "remote") {
    throw new Error(`MCP server '${name}' has unsupported transport '${transport}'.`);
  }
  const typeIsRemote = type === "http" || type === "sse" || type === "streamable-http";
  if (
    type !== undefined &&
    transport !== undefined &&
    ((type === "stdio" && transport !== "stdio") || (typeIsRemote && transport !== "remote"))
  ) {
    throw new Error(`MCP server '${name}' has conflicting type and transport declarations.`);
  }
  const enabled = enabledValue(server, name);
  const remote =
    transport === "remote" ||
    typeIsRemote ||
    (type === undefined && transport === undefined && Object.hasOwn(server, "url"));
  if (remote) {
    return {
      name,
      enabled,
      transport: "remote",
      url: stringValue(server, name, "url").trim(),
      headers: stringRecordValue(server, name, "headers"),
    };
  }
  return {
    name,
    enabled,
    transport: "stdio",
    command: stringValue(server, name, "command").trim(),
    args: stringArrayValue(server, name, "args"),
    env: stringRecordValue(server, name, "env"),
  };
}

export function serializeMcpServerJson(config: McpServerConfig): string {
  const { name, ...server } = config;
  return JSON.stringify({ [name]: server }, null, 2);
}

export type McpServerDuplicateAction = "skip" | "overwrite";

export interface McpServerImportOperations {
  existingNames: readonly string[];
  duplicateAction: McpServerDuplicateAction;
  add: (config: McpServerConfig) => Promise<McpManagedServer>;
  update: (originalName: string, config: McpServerConfig) => Promise<McpManagedServer>;
}

export interface McpServerImportFailure {
  name: string;
  reason: string;
}

export interface McpServerImportResult {
  imported: number;
  skipped: number;
  failed: number;
  failures: McpServerImportFailure[];
  records: McpManagedServer[];
}

function normalizeMcpServerConfig(config: McpServerConfig): McpServerConfig {
  return parseMcpServerJson(serializeMcpServerJson(config));
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function importCandidateName(candidate: unknown): string {
  if (!isRecord(candidate) || typeof candidate.name !== "string") return "Unknown server";
  return candidate.name.trim() || "Unknown server";
}

export async function runMcpServerImport(
  candidates: readonly McpServerConfig[],
  operations: McpServerImportOperations,
): Promise<McpServerImportResult> {
  const knownNames = new Set(operations.existingNames);
  const result: McpServerImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    records: [],
  };
  for (const candidate of candidates) {
    let config: McpServerConfig;
    try {
      config = normalizeMcpServerConfig(candidate);
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        name: importCandidateName(candidate),
        reason: failureReason(error),
      });
      continue;
    }
    const duplicate = knownNames.has(config.name);
    if (duplicate && operations.duplicateAction === "skip") {
      result.skipped += 1;
      continue;
    }
    try {
      const record = duplicate
        ? await operations.update(config.name, config)
        : await operations.add(config);
      knownNames.add(config.name);
      result.imported += 1;
      result.records.push(record);
    } catch (error) {
      result.failed += 1;
      result.failures.push({ name: config.name, reason: failureReason(error) });
    }
  }
  return result;
}
