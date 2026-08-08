import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  parseJsonRpcMessage,
  type JsonRpcMessage,
} from "./json-rpc";
import type {
  LanguageServiceEventSink,
  LanguageServiceInstallResult,
  LanguageServiceInstallStatus,
  LanguageServiceKind,
  LanguageServiceRuntimeSession,
  LanguageServiceSession,
  LanguageServiceStartOptions,
  LanguageServiceTransport,
  LanguageServiceTransportEvent,
  LanguageServiceTransportState,
  LanguageServiceTransportStatus,
} from "./transport";

const COMMANDS = {
  start: "language_service_start",
  send: "language_service_send",
  stop: "language_service_stop",
  status: "language_service_status",
  install: "language_service_install",
  installStatus: "language_service_install_status",
} as const;

const MAX_PRESTART_EVENTS = 256;

type LanguageServiceCommand =
  (typeof COMMANDS)[keyof typeof COMMANDS];

type InvokeCommand = <T>(
  command: LanguageServiceCommand,
  args: Record<string, unknown>,
) => Promise<T>;

interface EventChannel<T> {
  onmessage: (message: T) => void;
}

type ChannelFactory = <T>(
  onmessage: (message: T) => void,
) => EventChannel<T>;

export interface TauriLanguageServiceTransportOptions {
  invoke?: InvokeCommand;
  channelFactory?: ChannelFactory;
}

type BackendStatus =
  | "running"
  | "stopping"
  | "exited"
  | "stopped"
  | "failed";

type BackendProtocolErrorCode =
  | "header_too_large"
  | "invalid_header"
  | "missing_content_length"
  | "duplicate_content_length"
  | "invalid_content_length"
  | "message_too_large"
  | "invalid_utf8"
  | "invalid_json"
  | "invalid_json_rpc"
  | "unexpected_eof";

interface BackendStartResponse extends LanguageServiceRuntimeSession {
  status: BackendStatus;
}

interface BackendSendResponse extends LanguageServiceSession {
  accepted: boolean;
  messageBytes: number;
}

interface BackendStopResponse extends LanguageServiceSession {
  status: BackendStatus;
  alreadyStopped: boolean;
}

interface BackendStatusResponse extends LanguageServiceRuntimeSession {
  status: BackendStatus;
  exitCode: number | null;
  signal: number | null;
}

interface BackendCleanupSession {
  session: string;
  generation: number;
}

type BackendEvent =
  | (LanguageServiceSession & {
      sequence: number;
      event: "started";
      projectId: string;
      workspaceRoot: string;
    })
  | (LanguageServiceSession & {
      sequence: number;
      event: "message";
      message: JsonRpcMessage;
    })
  | (LanguageServiceSession & {
      sequence: number;
      event: "stderr";
      text: string;
    })
  | (LanguageServiceSession & {
      sequence: number;
      event: "stderr_truncated";
      limitBytes: number;
    })
  | (LanguageServiceSession & {
      sequence: number;
      event: "protocol_error";
      code: BackendProtocolErrorCode;
      message: string;
    })
  | (LanguageServiceSession & {
      sequence: number;
      event: "transport_error";
      stream: "stdin" | "stdout" | "stderr";
      message: string;
    })
  | (LanguageServiceSession & {
      sequence: number;
      event: "exited";
      status: BackendStatus;
      exitCode: number | null;
      signal: number | null;
      reason: string;
    });

const SESSION_PATTERN = /^ls_[0-9a-f]{32}$/;

