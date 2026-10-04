import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
type ToolOpts = {
  confirm: (req: { tool: string; summary: string }) => Promise<boolean>;
  onImage?: (dataUrl: string) => void;
  mutationAllowed?: () => boolean;
};

const mocks = vi.hoisted(() => ({
  events: new Map<string, Handler>(),
  unlistened: [] as string[],
  listenFailure: null as string | null,
  intervals: [] as Array<() => void>,
  clearInterval: vi.fn(),
  windowListeners: new Map<string, (event: { persisted: boolean }) => void>(),
  slow: [] as Array<(value: unknown) => void>,
  toolOpts: null as ToolOpts | null,
  figureEnabled: true,
  api: {
    appendAppLog: vi.fn(async (_line: string) => {}),
    appVersion: vi.fn(async () => "0.4.4"),
    getConfig: vi.fn(async () => ({ mcp_read_only: false, mcp_approval_policy: "ask" })),
    listProjects: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []),
    mcpBeginRendererSession: vi.fn(async () => 41),
    mcpEndRendererSession: vi.fn(async (_session: number) => {}),
    mcpRegisterTools: vi.fn(async (_tools: Array<{ name: string }>, _session: number) => {}),
    mcpRendererHeartbeat: vi.fn(async (_session: number) => {}),
    mcpSetActiveProject: vi.fn(async (_project: string | null) => {}),
    mcpStatus: vi.fn(async () => ({ running: true })),
    mcpToolResult: vi.fn(async (_callId: number, _result: unknown, _session: number) => {}),
  },
  skills: {
    loadSkills: vi.fn(async (): Promise<unknown[]> => []),
    readSkillFile: vi.fn(async (_id: string, _path: string): Promise<unknown> => ({})),
  },
  files: {
    projectId: "proj" as string | null,
    mainDoc: "main.tex" as string | null,
    engine: { id: "latex", label: "LaTeX" },
    engineLoaded: true,
    loading: false,
    openProject: vi.fn(async (_id: string, _allowed: () => boolean) => {}),
  },
  compile: { status: "success" },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    if (mocks.listenFailure === name) throw new Error(`cannot listen to ${name}`);
    mocks.events.set(name, handler);
    return () => {
      mocks.unlistened.push(name);
      mocks.events.delete(name);
    };
  }),
}));
vi.mock("@/lib/tauri", () => mocks.api);
vi.mock("@/lib/skills", () => ({
  loadSkills: mocks.skills.loadSkills,
  readSkillFile: mocks.skills.readSkillFile,
  validSkills: (skills: Array<{ valid?: boolean }>) => skills.filter((skill) => skill.valid !== false),
  isSkillAvailable: (skill: { enabled?: boolean }) => skill.enabled !== false,
  skillScriptCommands: (skill: { dir: string }) => [{ path: "run.py", command: `python3 "${skill.dir}/run.py"` }],
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => mocks.compile } }));
vi.mock("@/lib/document-engine", () => ({ supportsFigureTools: () => mocks.figureEnabled }));
vi.mock("@/lib/ai-tools", () => {
  const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
    jsonSchema: { type: "object", properties, required, additionalProperties: false },
  });
  return {
    createOleaflyTools: (opts: ToolOpts) => {
      mocks.toolOpts = opts;
      return {
        echo: {
          description: "Echo text",
          inputSchema: objectSchema({ text: { type: "string" } }, ["text"]),
          execute: async (input: { text: string }) => ({ echoed: input.text }),
        },
        write_file: {
          description: "Write a file",
          inputSchema: objectSchema({ path: { type: "string" } }, ["path"]),
          execute: async (input: { path: string }) => {
            const approved = await opts.confirm({ tool: "write_file", summary: input.path });
            return approved ? { success: true, allowed: opts.mutationAllowed?.() } : { error: "declined" };
          },
        },
        slow: {
          description: "Wait for the test",
          inputSchema: objectSchema({}, []),
          execute: () => new Promise((resolve) => mocks.slow.push(resolve)),
        },
        explode: {
          description: "Throw",
          inputSchema: objectSchema({}, []),
          execute: async () => {
            throw new Error("tool blew up");
          },
        },
      };
    },
    createFigureTools: (opts: ToolOpts) => ({
      preview_figure: {
        description: "Preview a figure.",
        inputSchema: objectSchema({ count: { type: "integer" } }, []),
        execute: async (input: { count?: number }) => {
          const sizes = [12 * 1024 * 1024 + 1, 9 * 1024 * 1024, 9 * 1024 * 1024];
          for (const size of sizes.slice(0, input.count ?? 0)) {
            opts.onImage?.(`data:image/png;base64,${"A".repeat(size - 22)}`);
          }
          opts.onImage?.("data:image/png;base64,QUJD");
          return { success: true };
        },
      },
      load_image: {
        description: "Load an image.",
        inputSchema: objectSchema({}, []),
        execute: async () => ({ success: true }),
      },
    }),
  };
});

type Bridge = typeof import("./mcp-bridge");
type Stores = {
  activity: typeof import("@/store/mcp-activity").useMcpActivityStore;
  approvals: typeof import("@/store/mcp-approvals").useMcpApprovalStore;
};

