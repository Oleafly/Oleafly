import { describe, expect, it } from "vitest";
import type { McpManagedServer, McpServerConfig } from "@oleafly/backend-port";
import {
  parseMcpServerJson,
  runMcpServerImport,
  serializeMcpServerJson,
} from "@/lib/mcp-server-config";

function connectedRecord(config: McpServerConfig): McpManagedServer {
  return {
    config,
    validation: {
      name: config.name,
      status: "connected",
      tool_count: 1,
      tools: [{ name: `${config.name}_tool`, description: null }],
      error: null,
    },
  };
}

function createMemoryOperations(
  initial: readonly McpServerConfig[] = [],
  rejectedNames: ReadonlySet<string> = new Set(),
) {
  const records = new Map(initial.map((config) => [config.name, connectedRecord(config)]));
  return {
    records,
    operations: {
      add: async (config: McpServerConfig) => {
        if (rejectedNames.has(config.name)) {
          throw new Error(`validation failed for ${config.name}`);
        }
        if (records.has(config.name)) throw new Error(`duplicate ${config.name}`);
        const record = connectedRecord(config);
        records.set(config.name, record);
        return record;
      },
      update: async (originalName: string, config: McpServerConfig) => {
        if (rejectedNames.has(config.name)) {
          throw new Error(`validation failed for ${config.name}`);
        }
        if (!records.has(originalName)) throw new Error(`missing ${originalName}`);
        records.delete(originalName);
        const record = connectedRecord(config);
        records.set(config.name, record);
        return record;
      },
    },
  };
}