const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const received = Object.keys(value);
  return (
    received.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isSafeNonNegativeInteger = (
  value: unknown,
): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0;

const isSafePositiveInteger = (value: unknown): value is number =>
  isSafeNonNegativeInteger(value) && value > 0;

const isNullableInteger = (
  value: unknown,
): value is number | null =>
  value === null ||
  (typeof value === "number" && Number.isSafeInteger(value));

const isLanguageServiceKind = (
  value: unknown,
): value is LanguageServiceKind =>
  value === "texlab" || value === "tinymist";

const isBackendStatus = (
  value: unknown,
): value is BackendStatus =>
  value === "running" ||
  value === "stopping" ||
  value === "exited" ||
  value === "stopped" ||
  value === "failed";

const isTerminalBackendStatus = (
  value: unknown,
): value is Extract<BackendStatus, "exited" | "stopped" | "failed"> =>
  value === "exited" || value === "stopped" || value === "failed";

const isBackendProtocolErrorCode = (
  value: unknown,
): value is BackendProtocolErrorCode =>
  value === "header_too_large" ||
  value === "invalid_header" ||
  value === "missing_content_length" ||
  value === "duplicate_content_length" ||
  value === "invalid_content_length" ||
  value === "message_too_large" ||
  value === "invalid_utf8" ||
  value === "invalid_json" ||
  value === "invalid_json_rpc" ||
  value === "unexpected_eof";

export class LanguageServiceBackendError extends Error {
  readonly code: string;
  readonly kind?: LanguageServiceKind;
  readonly version?: string;

  constructor(
    code: string,
    message: string,
    metadata: {
      kind?: LanguageServiceKind;
      version?: string;
    } = {},
  ) {
    super(message);
    this.name = "LanguageServiceBackendError";
    this.code = code;
    this.kind = metadata.kind;
    this.version = metadata.version;
  }
}

export function isLanguageServiceSetupRequiredError(
  error: unknown,
): error is LanguageServiceBackendError {
  return (
    error instanceof LanguageServiceBackendError &&
    error.code === "sidecar_setup_required"
  );
}

function backendError(value: unknown): Error {
  if (value instanceof LanguageServiceBackendError) return value;
  if (typeof value === "string") {
    try {
      return backendError(JSON.parse(value));
    } catch {
      return new Error(value);
    }
  }
  if (isRecord(value)) {
    const metadata = isRecord(value.metadata)
      ? value.metadata
      : value;
    const code =
      typeof value.code === "string" ? value.code : "backend_error";
    const message =
      typeof value.message === "string"
        ? value.message
        : "Language-service backend command failed";
    const kind = isLanguageServiceKind(metadata.kind)
      ? metadata.kind
      : undefined;
    const version =
      typeof metadata.version === "string"
        ? metadata.version
        : undefined;
    return new LanguageServiceBackendError(code, message, {
      ...(kind ? { kind } : {}),
      ...(version ? { version } : {}),
    });
  }
  return value instanceof Error ? value : new Error(String(value));
}

function parseSession(value: unknown): LanguageServiceSession {
  if (
    !isRecord(value) ||
    typeof value.session !== "string" ||
    !SESSION_PATTERN.test(value.session) ||
    !isLanguageServiceKind(value.kind) ||
    !isSafePositiveInteger(value.generation)
  ) {
    throw new Error("Malformed language-service session identity");
  }
  return {
    session: value.session,
    kind: value.kind,
    generation: value.generation,
  };
}

function sessionForCleanup(
  value: unknown,
): BackendCleanupSession | null {
  if (
    !isRecord(value) ||
    typeof value.session !== "string" ||
    !SESSION_PATTERN.test(value.session) ||
    !isSafePositiveInteger(value.generation)
  ) {
    return null;
  }
  return {
    session: value.session,
    generation: value.generation,
  };
}

function parseRuntimeSession(
  value: unknown,
): LanguageServiceRuntimeSession {
  const session = parseSession(value);
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.projectId) ||
    !isNonEmptyString(value.workspaceRoot)
  ) {
    throw new Error("Malformed language-service runtime identity");
  }
  return {
    ...session,
    projectId: value.projectId,
    workspaceRoot: value.workspaceRoot,
  };
}

function sameSession(
  left: LanguageServiceSession | null,
  right: LanguageServiceSession,
): boolean {
  return Boolean(
    left &&
      left.session === right.session &&
      left.kind === right.kind &&
      left.generation === right.generation,
  );
}

function assertResponseIdentity(
  value: unknown,
  expected: LanguageServiceSession,
): asserts value is Record<string, unknown> {
  const received = parseSession(value);
  if (!sameSession(received, expected)) {
    throw new Error(
      "Language-service response identity does not match the active session",
    );
  }
}

function parseStartResponse(value: unknown): BackendStartResponse {
  if (
    !hasExactKeys(value, [
      "session",
      "kind",
      "generation",
      "projectId",
      "workspaceRoot",
      "status",
    ])
  ) {
    throw new Error("Malformed language-service start response");
  }
  const session = parseRuntimeSession(value);
  if (!isBackendStatus(value.status)) {
    throw new Error("Malformed language-service start response");
  }
  return { ...session, status: value.status };
}