let bridge: Bridge;
let stores: Stores;
let win: Record<string, unknown>;

async function load(): Promise<void> {
  vi.resetModules();
  bridge = await import("./mcp-bridge");
  stores = {
    activity: (await import("@/store/mcp-activity")).useMcpActivityStore,
    approvals: (await import("@/store/mcp-approvals")).useMcpApprovalStore,
  };
}

function emit(name: string, payload: unknown): void {
  const handler = mocks.events.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  handler({ payload });
}

function call(callId: number, name: string, args: Record<string, unknown> = {}, session = 41, epoch = 1) {
  emit("mcp:tool-call", { callId, epoch, rendererSession: session, name, arguments: args });
}

function resultFor(callId: number) {
  const found = mocks.api.mcpToolResult.mock.calls.find(([id]) => id === callId);
  return found?.[1] as { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean } | undefined;
}

function textFor(callId: number): string | undefined {
  return resultFor(callId)?.content.find((part) => part.type === "text")?.text;
}

async function settled(callId: number) {
  await until(() => expect(resultFor(callId)).toBeDefined());
  return resultFor(callId);
}

function until(assertion: () => void) {
  return vi.waitFor(assertion, { interval: 2 });
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

function registeredNames(index = -1): string[] {
  const calls = mocks.api.mcpRegisterTools.mock.calls;
  return calls.at(index)?.[0].map((tool) => tool.name) ?? [];
}

beforeEach(async () => {
  mocks.events.clear();
  mocks.unlistened = [];
  mocks.listenFailure = null;
  mocks.intervals = [];
  mocks.windowListeners.clear();
  mocks.slow = [];
  mocks.toolOpts = null;
  mocks.figureEnabled = true;
  mocks.files.projectId = "proj";
  mocks.files.mainDoc = "main.tex";
  mocks.files.loading = false;
  mocks.files.engineLoaded = true;
  for (const fn of Object.values(mocks.api)) fn.mockClear();
  mocks.clearInterval.mockClear();
  mocks.api.mcpBeginRendererSession.mockReset().mockResolvedValue(41);
  mocks.api.mcpRegisterTools.mockReset().mockResolvedValue(undefined);
  mocks.api.mcpRendererHeartbeat.mockReset().mockResolvedValue(undefined);
  mocks.api.mcpStatus.mockReset().mockResolvedValue({ running: true });
  mocks.api.getConfig.mockReset().mockResolvedValue({ mcp_read_only: false, mcp_approval_policy: "ask" });
  mocks.api.appVersion.mockReset().mockResolvedValue("0.4.4");
  mocks.api.listProjects.mockReset().mockResolvedValue([]);
  mocks.files.openProject.mockReset().mockResolvedValue(undefined);
  mocks.skills.loadSkills.mockReset().mockResolvedValue([]);
  mocks.skills.readSkillFile.mockReset().mockResolvedValue({});
  win = {
    setInterval: vi.fn((callback: () => void) => {
      mocks.intervals.push(callback);
      return mocks.intervals.length;
    }),
    clearInterval: mocks.clearInterval,
    addEventListener: vi.fn((name: string, handler: (event: { persisted: boolean }) => void) => {
      mocks.windowListeners.set(name, handler);
    }),
  };
  vi.stubGlobal("window", win);
  await load();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateToolInput", () => {
  const schema = {
    type: "object",
    required: ["name"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 5 },
      mode: { enum: ["fast", "slow"] },
      flag: { type: "boolean" },
      count: { type: "integer", minimum: 1, maximum: 3 },
      ratio: { type: "number" },
      tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
      loose: { type: "array" },
      extra: { type: "object" },
      anything: {},
    },
  };

  it.each([
    [{ name: "ok" }, null],
    [{ name: "ok", mode: "fast", flag: true, count: 2, ratio: 0.5, tags: ["a"], loose: [1, "x"], anything: 3 }, null],
    [{}, "arguments.name is required"],
    [{ name: "ok", other: 1 }, "arguments.other is not allowed"],
    [{ name: "toolong" }, "arguments.name must contain at most 5 characters"],
    [{ name: 3 }, "arguments.name must be a string"],
    [{ name: "ok", mode: "medium" }, "arguments.mode must be one of the advertised values"],
    [{ name: "ok", flag: "yes" }, "arguments.flag must be a boolean"],
    [{ name: "ok", count: 1.5 }, "arguments.count must be an integer"],
    [{ name: "ok", count: 0 }, "arguments.count must be at least 1"],
    [{ name: "ok", count: 4 }, "arguments.count must be at most 3"],
    [{ name: "ok", ratio: Number.NaN }, "arguments.ratio must be a number"],
    [{ name: "ok", ratio: "1" }, "arguments.ratio must be a number"],
    [{ name: "ok", tags: "a" }, "arguments.tags must be an array"],
    [{ name: "ok", tags: [] }, "arguments.tags must contain at least 1 items"],
    [{ name: "ok", tags: ["a", "b", "c"] }, "arguments.tags must contain at most 2 items"],
    [{ name: "ok", tags: ["a", 2] }, "arguments.tags[1] must be a string"],
    [{ name: "ok", extra: [] }, "arguments.extra must be an object"],
    [null, "arguments must be an object"],
  ])("checks %j", (input, expected) => {
    expect(bridge.validateToolInput(schema, input)).toBe(expected);
  });

  it("refuses schemas it cannot read", () => {
    expect(bridge.validateToolInput(null, {})).toBe("tool schema is unavailable");
    expect(bridge.validateToolInput([], {})).toBe("tool schema is unavailable");
    expect(bridge.validateToolInput("object", {})).toBe("tool schema is unavailable");
  });

  it("stops at deeply nested input", () => {
    let nested: Record<string, unknown> = { type: "object" };
    let value: Record<string, unknown> = {};
    const root = nested;
    const rootValue = value;
    for (let depth = 0; depth < 14; depth += 1) {
      const child = { type: "object" };
      nested.properties = { child };
      nested = child;
      const childValue = {};
      value.child = childValue;
      value = childValue;
    }
    expect(bridge.validateToolInput(root, rootValue)).toBe(
      `arguments${".child".repeat(13)} is nested too deeply`,
    );
  });
});