describe("parseMcpServerJson", () => {
  it("normalizes one keyed stdio server", () => {
    const parsed = parseMcpServerJson(`{
      "papers": {
        "command": "npx",
        "args": ["-y", "@example/papers"],
        "env": { "PAPERS_TOKEN": "secret" }
      }
    }`);

    expect(parsed).toEqual({
      name: "papers",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/papers"],
      env: { PAPERS_TOKEN: "secret" },
    });
  });

  it("normalizes one stdio server inside an mcpServers wrapper", () => {
    const parsed = parseMcpServerJson(`{
      "mcpServers": {
        "local-search": {
          "type": "stdio",
          "command": "node",
          "args": ["server.js"],
          "env": {},
          "enabled": false
        }
      }
    }`);

    expect(parsed).toEqual({
      name: "local-search",
      enabled: false,
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: {},
    });
  });

  it("normalizes supported remote transport declarations", () => {
    const fixtures = [
      {
        source: `{"docs":{"type":"http","url":"https://docs.example/mcp","headers":{"Authorization":"Bearer token"}}}`,
        expected: {
          name: "docs",
          enabled: true,
          transport: "remote" as const,
          url: "https://docs.example/mcp",
          headers: { Authorization: "Bearer token" },
        },
      },
      {
        source: `{"events":{"type":"sse","url":"https://events.example/sse"}}`,
        expected: {
          name: "events",
          enabled: true,
          transport: "remote" as const,
          url: "https://events.example/sse",
          headers: {},
        },
      },
      {
        source: `{"search":{"type":"streamable-http","url":"https://search.example/mcp","enabled":false}}`,
        expected: {
          name: "search",
          enabled: false,
          transport: "remote" as const,
          url: "https://search.example/mcp",
          headers: {},
        },
      },
      {
        source: `{"paused":{"type":"http","url":"https://paused.example/mcp","disabled":true}}`,
        expected: {
          name: "paused",
          enabled: false,
          transport: "remote" as const,
          url: "https://paused.example/mcp",
          headers: {},
        },
      },
      {
        source: `{"internal":{"transport":"remote","url":"https://internal.example/mcp","headers":{}}}`,
        expected: {
          name: "internal",
          enabled: true,
          transport: "remote" as const,
          url: "https://internal.example/mcp",
          headers: {},
        },
      },
    ];

    for (const fixture of fixtures) {
      expect(parseMcpServerJson(fixture.source)).toEqual(fixture.expected);
    }
  });

  it("infers a remote server from a Cursor-style URL configuration", () => {
    expect(
      parseMcpServerJson(`{
        "mcpServers": {
          "cursor-docs": {
            "url": "https://docs.example/mcp",
            "headers": { "Authorization": "Bearer token" }
          }
        }
      }`),
    ).toEqual({
      name: "cursor-docs",
      enabled: true,
      transport: "remote",
      url: "https://docs.example/mcp",
      headers: { Authorization: "Bearer token" },
    });
  });

  it("reports malformed JSON clearly", () => {
    expect(() => parseMcpServerJson("{")).toThrow("MCP server JSON is malformed.");
  });

  it("rejects a non-object root", () => {
    expect(() => parseMcpServerJson("[]")).toThrow("MCP server JSON must be an object.");
  });

  it("requires exactly one server entry", () => {
    const invalidSources = [
      `{}`,
      `{"one":{"command":"one"},"two":{"command":"two"}}`,
      `{"mcpServers":{}}`,
      `{"mcpServers":{"one":{"command":"one"},"two":{"command":"two"}}}`,
    ];

    for (const source of invalidSources) {
      expect(() => parseMcpServerJson(source)).toThrow(
        "MCP server JSON must contain exactly one server.",
      );
    }
  });

  it("rejects invalid wrapper and server shapes", () => {
    expect(() => parseMcpServerJson(`{"mcpServers":[]}`)).toThrow(
      "MCP server JSON field 'mcpServers' must be an object.",
    );
    expect(() => parseMcpServerJson(`{"files":null}`)).toThrow(
      "MCP server 'files' must be an object.",
    );
  });

  it("points structural errors to both accepted JSON forms", () => {
    const acceptedForms =
      'Expected either {"server-name": {...}} or {"mcpServers": {"server-name": {...}}}.';
    const invalidSources = [
      { source: `{`, detail: "MCP server JSON is malformed." },
      { source: `[]`, detail: "MCP server JSON must be an object." },
      { source: `{}`, detail: "MCP server JSON must contain exactly one server." },
      {
        source: `{"mcpServers":[]}`,
        detail: "MCP server JSON field 'mcpServers' must be an object.",
      },
      { source: `{"files":null}`, detail: "MCP server 'files' must be an object." },
    ];

    for (const invalid of invalidSources) {
      expect(() => parseMcpServerJson(invalid.source)).toThrow(
        `${invalid.detail} ${acceptedForms}`,
      );
    }
  });

  it("rejects bad field types with the server and field name", () => {
    const invalidFields = [
      {
        source: `{"files":{"enabled":"yes","command":"node"}}`,
        message: "MCP server 'files' field 'enabled' must be a boolean.",
      },
      {
        source: `{"files":{"type":7,"command":"node"}}`,
        message: "MCP server 'files' field 'type' must be a string.",
      },
      {
        source: `{"files":{"transport":7,"command":"node"}}`,
        message: "MCP server 'files' field 'transport' must be a string.",
      },
      {
        source: `{"files":{"command":7}}`,
        message: "MCP server 'files' field 'command' must be a string.",
      },
      {
        source: `{"files":{"command":"node","args":["server.js",7]}}`,
        message: "MCP server 'files' field 'args' must be an array of strings.",
      },
      {
        source: `{"files":{"command":"node","env":{"TOKEN":7}}}`,
        message: "MCP server 'files' field 'env' must be an object of string values.",
      },
      {
        source: `{"docs":{"type":"http","url":7}}`,
        message: "MCP server 'docs' field 'url' must be a string.",
      },
      {
        source: `{"docs":{"type":"http","url":"https://docs.example/mcp","headers":{"Token":7}}}`,
        message: "MCP server 'docs' field 'headers' must be an object of string values.",
      },
    ];

    for (const invalid of invalidFields) {
      expect(() => parseMcpServerJson(invalid.source)).toThrow(invalid.message);
    }
  });

  it("rejects an unsupported transport declaration", () => {
    expect(() =>
      parseMcpServerJson(`{"files":{"type":"websocket","command":"node"}}`),
    ).toThrow("MCP server 'files' has unsupported type 'websocket'.");
  });

  it("rejects an unsupported internal transport declaration", () => {
    expect(() =>
      parseMcpServerJson(`{"files":{"transport":"http","url":"https://docs.example/mcp"}}`),
    ).toThrow("MCP server 'files' has unsupported transport 'http'.");
  });

  it("rejects conflicting type and transport declarations", () => {
    expect(() =>
      parseMcpServerJson(
        `{"files":{"type":"http","transport":"stdio","url":"https://docs.example/mcp"}}`,
      ),
    ).toThrow("MCP server 'files' has conflicting type and transport declarations.");
  });

  it("trims names and endpoints while preserving argument and secret values", () => {
    expect(
      parseMcpServerJson(
        `{" papers ":{"command":" node ","args":[" spaced argument "],"env":{"TOKEN":" secret "}}}`,
      ),
    ).toEqual({
      name: "papers",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: [" spaced argument "],
      env: { TOKEN: " secret " },
    });
    expect(
      parseMcpServerJson(
        `{" docs ":{"type":"http","url":" https://docs.example/mcp ","headers":{"Authorization":" Bearer token "}}}`,
      ),
    ).toEqual({
      name: "docs",
      enabled: true,
      transport: "remote",
      url: "https://docs.example/mcp",
      headers: { Authorization: " Bearer token " },
    });
  });
});

