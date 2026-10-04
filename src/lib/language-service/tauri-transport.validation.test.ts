import { describe, expect, it } from "vitest";
import {
  LanguageServiceBackendError,
  TauriLanguageServiceTransport,
} from "./tauri-transport";
import type {
  LanguageServiceKind,
  LanguageServiceTransportEvent,
} from "./transport";

type Command =
  | "language_service_start"
  | "language_service_send"
  | "language_service_stop"
  | "language_service_status"
  | "language_service_install"
  | "language_service_install_status";

type Args = { request: Record<string, unknown> };
type Handler = (args: Args) => unknown;

const FIRST = `ls_${"1".padStart(32, "0")}`;
const SECOND = `ls_${"2".padStart(32, "0")}`;

function runtimeResponse(overrides: Record<string, unknown> = {}) {
  return {
    session: FIRST,
    kind: "texlab",
    generation: 1,
    projectId: "project-a",
    workspaceRoot: "/workspace/a",
    status: "running",
    ...overrides,
  };
}

function stopResponse({ request }: Args) {
  return {
    session: request.session,
    kind: "texlab",
    generation: request.generation,
    status: "stopped",
    alreadyStopped: false,
  };
}

function scripted(handlers: Partial<Record<Command, Handler>>) {
  const invocations: Array<{ command: Command; args: Args }> = [];
  const channels: Array<{ onmessage: (message: unknown) => void }> = [];
  const transport = new TauriLanguageServiceTransport({
    invoke: async <T>(command: Command, args: Record<string, unknown>) => {
      invocations.push({ command, args: args as Args });
      const handler = handlers[command];
      if (!handler) throw new Error(`unexpected ${command}`);
      return (await handler(args as Args)) as T;
    },
    channelFactory: <T>(onmessage: (message: T) => void) => {
      const channel = { onmessage: onmessage as (message: unknown) => void };
      channels.push(channel);
      return channel;
    },
  });
  return { transport, invocations, channels };
}