function parseSendResponse(
  value: unknown,
  expected: LanguageServiceSession,
): BackendSendResponse {
  if (
    !hasExactKeys(value, [
      "session",
      "kind",
      "generation",
      "accepted",
      "messageBytes",
    ])
  ) {
    throw new Error("Malformed language-service send response");
  }
  assertResponseIdentity(value, expected);
  if (
    typeof value.accepted !== "boolean" ||
    !isSafeNonNegativeInteger(value.messageBytes)
  ) {
    throw new Error("Malformed language-service send response");
  }
  return {
    ...expected,
    accepted: value.accepted,
    messageBytes: value.messageBytes,
  };
}

function parseStopResponse(
  value: unknown,
  expected: LanguageServiceSession,
): BackendStopResponse {
  if (
    !hasExactKeys(value, [
      "session",
      "kind",
      "generation",
      "status",
      "alreadyStopped",
    ])
  ) {
    throw new Error("Malformed language-service stop response");
  }
  assertResponseIdentity(value, expected);
  if (
    !isTerminalBackendStatus(value.status) ||
    typeof value.alreadyStopped !== "boolean"
  ) {
    throw new Error("Malformed language-service stop response");
  }
  return {
    ...expected,
    status: value.status,
    alreadyStopped: value.alreadyStopped,
  };
}

function parseCleanupStopResponse(
  value: unknown,
  expected: BackendCleanupSession,
): BackendStopResponse {
  if (
    !hasExactKeys(value, [
      "session",
      "kind",
      "generation",
      "status",
      "alreadyStopped",
    ])
  ) {
    throw new Error("Malformed language-service stop response");
  }
  const received = parseSession(value);
  if (
    received.session !== expected.session ||
    received.generation !== expected.generation ||
    !isTerminalBackendStatus(value.status) ||
    typeof value.alreadyStopped !== "boolean"
  ) {
    throw new Error("Malformed language-service stop response");
  }
  return {
    ...received,
    status: value.status,
    alreadyStopped: value.alreadyStopped,
  };
}

function parseStatusResponse(
  value: unknown,
  expected: LanguageServiceRuntimeSession,
): BackendStatusResponse {
  if (
    !hasExactKeys(value, [
      "session",
      "kind",
      "generation",
      "projectId",
      "workspaceRoot",
      "status",
      "exitCode",
      "signal",
    ])
  ) {
    throw new Error("Malformed language-service status response");
  }
  const received = parseRuntimeSession(value);
  if (
    !sameSession(received, expected) ||
    received.projectId !== expected.projectId ||
    received.workspaceRoot !== expected.workspaceRoot ||
    !isRecord(value) ||
    !isBackendStatus(value.status) ||
    !isNullableInteger(value.exitCode) ||
    !isNullableInteger(value.signal)
  ) {
    throw new Error("Malformed language-service status response");
  }
  return {
    ...received,
    status: value.status,
    exitCode: value.exitCode,
    signal: value.signal,
  };
}

function parseInstallResult(
  value: unknown,
  expectedKind: LanguageServiceKind,
): LanguageServiceInstallResult {
  if (
    !hasExactKeys(value, ["kind", "version", "state"]) ||
    value.kind !== expectedKind ||
    !isNonEmptyString(value.version) ||
    (value.state !== "installed" &&
      value.state !== "already_installed")
  ) {
    throw new Error("Malformed language-service install response");
  }
  return {
    kind: expectedKind,
    version: value.version,
    state: value.state,
  };
}

function parseInstallStatus(
  value: unknown,
  expectedKind: LanguageServiceKind,
): LanguageServiceInstallStatus {
  const expectedKeys =
    isRecord(value) && typeof value.message === "string"
      ? ["kind", "version", "state", "message"]
      : ["kind", "version", "state"];
  if (
    !hasExactKeys(value, expectedKeys) ||
    value.kind !== expectedKind ||
    !isNonEmptyString(value.version) ||
    (value.state !== "installed" &&
      value.state !== "missing" &&
      value.state !== "installing" &&
      value.state !== "failed") ||
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    throw new Error(
      "Malformed language-service install-status response",
    );
  }
  return {
    kind: expectedKind,
    version: value.version,
    state: value.state,
    ...(typeof value.message === "string"
      ? { message: value.message }
      : {}),
  };
}