describe("toMcpResult and rawSchemaOf", () => {
  it("unwraps AI SDK schema wrappers and passes plain schemas through", () => {
    const plain = { type: "object" };
    expect(bridge.rawSchemaOf({ jsonSchema: plain })).toBe(plain);
    expect(bridge.rawSchemaOf(plain)).toBe(plain);
    expect(bridge.rawSchemaOf(null)).toBeNull();
  });

  it("reports results that cannot be serialized as errors", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(bridge.toMcpResult(cyclic, [])).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: "Tool result could not be serialized." }) }],
      isError: true,
    });
  });

  it("treats a missing result as an empty object", () => {
    expect(bridge.toMcpResult(undefined, [])).toEqual({ content: [{ type: "text", text: "{}" }] });
  });

  it("keeps raw image payloads and defaults unknown media types to PNG", () => {
    const result = bridge.toMcpResult({}, ["QUJD", "data:image/webp;base64,V0VC"]);
    expect(result.content.slice(0, 2)).toEqual([
      { type: "image", data: "QUJD", mimeType: "image/png" },
      { type: "image", data: "V0VC", mimeType: "image/png" },
    ]);
  });
});

describe("MCP-only and skill tools", () => {
  const confirm = vi.fn(async () => true);
  let registry: ReturnType<Bridge["buildMcpToolRegistry"]>;

  beforeEach(() => {
    confirm.mockReset().mockResolvedValue(true);
    registry = bridge.buildMcpToolRegistry({ confirm, readOnly: false, onImage: () => {} });
  });

  it("lists valid skills with their availability", async () => {
    mocks.skills.loadSkills.mockResolvedValue([
      { id: "a", name: "A", description: "first", phase: "draft", tier: "user", enabled: true },
      { id: "b", name: "B", description: "second", tier: "builtin", enabled: false },
      { id: "broken", valid: false },
    ]);
    await expect(registry.list_skills.execute({})).resolves.toEqual({
      skills: [
        { id: "a", name: "A", description: "first", phase: "draft", tier: "user", enabled: true },
        { id: "b", name: "B", description: "second", phase: null, tier: "builtin", enabled: false },
      ],
    });
  });

  it("returns skill loading failures as tool errors", async () => {
    mocks.skills.loadSkills.mockRejectedValue(new Error("skills dir missing"));
    await expect(registry.list_skills.execute({})).resolves.toEqual({ error: "Error: skills dir missing" });
    await expect(registry.load_skill.execute({ id: "a" })).resolves.toEqual({ error: "Error: skills dir missing" });
  });

  it("loads one skill and reports unknown ids", async () => {
    mocks.skills.loadSkills.mockResolvedValue([
      { id: "a", name: "A", description: "first", dir: "/skills/a", files: [], instructions: "Do it" },
    ]);
    await expect(registry.load_skill.execute({ id: "a" })).resolves.toEqual({
      id: "a",
      name: "A",
      description: "first",
      dir: "/skills/a",
      files: [],
      scripts: [{ path: "run.py", command: 'python3 "/skills/a/run.py"' }],
      instructions: "Do it",
    });
    await expect(registry.load_skill.execute({})).resolves.toEqual({ error: "no skill named  is installed" });
  });

  it("reads a skill file and reports read failures", async () => {
    mocks.skills.readSkillFile.mockResolvedValueOnce({ path: "ref.md", content: "# Ref" });
    await expect(registry.read_skill_file.execute({ id: "a", path: "ref.md" })).resolves.toEqual({
      path: "ref.md",
      content: "# Ref",
    });
    expect(mocks.skills.readSkillFile).toHaveBeenCalledWith("a", "ref.md");
    mocks.skills.readSkillFile.mockRejectedValueOnce("outside the skill folder");
    await expect(registry.read_skill_file.execute({})).resolves.toEqual({ error: "outside the skill folder" });
    expect(mocks.skills.readSkillFile).toHaveBeenLastCalledWith("", "");
  });

  it("reports status with an unknown version when the backend cannot say", async () => {
    mocks.api.appVersion.mockRejectedValue(new Error("no ipc"));
    mocks.files.mainDoc = null;
    await expect(registry.get_status.execute({})).resolves.toEqual({
      app_version: "unknown",
      project_id: "proj",
      main_doc: null,
      engine: "latex",
      compile_status: "success",
    });
  });

  it("lists projects and reports listing failures", async () => {
    mocks.api.listProjects.mockResolvedValueOnce([{ id: "p", name: "Paper" }]);
    await expect(registry.list_projects.execute({})).resolves.toEqual({ projects: [{ id: "p", name: "Paper" }] });
    mocks.api.listProjects.mockRejectedValueOnce(new Error("library locked"));
    await expect(registry.list_projects.execute({})).resolves.toEqual({ error: "Error: library locked" });
  });

  it("opens a known project after approval", async () => {
    mocks.api.listProjects.mockResolvedValue([{ id: "next", name: "Next" }]);
    mocks.files.openProject.mockImplementation(async (id: string) => {
      mocks.files.projectId = id;
    });
    await expect(registry.open_project.execute({ project_id: "next" })).resolves.toEqual({
      success: true,
      project_id: "next",
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: "open_project" }));
  });

  it("refuses unknown projects, declined approvals and cancelled requests", async () => {
    mocks.api.listProjects.mockResolvedValue([{ id: "next", name: "Next" }]);
    await expect(registry.open_project.execute({ project_id: "nope" })).resolves.toEqual({
      error: "unknown project id: nope",
    });
    confirm.mockResolvedValueOnce(false);
    await expect(registry.open_project.execute({ project_id: "next" })).resolves.toEqual({
      error: "The user declined this change.",
      declined: true,
    });
    const cancelled = bridge.buildMcpToolRegistry({
      confirm,
      readOnly: false,
      onImage: () => {},
      mutationAllowed: () => false,
    });
    await expect(cancelled.open_project.execute({ project_id: "next" })).resolves.toEqual({
      error: "MCP request was cancelled before opening the project.",
    });
    expect(mocks.files.openProject).not.toHaveBeenCalled();
  });

  it("reports a project that is still loading or fails to open", async () => {
    mocks.api.listProjects.mockResolvedValue([{ id: "next", name: "Next" }]);
    mocks.files.openProject.mockImplementationOnce(async (id: string) => {
      mocks.files.projectId = id;
      mocks.files.loading = true;
    });
    await expect(registry.open_project.execute({ project_id: "next" })).resolves.toEqual({
      error: "Project next could not be opened.",
    });
    mocks.files.openProject.mockRejectedValueOnce(new Error("corrupt manifest"));
    await expect(registry.open_project.execute({ project_id: "next" })).resolves.toEqual({
      error: "Error: corrupt manifest",
    });
  });
});