describe("serializeMcpServerJson", () => {
  it("emits one keyed stdio server object", () => {
    const serialized = serializeMcpServerJson({
      name: "files",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y"],
      env: { TOKEN: "secret" },
    });

    expect(JSON.parse(serialized)).toEqual({
      files: {
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: ["-y"],
        env: { TOKEN: "secret" },
      },
    });
  });

  it("preserves stdio and remote values through serialize and parse", () => {
    const stdio = {
      name: "files",
      enabled: false,
      transport: "stdio",
      command: "node",
      args: ["server.js", ""],
      env: { TOKEN: "__stored__", MODE: "read only" },
    } satisfies McpServerConfig;
    const remote = {
      name: "docs",
      enabled: true,
      transport: "remote",
      url: "https://docs.example/mcp",
      headers: { Authorization: "__stored__", "X-Scope": "papers" },
    } satisfies McpServerConfig;

    expect(parseMcpServerJson(serializeMcpServerJson(stdio))).toEqual({
      name: "files",
      enabled: false,
      transport: "stdio",
      command: "node",
      args: ["server.js", ""],
      env: { TOKEN: "__stored__", MODE: "read only" },
    });
    expect(parseMcpServerJson(serializeMcpServerJson(remote))).toEqual({
      name: "docs",
      enabled: true,
      transport: "remote",
      url: "https://docs.example/mcp",
      headers: { Authorization: "__stored__", "X-Scope": "papers" },
    });
  });
});