function parseBackendEvent(value: unknown): BackendEvent {
  const session = parseSession(value);
  if (
    !isRecord(value) ||
    !isSafePositiveInteger(value.sequence) ||
    typeof value.event !== "string"
  ) {
    throw new Error("Malformed language-service event envelope");
  }
  const base = { ...session, sequence: value.sequence };
  switch (value.event) {
    case "started":
      if (
        !hasExactKeys(value, [
          "session",
          "kind",
          "generation",
          "sequence",
          "event",
          "projectId",
          "workspaceRoot",
        ]) ||
        !isNonEmptyString(value.projectId) ||
        !isNonEmptyString(value.workspaceRoot)
      ) {
        throw new Error("Malformed language-service started event");
      }
      return {
        ...base,
        event: "started",
        projectId: value.projectId,
        workspaceRoot: value.workspaceRoot,
      };
    case "message":
      if (
        !hasExactKeys(value, [
          "session",
          "kind",
          "generation",
          "sequence",
          "event",
          "message",
        ])
      ) {
        throw new Error("Malformed language-service message event");
      }
      return {
        ...base,
        event: "message",
        message: parseJsonRpcMessage(value.message),
      };
    case "stderr":
      if (
        !hasExactKeys(value, [
          "session",
          "kind",
          "generation",
          "sequence",
          "event",
          "text",
        ]) ||
        typeof value.text !== "string"
      ) {
        throw new Error("Malformed language-service stderr event");
      }
      return { ...base, event: "stderr", text: value.text };
    case "stderr_truncated":
      if (
        !hasExactKeys(value, [
          "session",
          "kind",
          "generation",
          "sequence",
          "event",
          "limitBytes",
        ]) ||
        !isSafeNonNegativeInteger(value.limitBytes)
      ) {
        throw new Error(
          "Malformed language-service stderr_truncated event",
        );
      }
      return {
        ...base,
        event: "stderr_truncated",
        limitBytes: value.limitBytes,
      };
    case "protocol_error":
      if (
        !hasExactKeys(value, [
          "session",
          "kind",
          "generation",
          "sequence",
          "event",
          "code",
          "message",
        ]) ||
        !isBackendProtocolErrorCode(value.code) ||
        !isNonEmptyString(value.message)
      ) {
        throw new Error(
          "Malformed language-service protocol_error event",
        );
      }
      return {
        ...base,
        event: "protocol_error",
        code: value.code,
        message: value.message,
      };
    case "transport_error":
      if (
        !hasExactKeys(value, [
          "session",
          "kind",
          "generation",
          "sequence",
          "event",
          "stream",
          "message",
        ]) ||
        (value.stream !== "stdin" &&
          value.stream !== "stdout" &&
          value.stream !== "stderr") ||
        !isNonEmptyString(value.message)
      ) {
        throw new Error(
          "Malformed language-service transport_error event",
        );
      }
      return {
        ...base,
        event: "transport_error",
        stream: value.stream,
        message: value.message,
      };
    case "exited":
      if (
        !hasExactKeys(value, [
          "session",
          "kind",
          "generation",
          "sequence",
          "event",
          "status",
          "exitCode",
          "signal",
          "reason",
        ]) ||
        !isTerminalBackendStatus(value.status) ||
        !isNullableInteger(value.exitCode) ||
        !isNullableInteger(value.signal) ||
        typeof value.reason !== "string"
      ) {
        throw new Error("Malformed language-service exited event");
      }
      return {
        ...base,
        event: "exited",
        status: value.status,
        exitCode: value.exitCode,
        signal: value.signal,
        reason: value.reason,
      };
    default:
      throw new Error(
        `Unknown language-service event: ${value.event}`,
      );
  }
}

function transportState(
  status: BackendStatus,
): LanguageServiceTransportState {
  switch (status) {
    case "running":
      return "running";
    case "stopping":
      return "stopping";
    case "exited":
      return "exited";
    case "stopped":
      return "stopped";
    case "failed":
      return "error";
  }
}

