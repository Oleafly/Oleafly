import { describe, expect, it } from "vitest";
import type { JsonRpcMessage } from "./json-rpc";
import {
  isLanguageServiceSetupRequiredError,
  TauriLanguageServiceTransport,
  type TauriLanguageServiceTransportOptions,
} from "./tauri-transport";
import type {
  LanguageServiceRuntimeSession,
  LanguageServiceSession,
  LanguageServiceTransportEvent,
} from "./transport";

type Command =
  | "language_service_start"
  | "language_service_send"
  | "language_service_stop"
  | "language_service_status"
  | "language_service_install"
  | "language_service_install_status";

interface Invocation {
  command: Command;
  args: Record<string, unknown>;
}

interface TestChannel {
  onmessage: (message: unknown) => void;
}

interface BackendHarness {
  options: TauriLanguageServiceTransportOptions;
  invocations: Invocation[];
  channels: TestChannel[];
  sessions: LanguageServiceRuntimeSession[];
}

function createHarness(): BackendHarness {
  const invocations: Invocation[] = [];
  const channels: TestChannel[] = [];
  const sessions: LanguageServiceRuntimeSession[] = [];
  let generation = 0;

  const invokeCommand = async <T>(
    command: Command,
    args: Record<string, unknown>,
  ): Promise<T> => {
    invocations.push({ command, args });
    const request = args.request as Record<string, unknown>;
    if (command === "language_service_install") {
      return {
        kind: request.kind,
        version: "5.26.0",
        state: "installed",
      } as T;
    }
    if (command === "language_service_install_status") {
      return {
        kind: request.kind,
        version: "5.26.0",
        state: "installed",
      } as T;
    }
    if (command === "language_service_start") {
      const session: LanguageServiceRuntimeSession = {
        session: `ls_${(generation + 1).toString(16).padStart(32, "0")}`,
        kind: request.kind as LanguageServiceSession["kind"],
        generation: ++generation,
        projectId: request.projectId as string,
        workspaceRoot: `/workspace/${String(request.projectId)}`,
      };
      sessions.push(session);
      const channel = args.onEvent as TestChannel;
      channel.onmessage({
        ...session,
        sequence: 1,
        event: "started",
        workspaceRoot: session.workspaceRoot,
      });
      return {
        ...session,
        projectId: session.projectId,
        workspaceRoot: session.workspaceRoot,
        status: "running",
      } as T;
    }
    const session = sessions.find(
      (candidate) =>
        candidate.session === request.session &&
        candidate.generation === request.generation,
    );
    if (!session) throw new Error("unknown test session");
    if (command === "language_service_send") {
      return {
        session: session.session,
        kind: session.kind,
        generation: session.generation,
        accepted: true,
        messageBytes: 42,
      } as T;
    }
    if (command === "language_service_status") {
      return {
        ...session,
        status: "running",
        exitCode: null,
        signal: null,
      } as T;
    }
    return {
      session: session.session,
      kind: session.kind,
      generation: session.generation,
      status: "stopped",
      alreadyStopped: false,
    } as T;
  };

  return {
    options: {
      invoke: invokeCommand,
      channelFactory: <T>(onmessage: (message: T) => void) => {
        const channel = {
          onmessage: onmessage as (message: unknown) => void,
        };
        channels.push(channel);
        return channel;
      },
    },
    invocations,
    channels,
    sessions,
  };
}

function backendEvent(
  session: LanguageServiceSession,
  event: Record<string, unknown>,
  sequence = 2,
) {
  return {
    session: session.session,
    kind: session.kind,
    generation: session.generation,
    sequence,
    ...event,
  };
}