describe("runMcpServerImport", () => {
  it("skips exact existing names and names imported successfully earlier", async () => {
    const existing = {
      name: "docs",
      enabled: true,
      transport: "remote",
      url: "https://docs.example/mcp",
      headers: {},
    } satisfies McpServerConfig;
    const memory = createMemoryOperations([existing]);

    const result = await runMcpServerImport(
      [
        { ...existing, url: "https://replacement.example/mcp" },
        {
          name: " papers ",
          enabled: true,
          transport: "stdio",
          command: " node ",
          args: ["server.js"],
          env: {},
        },
        {
          name: "papers",
          enabled: true,
          transport: "stdio",
          command: "ignored",
          args: [],
          env: {},
        },
      ],
      {
        existingNames: ["docs"],
        duplicateAction: "skip",
        ...memory.operations,
      },
    );

    expect(result).toEqual({
      imported: 1,
      skipped: 2,
      failed: 0,
      failures: [],
      records: [
        {
          config: {
            name: "papers",
            enabled: true,
            transport: "stdio",
            command: "node",
            args: ["server.js"],
            env: {},
          },
          validation: {
            name: "papers",
            status: "connected",
            tool_count: 1,
            tools: [{ name: "papers_tool", description: null }],
            error: null,
          },
        },
      ],
    });
    expect([...memory.records.keys()]).toEqual(["docs", "papers"]);
    expect(memory.records.get("papers")?.config).toEqual({
      name: "papers",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: {},
    });
  });

  it("overwrites exact existing names and names imported successfully earlier", async () => {
    const existing = {
      name: "docs",
      enabled: true,
      transport: "remote",
      url: "https://old.example/mcp",
      headers: {},
    } satisfies McpServerConfig;
    const memory = createMemoryOperations([existing]);

    const result = await runMcpServerImport(
      [
        { ...existing, url: "https://new.example/mcp" },
        {
          name: "papers",
          enabled: true,
          transport: "stdio",
          command: "first",
          args: [],
          env: {},
        },
        {
          name: "papers",
          enabled: false,
          transport: "stdio",
          command: "second",
          args: ["server.js"],
          env: {},
        },
      ],
      {
        existingNames: ["docs"],
        duplicateAction: "overwrite",
        ...memory.operations,
      },
    );

    expect(result).toMatchObject({ imported: 3, skipped: 0, failed: 0, failures: [] });
    expect(
      result.records.map((record) =>
        record.config.transport === "stdio" ? record.config.command : record.config.url,
      ),
    ).toEqual(["https://new.example/mcp", "first", "second"]);
    expect(memory.records.get("docs")?.config).toEqual({
      ...existing,
      url: "https://new.example/mcp",
    });
    expect(memory.records.get("papers")?.config).toEqual({
      name: "papers",
      enabled: false,
      transport: "stdio",
      command: "second",
      args: ["server.js"],
      env: {},
    });
  });

  it("records a validation failure and continues importing sequentially", async () => {
    const memory = createMemoryOperations([], new Set(["broken"]));

    const result = await runMcpServerImport(
      [
        {
          name: "good",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: ["good.js"],
          env: {},
        },
        {
          name: "broken",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: ["broken.js"],
          env: {},
        },
        {
          name: "later",
          enabled: true,
          transport: "remote",
          url: "https://later.example/mcp",
          headers: {},
        },
      ],
      {
        existingNames: [],
        duplicateAction: "skip",
        ...memory.operations,
      },
    );

    expect(result).toMatchObject({
      imported: 2,
      skipped: 0,
      failed: 1,
      failures: [{ name: "broken", reason: "validation failed for broken" }],
    });
    expect(result.records.map((record) => record.config.name)).toEqual(["good", "later"]);
    expect([...memory.records.keys()]).toEqual(["good", "later"]);
  });

  it("summarizes imported, skipped, and malformed candidates", async () => {
    const existing = {
      name: "docs",
      enabled: true,
      transport: "remote",
      url: "https://docs.example/mcp",
      headers: {},
    } satisfies McpServerConfig;
    const good = {
      name: "papers",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["papers.js"],
      env: {},
    } satisfies McpServerConfig;
    const malformed = {
      name: " bad-config ",
      enabled: true,
      transport: "stdio",
      command: 7,
      args: [],
      env: {},
    } as unknown as McpServerConfig;
    const memory = createMemoryOperations([existing]);

    const result = await runMcpServerImport([existing, good, good, malformed], {
      existingNames: ["docs"],
      duplicateAction: "skip",
      ...memory.operations,
    });

    expect(result).toEqual({
      imported: 1,
      skipped: 2,
      failed: 1,
      failures: [
        {
          name: "bad-config",
          reason: "MCP server 'bad-config' field 'command' must be a string.",
        },
      ],
      records: [connectedRecord(good)],
    });
    expect([...memory.records.keys()]).toEqual(["docs", "papers"]);
  });
});