function eventForBackendEvent(
  event: BackendEvent,
): LanguageServiceTransportEvent | null {
  const identity = {
    session: event.session,
    kind: event.kind,
    generation: event.generation,
    sequence: event.sequence,
  };
  switch (event.event) {
    case "started":
      return null;
    case "message":
      return { ...identity, type: "message", message: event.message };
    case "stderr":
      return {
        ...identity,
        type: "log",
        stream: "stderr",
        message: event.text,
      };
    case "stderr_truncated":
      return {
        ...identity,
        type: "log",
        stream: "stderr",
        message: `Language-service stderr was truncated after ${event.limitBytes} bytes`,
      };
    case "protocol_error":
      return {
        ...identity,
        type: "error",
        error: `${event.code}: ${event.message}`,
      };
    case "transport_error":
      return {
        ...identity,
        type: "error",
        error: `${event.stream}: ${event.message}`,
      };
    case "exited":
      return {
        ...identity,
        type: "exit",
        code: event.exitCode,
        signal: event.signal,
      };
  }
}

export function isTauriLanguageServiceAvailable(): boolean {
  return isTauri();
}

export function createTauriLanguageServiceTransport(): TauriLanguageServiceTransport {
  return new TauriLanguageServiceTransport();
}

/**
 * Sole frontend owner of the fixed language-service IPC allowlist. Callers
 * provide only a project id and closed server kind; the backend resolves the
 * canonical workspace and executable profile.
 */