describe("TauriLanguageServiceTransport", () => {
  it("uses the closed command DTOs and preserves the canonical backend identity", async () => {
    const harness = createHarness();
    const events: LanguageServiceTransportEvent[] = [];
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );

    const session = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      (event) => events.push(event),
    );
    expect(session).toEqual({
      session: "ls_00000000000000000000000000000001",
      kind: "texlab",
      generation: 1,
      projectId: "project-a",
      workspaceRoot: "/workspace/project-a",
    });
    expect(harness.invocations[0]).toMatchObject({
      command: "language_service_start",
      args: {
        request: { kind: "texlab", projectId: "project-a" },
      },
    });
    const startRequest = harness.invocations[0]?.args
      .request as Record<string, unknown>;
    expect(Object.keys(startRequest).sort()).toEqual([
      "kind",
      "projectId",
    ]);
    expect(startRequest).not.toHaveProperty("command");
    expect(startRequest).not.toHaveProperty("executable");
    expect(startRequest).not.toHaveProperty("args");

    harness.channels[0]?.onmessage(
      backendEvent(session, {
        event: "message",
        message: { jsonrpc: "2.0", id: 7, result: null },
      }),
    );
    expect(events).toEqual([
      {
        session: session.session,
        kind: session.kind,
        generation: session.generation,
        sequence: 2,
        type: "message",
        message: { jsonrpc: "2.0", id: 7, result: null },
      },
    ]);

    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: 8,
      method: "textDocument/hover",
      params: {},
    };
    await transport.send(session, message);
    await expect(transport.refreshStatus(session)).resolves.toMatchObject({
      state: "running",
      session,
    });
    await Promise.all([
      transport.stop(session),
      transport.stop(session),
    ]);
    await transport.stop(session);
    await expect(transport.installStatus?.("texlab")).resolves.toEqual({
      kind: "texlab",
      version: "5.26.0",
      state: "installed",
    });
    await expect(transport.install?.("texlab")).resolves.toEqual({
      kind: "texlab",
      version: "5.26.0",
      state: "installed",
    });

    expect(
      harness.invocations.map(({ command }) => command),
    ).toEqual([
      "language_service_start",
      "language_service_send",
      "language_service_status",
      "language_service_stop",
      "language_service_install_status",
      "language_service_install",
    ]);
    expect(harness.invocations[1]?.args).toEqual({
      request: {
        session: session.session,
        generation: session.generation,
        message,
      },
    });
    expect(harness.invocations[2]?.args).toEqual({
      request: {
        session: session.session,
        generation: session.generation,
      },
    });
    expect(harness.invocations[3]?.args).toEqual({
      request: {
        session: session.session,
        generation: session.generation,
      },
    });
    expect(transport.status()).toEqual({
      state: "stopped",
      session: null,
    });
  });

  it("buffers channel traffic until start returns and maps every event casing", async () => {
    const harness = createHarness();
    const events: LanguageServiceTransportEvent[] = [];
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );
    const session = await transport.start(
      { kind: "tinymist", projectId: "project-a" },
      (event) => events.push(event),
    );
    const channel = harness.channels[0];
    if (!channel) throw new Error("missing channel");

    channel.onmessage(
      backendEvent(
        session,
        { event: "stderr", text: "warning" },
        2,
      ),
    );
    channel.onmessage(
      backendEvent(
        session,
        {
          event: "stderr_truncated",
          limitBytes: 4096,
        },
        3,
      ),
    );
    channel.onmessage(
      backendEvent(
        session,
        {
          event: "protocol_error",
          code: "invalid_json",
          message: "bad payload",
        },
        4,
      ),
    );
    channel.onmessage(
      backendEvent(
        session,
        {
          event: "transport_error",
          stream: "stdout",
          message: "pipe closed",
        },
        5,
      ),
    );
    channel.onmessage(
      backendEvent(
        session,
        {
          event: "exited",
          status: "failed",
          exitCode: 9,
          signal: null,
          reason: "crashed",
        },
        6,
      ),
    );

    expect(events).toMatchObject([
      { type: "log", stream: "stderr", message: "warning" },
      {
        type: "log",
        stream: "stderr",
        message: expect.stringContaining("4096"),
      },
      {
        type: "error",
        error: "invalid_json: bad payload",
      },
      { type: "error", error: "stdout: pipe closed" },
      { type: "exit", code: 9, signal: null },
    ]);
    expect(transport.status()).toMatchObject({
      state: "error",
      session,
      error: "crashed",
    });
  });

  it("fails closed and stops the backend when pre-start events exceed the bounded queue", async () => {
    const invocations: Invocation[] = [];
    const emitted: LanguageServiceTransportEvent[] = [];
    const session: LanguageServiceRuntimeSession = {
      session: "ls_00000000000000000000000000000001",
      kind: "texlab",
      generation: 1,
      projectId: "project-a",
      workspaceRoot: "/workspace/project-a",
    };
    const transport = new TauriLanguageServiceTransport({
      channelFactory: <T>(onmessage: (message: T) => void) => ({
        onmessage,
      }),
      invoke: async <T>(
        command: Command,
        args: Record<string, unknown>,
      ): Promise<T> => {
        invocations.push({ command, args });
        if (command === "language_service_start") {
          const channel = args.onEvent as TestChannel;
          for (let sequence = 1; sequence <= 257; sequence += 1) {
            channel.onmessage(
              sequence === 1
                ? {
                    ...session,
                    sequence,
                    event: "started",
                  }
                : {
                    session: session.session,
                    kind: session.kind,
                    generation: session.generation,
                    sequence,
                    event: "stderr",
                    text: `startup event ${sequence}`,
                  },
            );
          }
          return {
            ...session,
            status: "running",
          } as T;
        }
        if (command === "language_service_stop") {
          return {
            session: session.session,
            kind: session.kind,
            generation: session.generation,
            status: "stopped",
            alreadyStopped: false,
          } as T;
        }
        throw new Error(`unexpected command ${command}`);
      },
    });

    await expect(
      transport.start(
        { kind: "texlab", projectId: "project-a" },
        (event) => emitted.push(event),
      ),
    ).rejects.toThrow("256-event queue limit");

    expect(emitted).toEqual([]);
    expect(invocations.map(({ command }) => command)).toEqual([
      "language_service_start",
      "language_service_stop",
    ]);
    expect(invocations[1]?.args).toEqual({
      request: {
        session: session.session,
        generation: session.generation,
      },
    });
    expect(transport.status()).toMatchObject({
      state: "error",
      session: null,
    });
  });

  it("ignores valid late traffic from an old session after restart", async () => {
    const harness = createHarness();
    const oldEvents: LanguageServiceTransportEvent[] = [];
    const newEvents: LanguageServiceTransportEvent[] = [];
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );
    const oldSession = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      (event) => oldEvents.push(event),
    );
    const oldChannel = harness.channels[0];
    if (!oldChannel) throw new Error("missing old channel");
    await transport.stop(oldSession);

    const newSession = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      (event) => newEvents.push(event),
    );
    oldChannel.onmessage(
      backendEvent(oldSession, {
        event: "exited",
        status: "failed",
        exitCode: 12,
        signal: null,
        reason: "late old exit",
      }),
    );
    harness.channels[1]?.onmessage(
      backendEvent(oldSession, {
        event: "message",
        message: { jsonrpc: "2.0", id: 1, result: "old" },
      }),
    );

    expect(oldEvents).toEqual([]);
    expect(newEvents).toEqual([]);
    expect(transport.status()).toMatchObject({
      state: "running",
      session: newSession,
    });
  });

  it("cannot let a delayed status response overwrite a replacement session", async () => {
    const harness = createHarness();
    const invoke = harness.options.invoke;
    if (!invoke) throw new Error("test invoke is unavailable");
    let resolveStatus = (_value: unknown) => {};
    const delayedStatus = new Promise<unknown>((resolve) => {
      resolveStatus = resolve;
    });
    harness.options.invoke = async <T>(
      command: Command,
      args: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "language_service_status") {
        return (await delayedStatus) as T;
      }
      return invoke<T>(command, args);
    };
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );
    const first = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      () => {},
    );
    const staleRefresh = transport.refreshStatus(first);
    await transport.stop(first);
    const second = await transport.start(
      { kind: "texlab", projectId: "project-b" },
      () => {},
    );

    resolveStatus({
      ...first,
      workspaceRoot: first.workspaceRoot,
      status: "running",
      exitCode: null,
      signal: null,
    });

    await expect(staleRefresh).rejects.toThrow(
      /superseded by another session/u,
    );
    expect(transport.status()).toEqual({
      state: "running",
      session: second,
    });
  });

  it("discards duplicate and out-of-order backend event sequences", async () => {
    const harness = createHarness();
    const events: LanguageServiceTransportEvent[] = [];
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );
    const session = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      (event) => events.push(event),
    );
    const channel = harness.channels[0];
    if (!channel) throw new Error("missing channel");
    const message = {
      event: "message",
      message: { jsonrpc: "2.0", id: 1, result: "current" },
    };
    channel.onmessage(backendEvent(session, message, 3));
    channel.onmessage(backendEvent(session, message, 3));
    channel.onmessage(backendEvent(session, message, 2));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "message",
      sequence: 3,
    });
  });

  it("fails closed on malformed events and never invokes stale operations", async () => {
    const harness = createHarness();
    const events: LanguageServiceTransportEvent[] = [];
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );
    const session = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      (event) => events.push(event),
    );
    harness.channels[0]?.onmessage(
      backendEvent(session, {
        event: "message",
        message: { jsonrpc: "2.0", result: "missing id" },
      }),
    );
    expect(events).toMatchObject([
      {
        ...session,
        type: "error",
        error: expect.stringContaining(
          "Invalid language-service event",
        ),
      },
    ]);

    const stale = { ...session, generation: session.generation + 1 };
    const before = harness.invocations.length;
    await expect(
      transport.refreshStatus(stale),
    ).rejects.toThrow("stale or unknown");
    await expect(
      transport.send(stale, {
        jsonrpc: "2.0",
        method: "initialized",
      }),
    ).rejects.toThrow("stale or unknown");
    await expect(transport.stop(stale)).rejects.toThrow(
      "stale or unknown",
    );
    expect(harness.invocations).toHaveLength(before);
  });

  it("rejects malformed and identity-swapped backend responses", async () => {
    const channelFactory = <T>(onmessage: (message: T) => void) => ({
      onmessage,
    });
    const wrongKind = new TauriLanguageServiceTransport({
      channelFactory,
      invoke: async <T>() =>
        ({
          session: "ls_00000000000000000000000000000001",
          kind: "tinymist",
          generation: 1,
          projectId: "project-a",
          workspaceRoot: "/workspace",
          status: "running",
        }) as T,
    });
    await expect(
      wrongKind.start(
        { kind: "texlab", projectId: "project-a" },
        () => {},
      ),
    ).rejects.toThrow("different project or kind");
    expect(wrongKind.status()).toMatchObject({ state: "error" });

    const malformedIdentity = new TauriLanguageServiceTransport({
      channelFactory,
      invoke: async <T>() =>
        ({
          session: "opaque",
          kind: "texlab",
          generation: 0,
          projectId: "project-a",
          workspaceRoot: "/workspace",
          status: "running",
        }) as T,
    });
    await expect(
      malformedIdentity.start(
        { kind: "texlab", projectId: "project-a" },
        () => {},
      ),
    ).rejects.toThrow("Malformed language-service session identity");

    const harness = createHarness();
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );
    const session = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      () => {},
    );
    const invalid = { nope: true } as unknown as JsonRpcMessage;
    const before = harness.invocations.length;
    await expect(transport.send(session, invalid)).rejects.toThrow(
      "JSON-RPC",
    );
    expect(harness.invocations).toHaveLength(before);
  });

  it("stops every spawned session whose later runtime DTO validation fails", async () => {
    const session = "ls_00000000000000000000000000000001";
    const cases: Array<{
      label: string;
      response: Record<string, unknown>;
    }> = [
      {
        label: "missing project",
        response: {
          session,
          kind: "texlab",
          generation: 1,
          workspaceRoot: "/workspace/project-a",
          status: "running",
        },
      },
      {
        label: "malformed project",
        response: {
          session,
          kind: "texlab",
          generation: 1,
          projectId: "",
          workspaceRoot: "/workspace/project-a",
          status: "running",
        },
      },
      {
        label: "missing root",
        response: {
          session,
          kind: "texlab",
          generation: 1,
          projectId: "project-a",
          status: "running",
        },
      },
      {
        label: "malformed root",
        response: {
          session,
          kind: "texlab",
          generation: 1,
          projectId: "project-a",
          workspaceRoot: "",
          status: "running",
        },
      },
      {
        label: "wrong kind",
        response: {
          session,
          kind: "tinymist",
          generation: 1,
          projectId: "project-a",
          workspaceRoot: "/workspace/project-a",
          status: "running",
        },
      },
      {
        label: "missing kind",
        response: {
          session,
          generation: 1,
          projectId: "project-a",
          workspaceRoot: "/workspace/project-a",
          status: "running",
        },
      },
      {
        label: "malformed kind",
        response: {
          session,
          kind: "latex-language-server",
          generation: 1,
          projectId: "project-a",
          workspaceRoot: "/workspace/project-a",
          status: "running",
        },
      },
    ];

    for (const testCase of cases) {
      const invocations: Invocation[] = [];
      const transport = new TauriLanguageServiceTransport({
        channelFactory: <T>(onmessage: (message: T) => void) => ({
          onmessage,
        }),
        invoke: async <T>(
          command: Command,
          args: Record<string, unknown>,
        ): Promise<T> => {
          invocations.push({ command, args });
          if (command === "language_service_start") {
            return testCase.response as T;
          }
          if (command === "language_service_stop") {
            return {
              session,
              kind: "texlab",
              generation: 1,
              status: "stopped",
              alreadyStopped: false,
            } as T;
          }
          throw new Error(
            `unexpected ${command} for ${testCase.label}`,
          );
        },
      });

      await expect(
        transport.start(
          { kind: "texlab", projectId: "project-a" },
          () => {},
        ),
        testCase.label,
      ).rejects.toThrow();
      expect(
        invocations.map(({ command }) => command),
        testCase.label,
      ).toEqual([
        "language_service_start",
        "language_service_stop",
      ]);
      expect(invocations[1]?.args, testCase.label).toEqual({
        request: { session, generation: 1 },
      });
      expect(transport.status(), testCase.label).toMatchObject({
        state: "error",
        session: null,
      });
    }
  });

  it("fails closed on DTO drift and canonical started-event changes", async () => {
    const harness = createHarness();
    const events: LanguageServiceTransportEvent[] = [];
    const transport = new TauriLanguageServiceTransport(
      harness.options,
    );
    const session = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      (event) => events.push(event),
    );
    const channel = harness.channels[0];
    if (!channel) throw new Error("missing channel");

    channel.onmessage(
      backendEvent(
        session,
        {
          event: "started",
          projectId: "project-b",
          workspaceRoot: session.workspaceRoot,
        },
        2,
      ),
    );
    channel.onmessage(
      backendEvent(
        session,
        {
          event: "message",
          message: { jsonrpc: "2.0", id: 1, result: null },
          unexpected: true,
        },
        3,
      ),
    );
    channel.onmessage(
      backendEvent(
        session,
        {
          event: "attached",
          status: "running",
        },
        4,
      ),
    );

    expect(events).toHaveLength(3);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          error: expect.stringContaining("canonical project identity"),
        }),
        expect.objectContaining({
          type: "error",
          error: expect.stringContaining("Malformed language-service message event"),
        }),
        expect.objectContaining({
          type: "error",
          error: expect.stringContaining("Unknown language-service event"),
        }),
      ]),
    );
  });

  it("rejects nonterminal stop responses without forgetting the session", async () => {
    const harness = createHarness();
    const transport = new TauriLanguageServiceTransport({
      ...harness.options,
      invoke: async <T>(
        command: Command,
        args: Record<string, unknown>,
      ) => {
        if (command !== "language_service_stop") {
          return harness.options.invoke?.<T>(command, args) as Promise<T>;
        }
        const request = args.request as Record<string, unknown>;
        return {
          session: request.session,
          kind: "texlab",
          generation: request.generation,
          status: "stopping",
          alreadyStopped: false,
        } as T;
      },
    });
    const session = await transport.start(
      { kind: "texlab", projectId: "project-a" },
      () => {},
    );

    await expect(transport.stop(session)).rejects.toThrow(
      "Malformed language-service stop response",
    );
    expect(transport.status()).toMatchObject({
      state: "error",
      session,
    });
  });

  it("normalizes structured Tauri rejection strings", async () => {
    const transport = new TauriLanguageServiceTransport({
      channelFactory: <T>(onmessage: (message: T) => void) => ({
        onmessage,
      }),
      invoke: async () => {
        throw JSON.stringify({
          code: "sidecar_setup_required",
          message: "TexLab is not installed",
          metadata: {
            kind: "texlab",
            version: "5.26.0",
          },
        });
      },
    });

    let caught: unknown;
    try {
      await transport.install("texlab");
    } catch (error) {
      caught = error;
    }

    expect(isLanguageServiceSetupRequiredError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: "sidecar_setup_required",
      message: "TexLab is not installed",
      kind: "texlab",
      version: "5.26.0",
    });
  });
});