async function startedTransport(
  handlers: Partial<Record<Command, Handler>> = {},
) {
  const harness = scripted({
    language_service_start: () => runtimeResponse(),
    language_service_stop: stopResponse,
    ...handlers,
  });
  const events: LanguageServiceTransportEvent[] = [];
  const session = await harness.transport.start(
    { kind: "texlab", projectId: "project-a" },
    (event) => events.push(event),
  );
  return { ...harness, events, session };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

describe("TauriLanguageServiceTransport backend errors", () => {
  it("normalizes plain, numeric and native rejections into errors", async () => {
    const native = new Error("native failure");
    const failures: unknown[] = ["plain text", 42, native];
    const { transport } = scripted({
      language_service_install: () => {
        throw failures.shift();
      },
    });

    const text = await rejection(transport.install("texlab"));
    expect(text).toBeInstanceOf(Error);
    expect(text).not.toBeInstanceOf(LanguageServiceBackendError);
    expect(text).toMatchObject({ message: "plain text" });
    await expect(transport.install("texlab")).rejects.toThrow("42");
    await expect(transport.install("texlab")).rejects.toMatchObject({
      name: "LanguageServiceBackendError",
      code: "backend_error",
      message: "native failure",
    });
  });

  it("builds backend errors from structured rejections with or without metadata", async () => {
    const failures: unknown[] = [
      { code: "download_failed" },
      { code: 5, message: "odd code", kind: "tinymist", version: "0.13.30" },
    ];
    const { transport } = scripted({
      language_service_install_status: () => {
        throw failures.shift();
      },
    });

    await expect(transport.installStatus("texlab")).rejects.toMatchObject({
      name: "LanguageServiceBackendError",
      code: "download_failed",
      message: "Language-service backend command failed",
    });
    const odd = await rejection(transport.installStatus("tinymist"));
    expect(odd).toBeInstanceOf(LanguageServiceBackendError);
    expect(odd).toMatchObject({
      code: "backend_error",
      message: "odd code",
      kind: "tinymist",
      version: "0.13.30",
    });
  });

  it("refuses unknown kinds and missing project ids before calling the backend", async () => {
    const { transport, invocations } = scripted({});
    const latex = "latex" as LanguageServiceKind;
    await expect(transport.install(latex)).rejects.toThrow(
      "Unsupported language-service kind",
    );
    await expect(transport.installStatus(latex)).rejects.toThrow(
      "Unsupported language-service kind",
    );
    await expect(
      transport.start({ kind: latex, projectId: "project-a" }, () => {}),
    ).rejects.toThrow("Unsupported language-service kind");
    await expect(
      transport.start({ kind: "texlab", projectId: "  " }, () => {}),
    ).rejects.toThrow("Language-service project id is required");
    expect(invocations).toEqual([]);
  });
});

describe("TauriLanguageServiceTransport install DTOs", () => {
  it.each([
    [{ kind: "texlab", version: "5.26.0", state: "installed", extra: 1 }],
    [{ kind: "tinymist", version: "5.26.0", state: "installed" }],
    [{ kind: "texlab", version: " ", state: "installed" }],
    [{ kind: "texlab", version: "5.26.0", state: "missing" }],
  ])("rejects the install response %o", async (response) => {
    const { transport } = scripted({
      language_service_install: () => response,
    });
    await expect(transport.install("texlab")).rejects.toThrow(
      "Malformed language-service install response",
    );
  });

  it.each([
    [{ kind: "texlab", version: "5.26.0", state: "installed", message: 5 }],
    [{ kind: "texlab", version: "5.26.0", state: "unknown" }],
    [{ kind: "texlab", version: "", state: "missing" }],
  ])("rejects the install-status response %o", async (response) => {
    const { transport } = scripted({
      language_service_install_status: () => response,
    });
    await expect(transport.installStatus("texlab")).rejects.toThrow(
      "Malformed language-service install-status response",
    );
  });

  it("keeps the backend's install-status message", async () => {
    const { transport } = scripted({
      language_service_install_status: () => ({
        kind: "texlab",
        version: "5.26.0",
        state: "failed",
        message: "Checksum mismatch",
      }),
    });
    await expect(transport.installStatus("texlab")).resolves.toEqual({
      kind: "texlab",
      version: "5.26.0",
      state: "failed",
      message: "Checksum mismatch",
    });
  });
});

describe("TauriLanguageServiceTransport start", () => {
  it("refuses a second start while a session is active", async () => {
    const { transport, invocations } = await startedTransport();
    await expect(
      transport.start({ kind: "texlab", projectId: "project-a" }, () => {}),
    ).rejects.toThrow("Language-service transport is already active");
    expect(invocations.map(({ command }) => command)).toEqual([
      "language_service_start",
    ]);
  });

  it.each([
    [
      runtimeResponse({ status: "exited" }),
      "Language-service start did not reach running state (exited)",
    ],
    [
      runtimeResponse({ status: "bogus" }),
      "Malformed language-service start response",
    ],
  ])("stops a spawned session whose start response is %o", async (response, message) => {
    const { transport, invocations } = scripted({
      language_service_start: () => response,
      language_service_stop: stopResponse,
    });
    await expect(
      transport.start({ kind: "texlab", projectId: "project-a" }, () => {}),
    ).rejects.toThrow(message);
    expect(invocations.map(({ command }) => command)).toEqual([
      "language_service_start",
      "language_service_stop",
    ]);
    expect(transport.status()).toMatchObject({ state: "error", session: null });
  });

  it.each([
    [{}],
    [
      {
        session: SECOND,
        kind: "texlab",
        generation: 1,
        status: "stopped",
        alreadyStopped: false,
      },
    ],
  ])("reports a cleanup stop answered with %o", async (stopAnswer) => {
    const { transport } = scripted({
      language_service_start: () => runtimeResponse({ status: "exited" }),
      language_service_stop: () => stopAnswer,
    });
    await expect(
      transport.start({ kind: "texlab", projectId: "project-a" }, () => {}),
    ).rejects.toThrow(
      "Backend cleanup also failed: Malformed language-service stop response",
    );
  });

  it("retries a failed start's cleanup before the next start and through cleanup()", async () => {
    let starts = 0;
    let stopFailures = 3;
    const { transport, invocations } = scripted({
      language_service_start: () => {
        starts += 1;
        return starts === 1
          ? runtimeResponse({ status: "exited" })
          : runtimeResponse({ session: SECOND, generation: 2 });
      },
      language_service_stop: (args) => {
        if (stopFailures > 0) {
          stopFailures -= 1;
          throw "stop refused";
        }
        return stopResponse(args);
      },
    });
    const start = () =>
      transport.start({ kind: "texlab", projectId: "project-a" }, () => {});

    await expect(start()).rejects.toThrow(
      "did not reach running state (exited). Backend cleanup also failed: stop refused",
    );
    await expect(start()).rejects.toThrow(
      "A failed language-service startup could not be cleaned up: stop refused",
    );
    expect(transport.status()).toMatchObject({
      state: "error",
      error:
        "A failed language-service startup could not be cleaned up: stop refused",
    });
    expect(starts).toBe(1);

    await expect(transport.cleanup()).rejects.toThrow("stop refused");
    await expect(transport.cleanup()).resolves.toBeUndefined();
    expect(transport.status()).toEqual({ state: "stopped", session: null });

    await expect(start()).resolves.toMatchObject({
      session: SECOND,
      generation: 2,
    });
    expect(invocations.map(({ command }) => command)).toEqual([
      "language_service_start",
      "language_service_stop",
      "language_service_stop",
      "language_service_stop",
      "language_service_stop",
      "language_service_start",
    ]);
  });
});

describe("TauriLanguageServiceTransport session commands", () => {
  it("rejects refused, malformed and misaddressed send responses", async () => {
    const answers: unknown[] = [
      {
        session: FIRST,
        kind: "texlab",
        generation: 1,
        accepted: false,
        messageBytes: 10,
      },
      { session: FIRST, kind: "texlab", generation: 1, accepted: true },
      {
        session: FIRST,
        kind: "texlab",
        generation: 1,
        accepted: "yes",
        messageBytes: 10,
      },
      {
        session: SECOND,
        kind: "texlab",
        generation: 1,
        accepted: true,
        messageBytes: 10,
      },
    ];
    const { transport, session } = await startedTransport({
      language_service_send: () => {
        const answer = answers.shift();
        if (answer === undefined) {
          throw { code: "backpressure", message: "queue full" };
        }
        return answer;
      },
    });
    const send = () =>
      transport.send(session, { jsonrpc: "2.0", method: "initialized" });

    await expect(send()).rejects.toThrow(
      "Language-service backend rejected the message",
    );
    await expect(send()).rejects.toThrow(
      "Malformed language-service send response",
    );
    await expect(send()).rejects.toThrow(
      "Malformed language-service send response",
    );
    await expect(send()).rejects.toThrow(
      "Language-service response identity does not match the active session",
    );
    await expect(send()).rejects.toMatchObject({
      code: "backpressure",
      message: "queue full",
    });
  });

  it("rejects malformed status responses and maps stopping and exited states", async () => {
    const statuses: unknown[] = [
      { ...runtimeResponse() },
      {
        ...runtimeResponse({ projectId: "project-b" }),
        exitCode: null,
        signal: null,
      },
      { ...runtimeResponse({ status: "stopping" }), exitCode: null, signal: null },
      { ...runtimeResponse({ status: "exited" }), exitCode: 1, signal: null },
    ];
    const { transport, session } = await startedTransport({
      language_service_status: () => statuses.shift(),
    });

    await expect(transport.refreshStatus(session)).rejects.toThrow(
      "Malformed language-service status response",
    );
    await expect(transport.refreshStatus(session)).rejects.toThrow(
      "Malformed language-service status response",
    );
    await expect(transport.refreshStatus(session)).resolves.toMatchObject({
      state: "stopping",
    });
    await expect(transport.refreshStatus(session)).resolves.toMatchObject({
      state: "exited",
      session,
    });
  });

  it.each([
    [{ session: FIRST, kind: "texlab", generation: 1, status: "stopped" }],
    [
      {
        session: SECOND,
        kind: "texlab",
        generation: 1,
        status: "stopped",
        alreadyStopped: false,
      },
    ],
  ])("keeps the session when the stop response is %o", async (answer) => {
    const { transport, session } = await startedTransport({
      language_service_stop: () => answer,
    });
    await expect(transport.stop(session)).rejects.toThrow(/stop response|identity/u);
    expect(transport.status()).toMatchObject({ state: "error", session });
  });
});

describe("TauriLanguageServiceTransport events", () => {
  it.each([
    [
      { event: "started", projectId: "project-a", workspaceRoot: "/workspace/a", extra: 1 },
      "Malformed language-service started event",
    ],
    [{ event: "stderr", text: 5 }, "Malformed language-service stderr event"],
    [
      { event: "stderr_truncated", limitBytes: -1 },
      "Malformed language-service stderr_truncated event",
    ],
    [
      { event: "protocol_error", code: "nope", message: "bad" },
      "Malformed language-service protocol_error event",
    ],
    [
      { event: "transport_error", stream: "stdlog", message: "bad" },
      "Malformed language-service transport_error event",
    ],
    [
      {
        event: "exited",
        status: "running",
        exitCode: 0,
        signal: null,
        reason: "done",
      },
      "Malformed language-service exited event",
    ],
    [{ event: 5 }, "Malformed language-service event envelope"],
  ])("reports the malformed event %o as a transport error", async (payload, message) => {
    const { channels, events, session } = await startedTransport();
    channels[0]?.onmessage({
      session: session.session,
      kind: session.kind,
      generation: session.generation,
      sequence: 2,
      ...payload,
    });
    expect(events).toEqual([
      {
        session: session.session,
        kind: session.kind,
        generation: session.generation,
        projectId: session.projectId,
        workspaceRoot: session.workspaceRoot,
        sequence: 2,
        type: "error",
        error: `Invalid language-service event: ${message}`,
      },
    ]);
  });

  it("numbers an event with an unreadable session after the last one it saw", async () => {
    const { channels, events, session } = await startedTransport();
    channels[0]?.onmessage({
      session: session.session,
      kind: "texlab",
      generation: 1,
      sequence: 4,
      event: "stderr",
      text: "warming up",
    });
    channels[0]?.onmessage({
      session: "not-a-session",
      kind: "texlab",
      generation: 1,
      sequence: 9,
      event: "stderr",
      text: "lost",
    });
    expect(events.map((event) => [event.type, event.sequence])).toEqual([
      ["log", 4],
      ["error", 5],
    ]);
    expect(events[1]).toMatchObject({
      error: expect.stringContaining("Malformed language-service session identity"),
    });
  });

  it("records an exit without a reason and ignores events once stopped", async () => {
    const { transport, channels, events, session } = await startedTransport();
    const exit = {
      session: session.session,
      kind: "texlab",
      generation: 1,
      sequence: 2,
      event: "exited",
      status: "exited",
      exitCode: 0,
      signal: null,
      reason: "",
    };
    channels[0]?.onmessage(exit);
    expect(transport.status()).toEqual({ state: "exited", session });
    expect(events).toEqual([
      {
        session: session.session,
        kind: "texlab",
        generation: 1,
        sequence: 2,
        type: "exit",
        code: 0,
        signal: null,
      },
    ]);

    await transport.stop(session);
    channels[0]?.onmessage({ ...exit, sequence: 3 });
    expect(events).toHaveLength(1);
  });
});