describe("MCP bridge runtime", () => {
  it("starts once: listeners, renderer session, tool registration and server status", async () => {
    await bridge.startMcpBridge();
    await bridge.startMcpBridge();

    expect(mocks.api.mcpBeginRendererSession).toHaveBeenCalledOnce();
    expect(mocks.api.mcpSetActiveProject).toHaveBeenCalledWith("proj");
    expect(mocks.api.mcpRegisterTools).toHaveBeenCalledOnce();
    expect(mocks.api.mcpRegisterTools.mock.calls[0][1]).toBe(41);
    expect(registeredNames()).toEqual(expect.arrayContaining(["echo", "write_file", "preview_figure", "get_status"]));
    const echo = mocks.api.mcpRegisterTools.mock.calls[0][0].find((tool) => tool.name === "echo");
    expect(echo).toMatchObject({ description: "Echo text", inputSchema: { type: "object", required: ["text"] } });
    expect(stores.activity.getState().serverRunning).toBe(true);
    expect([...mocks.events.keys()].sort()).toEqual([
      "mcp:native-tool-finished",
      "mcp:native-tool-started",
      "mcp:requests-revoked",
      "mcp:server-started",
      "mcp:server-stopped",
      "mcp:tool-call",
      "mcp:tool-call-cancelled",
    ]);
    expect(mocks.intervals).toHaveLength(1);
    expect(mocks.windowListeners.has("pagehide")).toBe(true);
  });

  it("marks the server stopped when its status cannot be read", async () => {
    stores.activity.getState().setServerRunning(true);
    mocks.api.mcpStatus.mockRejectedValue(new Error("no server"));
    await bridge.startMcpBridge();
    expect(stores.activity.getState().serverRunning).toBe(false);
  });

  it("can retry startup after the renderer session fails to begin", async () => {
    mocks.api.mcpBeginRendererSession.mockRejectedValueOnce(new Error("backend busy"));
    await expect(bridge.startMcpBridge()).rejects.toThrow("backend busy");
    await bridge.startMcpBridge();
    expect(mocks.api.mcpBeginRendererSession).toHaveBeenCalledTimes(2);
    expect(mocks.api.mcpRegisterTools).toHaveBeenCalledOnce();
  });

  it("rejects an invalid renderer session from the backend", async () => {
    mocks.api.mcpBeginRendererSession.mockResolvedValueOnce(0);
    await expect(bridge.startMcpBridge()).rejects.toThrow("The MCP backend returned an invalid renderer session");
    expect(mocks.api.mcpRegisterTools).not.toHaveBeenCalled();
  });

  it("removes partially installed listeners when one cannot be installed, then retries", async () => {
    mocks.listenFailure = "mcp:server-started";
    await expect(bridge.startMcpBridge()).rejects.toThrow("cannot listen to mcp:server-started");
    expect(mocks.unlistened).toEqual(["mcp:tool-call-cancelled", "mcp:tool-call"]);
    expect(mocks.api.mcpBeginRendererSession).not.toHaveBeenCalled();
    mocks.listenFailure = null;
    await bridge.startMcpBridge();
    expect(mocks.events.size).toBe(7);
  });

  it("gives up the session when tool registration reports a stale renderer", async () => {
    mocks.api.mcpRegisterTools.mockRejectedValueOnce(new Error("stale MCP renderer session"));
    await expect(bridge.startMcpBridge()).rejects.toThrow("stale MCP renderer session");
    expect(mocks.clearInterval).toHaveBeenCalledWith(1);
    await expect(bridge.refreshMcpRegistry()).rejects.toThrow("This renderer no longer owns the MCP session");
  });

  it("keeps the session when registration fails for another reason", async () => {
    mocks.api.mcpRegisterTools.mockRejectedValueOnce(new Error("disk full"));
    await expect(bridge.startMcpBridge()).rejects.toThrow("disk full");
    expect(mocks.clearInterval).not.toHaveBeenCalled();
    await bridge.startMcpBridge();
    expect(mocks.api.mcpBeginRendererSession).toHaveBeenCalledOnce();
    expect(mocks.api.mcpRegisterTools).toHaveBeenCalledTimes(2);
  });

  it("runs a tool call and replies with its result", async () => {
    await bridge.startMcpBridge();
    call(1, "echo", { text: "hi" });
    expect(await settled(1)).toEqual({ content: [{ type: "text", text: '{"echoed":"hi"}' }] });
    expect(mocks.api.mcpToolResult.mock.calls[0][2]).toBe(41);
    expect(mocks.api.appendAppLog).toHaveBeenCalledWith("[mcp] echo ok");
    expect(stores.activity.getState().logs[0]).toMatchObject({ name: "echo", status: "ok" });
  });

  it("treats a call without arguments as an empty argument object", async () => {
    await bridge.startMcpBridge();
    emit("mcp:tool-call", { callId: 1, epoch: 1, rendererSession: 41, name: "echo" });
    await settled(1);
    expect(textFor(1)).toBe(
      JSON.stringify({ error: "Invalid tool arguments: arguments.text is required" }),
    );
  });

  it("refuses invalid arguments without running the tool", async () => {
    await bridge.startMcpBridge();
    call(1, "echo", { text: 5 });
    const result = await settled(1);
    expect(result?.isError).toBe(true);
    expect(textFor(1)).toBe(JSON.stringify({ error: "Invalid tool arguments: arguments.text must be a string" }));
    expect(mocks.api.appendAppLog).toHaveBeenCalledWith("[mcp] echo error");
    expect(stores.activity.getState().logs[0]).toMatchObject({ name: "echo", status: "error" });
  });

  it("reports unknown and overlong tool names as unavailable", async () => {
    await bridge.startMcpBridge();
    call(1, "missing_tool");
    await settled(1);
    expect(textFor(1)).toBe(JSON.stringify({ error: "tool not available: missing_tool" }));
    const longName = `echo${"x".repeat(200)}`;
    call(2, longName, { text: "hi" });
    await settled(2);
    expect(textFor(2)).toBe(JSON.stringify({ error: `tool not available: ${longName.slice(0, 128)}` }));
    expect(stores.activity.getState().logs[0].name).toHaveLength(128);
  });

  it("returns a thrown tool error to the client", async () => {
    await bridge.startMcpBridge();
    call(1, "explode");
    await settled(1);
    expect(textFor(1)).toBe(JSON.stringify({ error: "Error: tool blew up" }));
    expect(stores.activity.getState().logs[0]).toMatchObject({ status: "error", summary: "Error: tool blew up" });
  });

  it("attaches captured figure images and drops ones over the size budget", async () => {
    await bridge.startMcpBridge();
    call(1, "preview_figure", { count: 0 });
    const small = await settled(1);
    expect(small?.content.map((part) => part.type)).toEqual(["image", "text"]);
    expect(small?.content[0].data).toBe("QUJD");

    call(2, "preview_figure", { count: 3 });
    const large = await settled(2);
    expect(large?.content.map((part) => part.type)).toEqual(["image", "image", "text"]);
    expect(large?.content[0].data).toHaveLength(9 * 1024 * 1024 - 22);
    expect(large?.content[1].data).toBe("QUJD");
  });

  it("refuses figure tools when the engine cannot run them", async () => {
    mocks.figureEnabled = false;
    mocks.files.engineLoaded = false;
    await bridge.startMcpBridge();
    call(1, "preview_figure", {});
    await settled(1);
    expect(textFor(1)).toBe(
      JSON.stringify({ error: "Figure tools are not available until the project's document engine loads." }),
    );
    mocks.files.engineLoaded = true;
    call(2, "load_image", {});
    await settled(2);
    expect(textFor(2)).toBe('{"success":true}');
  });

  it("asks for approval through the approval queue and allows the mutation while the call is active", async () => {
    await bridge.startMcpBridge();
    expect(await bridge.startMcpBridge()).toBeTypeOf("function");
    const w = window as unknown as { __mcpQueue: () => string[]; __mcpDecide: (verb: string) => string };
    expect(w.__mcpDecide("approve")).toBe("empty");
    call(1, "write_file", { path: "main.tex" });
    await until(() => expect(stores.approvals.getState().queue).toHaveLength(1));
    const [pending] = stores.approvals.getState().queue;
    expect(w.__mcpQueue()).toEqual([`${pending.id}:write_file`]);
    expect(w.__mcpDecide("approve")).toBe(`approve:write_file:id=${pending.id}:left=0`);
    await settled(1);
    expect(textFor(1)).toBe('{"success":true,"allowed":true}');
  });

  it("returns a declined approval to the client", async () => {
    await bridge.startMcpBridge();
    const w = window as unknown as { __mcpDecide: (verb: string) => string };
    call(1, "write_file", { path: "main.tex" });
    await until(() => expect(stores.approvals.getState().queue).toHaveLength(1));
    expect(w.__mcpDecide("deny")).toMatch(/^deny:write_file:/);
    await settled(1);
    expect(textFor(1)).toBe('{"error":"declined"}');
  });

  it("skips approval for writes under the auto_writes policy", async () => {
    mocks.api.getConfig.mockResolvedValue({ mcp_read_only: false, mcp_approval_policy: "auto_writes" });
    await bridge.startMcpBridge();
    call(1, "write_file", { path: "main.tex" });
    await settled(1);
    expect(textFor(1)).toBe('{"success":true,"allowed":true}');
    expect(stores.approvals.getState().queue).toHaveLength(0);
  });

  it("registers only read-only tools when the server is read-only", async () => {
    mocks.api.getConfig.mockResolvedValue({ mcp_read_only: true, mcp_approval_policy: "ask" });
    await bridge.startMcpBridge();
    expect(registeredNames()).not.toContain("write_file");
    expect(registeredNames()).not.toContain("open_project");
    expect(registeredNames()).toContain("echo");
    call(1, "write_file", { path: "main.tex" });
    await settled(1);
    expect(textFor(1)).toBe(JSON.stringify({ error: "tool not available: write_file" }));
  });

  it("denies the approval and the result when the client cancels the active call", async () => {
    await bridge.startMcpBridge();
    call(1, "write_file", { path: "main.tex" }, 41, 3);
    await until(() => expect(stores.approvals.getState().queue).toHaveLength(1));
    emit("mcp:tool-call-cancelled", { callId: 1, epoch: 3, rendererSession: 41, reason: "timeout" });
    await settled(1);
    expect(textFor(1)).toBe(JSON.stringify({ error: "MCP request was cancelled before the tool completed." }));
    expect(stores.approvals.getState().queue).toHaveLength(0);
  });

  it("ignores cancellations for other sessions and calls it never admitted", async () => {
    await bridge.startMcpBridge();
    call(1, "slow");
    await until(() => expect(mocks.slow).toHaveLength(1));
    emit("mcp:tool-call-cancelled", { callId: 1, epoch: 1, rendererSession: 7, reason: "timeout" });
    emit("mcp:tool-call-cancelled", { callId: 99, epoch: 1, rendererSession: 41, reason: "timeout" });
    mocks.slow[0]({ done: true });
    await settled(1);
    expect(textFor(1)).toBe('{"done":true}');
  });

  it("cancels a queued call before it starts", async () => {
    await bridge.startMcpBridge();
    call(1, "slow");
    call(2, "echo", { text: "queued" });
    await until(() => expect(mocks.slow).toHaveLength(1));
    emit("mcp:tool-call-cancelled", { callId: 2, epoch: 1, rendererSession: 41, reason: "client-disconnected" });
    mocks.slow[0]({ done: true });
    await settled(2);
    expect(textFor(2)).toBe(
      JSON.stringify({ error: "MCP request was cancelled because the server or policy changed." }),
    );
  });

  it("refuses calls beyond the queue limit and from other renderer sessions", async () => {
    await bridge.startMcpBridge();
    for (const id of [1, 2, 3, 4]) call(id, "slow");
    call(5, "echo", { text: "overflow" });
    await settled(5);
    expect(textFor(5)).toBe(
      JSON.stringify({ error: "MCP tool queue is full. Retry after current calls finish." }),
    );
    call(6, "echo", { text: "x" }, 40);
    await until(() => expect(mocks.slow).toHaveLength(1));
    expect(resultFor(6)).toBeUndefined();
    for (let index = 0; index < 4; index += 1) {
      await until(() => expect(mocks.slow).toHaveLength(index + 1));
      mocks.slow[index]({ index });
    }
    await settled(4);
    expect(textFor(4)).toBe('{"index":3}');
  });

  it("asks clients to retry while tools are being refreshed after a revocation", async () => {
    await bridge.startMcpBridge();
    emit("mcp:requests-revoked", { epoch: 1, rendererSession: 41, reason: "credential-regenerated" });
    call(1, "echo", { text: "x" });
    await settled(1);
    expect(textFor(1)).toBe(JSON.stringify({ error: "MCP tools are being refreshed. Retry shortly." }));
  });

  it("keeps the registry when only the renderer lease expired and ignores other sessions", async () => {
    await bridge.startMcpBridge();
    emit("mcp:requests-revoked", { epoch: 1, rendererSession: 41, reason: "renderer-lease-expired" });
    emit("mcp:requests-revoked", { epoch: 1, rendererSession: 41, reason: "tool-registry-changed" });
    emit("mcp:requests-revoked", { epoch: 1, rendererSession: 99, reason: "credential-regenerated" });
    emit("mcp:requests-revoked", { epoch: 1, rendererSession: 41, reason: "renderer-session-changed" });
    call(1, "echo", { text: "still here" });
    await settled(1);
    expect(textFor(1)).toBe('{"echoed":"still here"}');
  });

  it("cancels a call that was in flight when the policy changed", async () => {
    await bridge.startMcpBridge();
    call(1, "write_file", { path: "main.tex" });
    await until(() => expect(stores.approvals.getState().queue).toHaveLength(1));
    const [pending] = stores.approvals.getState().queue;
    emit("mcp:requests-revoked", { epoch: 1, rendererSession: 41, reason: "renderer-lease-expired" });
    stores.approvals.getState().decide(pending.id, true);
    await settled(1);
    expect(textFor(1)).toBe('{"error":"declined"}');
  });

  it("tracks the server running state by epoch and cancels native activity when it stops", async () => {
    await bridge.startMcpBridge();
    emit("mcp:server-stopped", { epoch: 2 });
    expect(stores.activity.getState().serverRunning).toBe(false);
    emit("mcp:server-started", { epoch: 1 });
    expect(stores.activity.getState().serverRunning).toBe(false);
    emit("mcp:server-started", { epoch: 3 });
    expect(stores.activity.getState().serverRunning).toBe(true);

    emit("mcp:native-tool-started", { activityId: "a", epoch: 3, name: "search_library" });
    emit("mcp:native-tool-started", { activityId: "a", epoch: 3, name: "search_library" });
    emit("mcp:native-tool-started", { activityId: "b", epoch: 4, name: "read_pdf" });
    expect(stores.activity.getState().logs).toHaveLength(2);

    emit("mcp:server-stopped", { epoch: 2 });
    expect(stores.activity.getState().serverRunning).toBe(true);
    emit("mcp:server-stopped", { epoch: 3 });
    expect(stores.activity.getState().serverRunning).toBe(false);
    const [readPdf, search] = stores.activity.getState().logs;
    expect(search).toMatchObject({
      name: "search_library",
      status: "error",
      summary: "cancelled because the MCP server stopped",
    });
    expect(readPdf).toMatchObject({ name: "read_pdf", status: "running" });
  });

  it("records native tool completions as ok, error or cancelled", async () => {
    await bridge.startMcpBridge();
    emit("mcp:native-tool-started", { activityId: "ok", epoch: 1, name: "one" });
    emit("mcp:native-tool-started", { activityId: "bad", epoch: 1, name: "two" });
    emit("mcp:native-tool-started", { activityId: "stop", epoch: 1, name: "three" });
    emit("mcp:native-tool-finished", { activityId: "ok", epoch: 1, name: "one", ok: true, cancelled: false });
    emit("mcp:native-tool-finished", { activityId: "bad", epoch: 1, name: "two", ok: false, cancelled: false });
    emit("mcp:native-tool-finished", { activityId: "stop", epoch: 1, name: "three", ok: false, cancelled: true });
    emit("mcp:native-tool-finished", { activityId: "ghost", epoch: 1, name: "four", ok: true, cancelled: false });
    const byName = Object.fromEntries(stores.activity.getState().logs.map((log) => [log.name, log]));
    expect(byName.one).toMatchObject({ status: "ok", summary: "ok" });
    expect(byName.two).toMatchObject({ status: "error", summary: "error" });
    expect(byName.three).toMatchObject({ status: "error", summary: "cancelled" });
    expect(byName.four).toBeUndefined();
  });

  it("re-registers tools from the heartbeat after they were revoked", async () => {
    await bridge.startMcpBridge();
    emit("mcp:requests-revoked", { epoch: 1, rendererSession: 41, reason: "credential-regenerated" });
    mocks.intervals[0]();
    await until(() => expect(mocks.api.mcpRegisterTools).toHaveBeenCalledTimes(2));
    expect(mocks.api.mcpRendererHeartbeat).toHaveBeenCalledWith(41);
    call(1, "echo", { text: "back" });
    await settled(1);
    expect(textFor(1)).toBe('{"echoed":"back"}');
  });

  it("sends one heartbeat at a time and keeps the session on ordinary failures", async () => {
    await bridge.startMcpBridge();
    let release: () => void = () => {};
    mocks.api.mcpRendererHeartbeat.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    mocks.intervals[0]();
    mocks.intervals[0]();
    expect(mocks.api.mcpRendererHeartbeat).toHaveBeenCalledOnce();
    release();
    await flush();
    mocks.api.mcpRendererHeartbeat.mockRejectedValueOnce(new Error("timeout"));
    mocks.intervals[0]();
    expect(mocks.api.mcpRendererHeartbeat).toHaveBeenCalledTimes(2);
    await flush();
    mocks.intervals[0]();
    expect(mocks.api.mcpRendererHeartbeat).toHaveBeenCalledTimes(3);
    expect(mocks.clearInterval).not.toHaveBeenCalled();
  });

  it("gives up the session when the heartbeat reports the lease is gone", async () => {
    await bridge.startMcpBridge();
    mocks.api.mcpRendererHeartbeat.mockRejectedValueOnce(new Error("MCP renderer lease is unavailable"));
    mocks.intervals[0]();
    await until(() => expect(mocks.clearInterval).toHaveBeenCalledWith(1));
    mocks.intervals[0]();
    expect(mocks.api.mcpRendererHeartbeat).toHaveBeenCalledOnce();
  });

  it("stops serving when another renderer takes over the session", async () => {
    await bridge.startMcpBridge();
    emit("mcp:requests-revoked", { epoch: 2, rendererSession: 42, reason: "renderer-session-changed" });
    expect(mocks.clearInterval).toHaveBeenCalledWith(1);
    call(1, "echo", { text: "x" });
    await Promise.resolve();
    expect(resultFor(1)).toBeUndefined();
    await expect(bridge.refreshMcpRegistry()).rejects.toThrow("This renderer no longer owns the MCP session");
  });

  it("refreshes the registry for the active project and current policy", async () => {
    await bridge.startMcpBridge();
    mocks.files.projectId = "other";
    mocks.api.getConfig.mockResolvedValue({ mcp_read_only: true, mcp_approval_policy: "trust" });
    await bridge.refreshMcpRegistry();
    expect(mocks.api.mcpSetActiveProject).toHaveBeenLastCalledWith("other");
    expect(mocks.api.mcpRegisterTools).toHaveBeenCalledTimes(2);
    expect(registeredNames()).not.toContain("write_file");
  });

  it("drops a registry build that was overtaken by a newer revocation", async () => {
    await bridge.startMcpBridge();
    let releaseConfig: (value: { mcp_read_only: boolean; mcp_approval_policy: string }) => void = () => {};
    mocks.api.getConfig.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseConfig = resolve;
      }),
    );
    const refresh = bridge.refreshMcpRegistry();
    await until(() => expect(mocks.api.getConfig).toHaveBeenCalledTimes(2));
    bridge.revokeMcpBridgeCalls();
    releaseConfig({ mcp_read_only: false, mcp_approval_policy: "ask" });
    await refresh;
    expect(mocks.api.mcpRegisterTools).toHaveBeenCalledOnce();
    call(1, "echo", { text: "x" });
    await settled(1);
    expect(textFor(1)).toBe(JSON.stringify({ error: "MCP tools are being refreshed. Retry shortly." }));
  });

  it("ignores a registration that finishes after the bridge was revoked", async () => {
    await bridge.startMcpBridge();
    let releaseRegister: () => void = () => {};
    mocks.api.mcpRegisterTools.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releaseRegister = resolve;
      }),
    );
    const refresh = bridge.refreshMcpRegistry();
    await until(() => expect(mocks.api.mcpRegisterTools).toHaveBeenCalledTimes(2));
    bridge.revokeMcpBridgeCalls();
    releaseRegister();
    await refresh;
    call(1, "echo", { text: "x" });
    await settled(1);
    expect(textFor(1)).toBe(JSON.stringify({ error: "MCP tools are being refreshed. Retry shortly." }));
  });

  it("ends the renderer session when the page is unloaded and starts a new one later", async () => {
    await bridge.startMcpBridge();
    const pagehide = mocks.windowListeners.get("pagehide");
    pagehide?.({ persisted: true });
    expect(mocks.api.mcpEndRendererSession).not.toHaveBeenCalled();
    pagehide?.({ persisted: false });
    await until(() => expect(mocks.api.mcpEndRendererSession).toHaveBeenCalledWith(41));
    expect(mocks.clearInterval).toHaveBeenCalledWith(1);
    pagehide?.({ persisted: false });
    expect(mocks.api.mcpEndRendererSession).toHaveBeenCalledOnce();

    mocks.api.mcpBeginRendererSession.mockResolvedValueOnce(43);
    await bridge.startMcpBridge();
    expect(mocks.api.mcpRegisterTools).toHaveBeenLastCalledWith(expect.any(Array), 43);
    expect(win.addEventListener).toHaveBeenCalledOnce();
  });

  it("swallows a failure to end the session on unload", async () => {
    await bridge.startMcpBridge();
    mocks.api.mcpEndRendererSession.mockRejectedValueOnce(new Error("already gone"));
    mocks.windowListeners.get("pagehide")?.({ persisted: false });
    await until(() => expect(mocks.api.mcpEndRendererSession).toHaveBeenCalledOnce());
  });
});