export class TauriLanguageServiceTransport
  implements LanguageServiceTransport
{
  private readonly invokeCommand: InvokeCommand;
  private readonly createChannel: ChannelFactory;
  private transportStatus: LanguageServiceTransportStatus = {
    state: "stopped",
    session: null,
  };
  private activeSession: LanguageServiceRuntimeSession | null = null;
  private lastStoppedSession: LanguageServiceRuntimeSession | null =
    null;
  private failedStartSession: BackendCleanupSession | null =
    null;
  private stopInFlight: {
    session: LanguageServiceSession;
    promise: Promise<void>;
  } | null = null;
  private startAttempt = 0;
  private lastEventSequence = 0;

  constructor(options: TauriLanguageServiceTransportOptions = {}) {
    this.invokeCommand =
      options.invoke ??
      ((command, args) => invoke(command, args));
    this.createChannel =
      options.channelFactory ??
      ((onmessage) => new Channel(onmessage));
  }

  status(): LanguageServiceTransportStatus {
    return {
      ...this.transportStatus,
      session: this.transportStatus.session
        ? { ...this.transportStatus.session }
        : null,
    };
  }

  async install(
    kind: LanguageServiceKind,
  ): Promise<LanguageServiceInstallResult> {
    if (!isLanguageServiceKind(kind)) {
      throw new Error("Unsupported language-service kind");
    }
    try {
      return parseInstallResult(
        await this.invokeCommand<unknown>(COMMANDS.install, {
          request: { kind },
        }),
        kind,
      );
    } catch (error) {
      throw backendError(error);
    }
  }

  async installStatus(
    kind: LanguageServiceKind,
  ): Promise<LanguageServiceInstallStatus> {
    if (!isLanguageServiceKind(kind)) {
      throw new Error("Unsupported language-service kind");
    }
    try {
      return parseInstallStatus(
        await this.invokeCommand<unknown>(COMMANDS.installStatus, {
          request: { kind },
        }),
        kind,
      );
    } catch (error) {
      throw backendError(error);
    }
  }

  async start(
    options: LanguageServiceStartOptions,
    sink: LanguageServiceEventSink,
  ): Promise<LanguageServiceRuntimeSession> {
    if (this.activeSession || this.transportStatus.state === "starting") {
      throw new Error("Language-service transport is already active");
    }
    if (!isLanguageServiceKind(options.kind)) {
      throw new Error("Unsupported language-service kind");
    }
    if (!isNonEmptyString(options.projectId)) {
      throw new Error("Language-service project id is required");
    }

    const attempt = ++this.startAttempt;
    this.transportStatus = { state: "starting", session: null };
    if (this.failedStartSession) {
      const retained = this.failedStartSession;
      const cleanupFailure =
        await this.stopBackendSession(retained);
      if (cleanupFailure) {
        const failure = new Error(
          `A failed language-service startup could not be cleaned up: ${cleanupFailure.message}`,
        );
        if (attempt === this.startAttempt) {
          this.transportStatus = {
            state: "error",
            session: null,
            error: failure.message,
          };
        }
        throw failure;
      }
      this.failedStartSession = null;
    }

    const queuedEvents: unknown[] = [];
    let queuedEventsOverflowed = false;
    let responseReceived = false;
    const channel = this.createChannel<unknown>((event) => {
      if (!responseReceived) {
        if (queuedEvents.length >= MAX_PRESTART_EVENTS) {
          queuedEventsOverflowed = true;
          return;
        }
        queuedEvents.push(event);
        return;
      }
      this.dispatch(event, sink, attempt);
    });
    let startedSession: BackendCleanupSession | null = null;

    try {
      const rawResponse = await this.invokeCommand<unknown>(
        COMMANDS.start,
        {
          request: {
            projectId: options.projectId,
            kind: options.kind,
          },
          onEvent: channel,
        },
      );
      // A valid opaque identity is enough to stop a process if the rest of
      // the response fails exact DTO or requested-project validation.
      startedSession = sessionForCleanup(rawResponse);
      const response = parseStartResponse(rawResponse);
      if (
        response.kind !== options.kind ||
        response.projectId !== options.projectId
      ) {
        throw new Error(
          "Language-service start response returned a different project or kind",
        );
      }
      if (response.status !== "running") {
        throw new Error(
          `Language-service start did not reach running state (${response.status})`,
        );
      }
      const session: LanguageServiceRuntimeSession = {
        session: response.session,
        kind: response.kind,
        generation: response.generation,
        projectId: response.projectId,
        workspaceRoot: response.workspaceRoot,
      };
      startedSession = session;
      if (queuedEventsOverflowed) {
        throw new Error(
          `Language-service startup exceeded the ${MAX_PRESTART_EVENTS}-event queue limit`,
        );
      }
      this.activeSession = session;
      this.lastStoppedSession = null;
      this.lastEventSequence = 0;
      this.transportStatus = {
        state: transportState(response.status),
        session,
      };
      responseReceived = true;
      for (const event of queuedEvents) {
        this.dispatch(event, sink, attempt);
      }
      return { ...session };
    } catch (error) {
      responseReceived = true;
      const primaryFailure = backendError(error);
      let cleanupFailure: Error | null = null;
      if (startedSession) {
        this.failedStartSession = startedSession;
        cleanupFailure =
          await this.stopBackendSession(startedSession);
        if (!cleanupFailure) {
          this.failedStartSession = null;
        }
      }
      const failure = cleanupFailure
        ? new Error(
            `${primaryFailure.message}. Backend cleanup also failed: ${cleanupFailure.message}`,
          )
        : primaryFailure;
      if (attempt === this.startAttempt) {
        this.activeSession = null;
        this.transportStatus = {
          state: "error",
          session: null,
          error: failure.message,
        };
      }
      throw failure;
    }
  }

  private async stopBackendSession(
    session: BackendCleanupSession,
  ): Promise<Error | null> {
    try {
      parseCleanupStopResponse(
        await this.invokeCommand<unknown>(COMMANDS.stop, {
          request: {
            session: session.session,
            generation: session.generation,
          },
        }),
        session,
      );
      return null;
    } catch (error) {
      return backendError(error);
    }
  }

  async cleanup(): Promise<void> {
    const retained = this.failedStartSession;
    if (!retained) return;
    const cleanupFailure = await this.stopBackendSession(retained);
    if (cleanupFailure) {
      this.transportStatus = {
        state: "error",
        session: null,
        error:
          "A failed language-service startup could not be cleaned up",
      };
      throw cleanupFailure;
    }
    if (this.failedStartSession === retained) {
      this.failedStartSession = null;
    }
    this.transportStatus = { state: "stopped", session: null };
  }

  async send(
    session: LanguageServiceSession,
    message: JsonRpcMessage,
  ): Promise<void> {
    this.ensureCurrent(session);
    const validatedMessage = parseJsonRpcMessage(message);
    try {
      const response = parseSendResponse(
        await this.invokeCommand<unknown>(COMMANDS.send, {
          request: {
            session: session.session,
            generation: session.generation,
            message: validatedMessage,
          },
        }),
        session,
      );
      if (!response.accepted) {
        throw new Error(
          "Language-service backend rejected the message",
        );
      }
    } catch (error) {
      throw backendError(error);
    }
  }

  async refreshStatus(
    session: LanguageServiceSession,
  ): Promise<LanguageServiceTransportStatus> {
    this.ensureCurrent(session);
    const current = this.activeSession;
    if (!current) {
      throw new Error("Language-service session is unavailable");
    }
    try {
      const response = parseStatusResponse(
        await this.invokeCommand<unknown>(COMMANDS.status, {
          request: {
            session: session.session,
            generation: session.generation,
          },
        }),
        current,
      );
      if (!sameSession(this.activeSession, current)) {
        throw new Error(
          "Language-service status response was superseded by another session",
        );
      }
      this.transportStatus = {
        state: transportState(response.status),
        session: { ...current },
      };
      return this.status();
    } catch (error) {
      throw backendError(error);
    }
  }

  async stop(session: LanguageServiceSession): Promise<void> {
    if (sameSession(this.lastStoppedSession, session)) return;
    const inFlight = this.stopInFlight;
    if (inFlight && sameSession(inFlight.session, session)) {
      return inFlight.promise;
    }
    this.ensureCurrent(session);
    const promise = this.stopCurrent(session);
    this.stopInFlight = { session: { ...session }, promise };
    try {
      await promise;
    } finally {
      if (this.stopInFlight?.promise === promise) {
        this.stopInFlight = null;
      }
    }
  }

  private async stopCurrent(
    session: LanguageServiceSession,
  ): Promise<void> {
    const current = this.activeSession;
    if (!current) return;
    this.transportStatus = {
      state: "stopping",
      session: { ...current },
    };
    try {
      const response = parseStopResponse(
        await this.invokeCommand<unknown>(COMMANDS.stop, {
          request: {
            session: session.session,
            generation: session.generation,
          },
        }),
        session,
      );
      if (sameSession(this.activeSession, session)) {
        this.activeSession = null;
        this.lastStoppedSession = current;
        this.transportStatus = {
          state: transportState(response.status),
          session: null,
        };
      }
    } catch (error) {
      const failure = backendError(error);
      if (sameSession(this.activeSession, session)) {
        this.transportStatus = {
          state: "error",
          session: { ...current },
          error: failure.message,
        };
      }
      throw failure;
    }
  }

  private ensureCurrent(session: LanguageServiceSession): void {
    if (!sameSession(this.activeSession, session)) {
      throw new Error(
        "Language-service operation targeted a stale or unknown session",
      );
    }
  }

  private dispatch(
    raw: unknown,
    sink: LanguageServiceEventSink,
    attempt: number,
  ): void {
    if (attempt !== this.startAttempt) return;
    const current = this.activeSession;
    if (!current) return;
    let receivedSequence: number | null = null;
    try {
      const envelope = parseSession(raw);
      if (!sameSession(current, envelope)) return;
      if (
        !isRecord(raw) ||
        !isSafePositiveInteger(raw.sequence)
      ) {
        throw new Error("Malformed language-service event envelope");
      }
      receivedSequence = raw.sequence;
      if (raw.sequence <= this.lastEventSequence) return;
      const event = parseBackendEvent(raw);
      this.lastEventSequence = event.sequence;
      if (
        event.event === "started" &&
        (event.projectId !== current.projectId ||
          event.workspaceRoot !== current.workspaceRoot)
      ) {
        throw new Error(
          "Language-service started event changed the canonical project identity",
        );
      }
      if (event.event === "exited") {
        this.transportStatus = {
          state: transportState(event.status),
          session: { ...current },
          ...(event.reason ? { error: event.reason } : {}),
        };
      }
      const mapped = eventForBackendEvent(event);
      if (mapped) sink(mapped);
    } catch (error) {
      const failure = backendError(error);
      this.transportStatus = {
        state: "error",
        session: { ...current },
        error: failure.message,
      };
      const sequence =
        receivedSequence ?? this.lastEventSequence + 1;
      this.lastEventSequence = Math.max(
        this.lastEventSequence,
        sequence,
      );
      sink({
        ...current,
        sequence,
        type: "error",
        error: `Invalid language-service event: ${failure.message}`,
      });
    }
  }
}
