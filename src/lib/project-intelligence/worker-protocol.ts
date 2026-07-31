import {
  PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
  type ProjectIntelligenceIdentity,
  type ProjectIntelligenceSnapshot,
} from "./types";

export const PROJECT_INTELLIGENCE_LIMITS = {
  maxKnownFiles: 20_000,
  maxSourceFiles: 2_000,
  maxFileCharacters: 2_000_000,
  maxProjectCharacters: 10_000_000,
  maxResultItems: 200_000,
  maxPathCharacters: 1_024,
} as const;

export interface ProjectFileUpsert {
  readonly file: string;
  readonly sourceRevision: number;
  readonly text: string;
}

export interface ProjectUnreadableFile {
  readonly file: string;
  readonly sourceRevision: number;
  readonly message?: string;
}

export interface AnalyzeProjectIntelligenceRequest {
  readonly protocolVersion: typeof PROJECT_INTELLIGENCE_PROTOCOL_VERSION;
  readonly type: "analyze";
  readonly requestId: number;
  readonly identity: ProjectIntelligenceIdentity;
  readonly reset: boolean;
  readonly mainDocument?: string;
  readonly knownFiles: readonly string[];
  readonly upserts: readonly ProjectFileUpsert[];
  readonly removals: readonly string[];
  readonly unreadable: readonly ProjectUnreadableFile[];
}

export interface DisposeProjectIntelligenceRequest {
  readonly protocolVersion: typeof PROJECT_INTELLIGENCE_PROTOCOL_VERSION;
  readonly type: "dispose";
}

export type ProjectIntelligenceWorkerRequest =
  | AnalyzeProjectIntelligenceRequest
  | DisposeProjectIntelligenceRequest;

export interface ProjectIntelligenceResultResponse {
  readonly protocolVersion: typeof PROJECT_INTELLIGENCE_PROTOCOL_VERSION;
  readonly type: "result";
  readonly requestId: number;
  readonly identity: ProjectIntelligenceIdentity;
  readonly snapshot: ProjectIntelligenceSnapshot;
}

export interface ProjectIntelligenceErrorResponse {
  readonly protocolVersion: typeof PROJECT_INTELLIGENCE_PROTOCOL_VERSION;
  readonly type: "error";
  readonly requestId: number;
  readonly identity: ProjectIntelligenceIdentity;
  readonly error: {
    readonly code:
      | "invalid_request"
      | "input_limit"
      | "result_limit"
      | "analysis_failed";
    readonly message: string;
    readonly retryable: boolean;
  };
}

export type ProjectIntelligenceWorkerResponse =
  | ProjectIntelligenceResultResponse
  | ProjectIntelligenceErrorResponse;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
};

export function isProjectIntelligenceIdentity(
  value: unknown,
): value is ProjectIntelligenceIdentity {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "projectId",
      "projectRevision",
      "requestGeneration",
    ]) &&
    typeof value.projectId === "string" &&
    value.projectId.length > 0 &&
    Number.isSafeInteger(value.projectRevision) &&
    (value.projectRevision as number) >= 0 &&
    Number.isSafeInteger(value.requestGeneration) &&
    (value.requestGeneration as number) > 0
  );
}

function validPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= PROJECT_INTELLIGENCE_LIMITS.maxPathCharacters &&
    !value.includes("\0")
  );
}

function isUpsert(value: unknown): value is ProjectFileUpsert {
  return (
    isRecord(value) &&
    exactKeys(value, ["file", "sourceRevision", "text"]) &&
    validPath(value.file) &&
    Number.isSafeInteger(value.sourceRevision) &&
    (value.sourceRevision as number) >= 0 &&
    typeof value.text === "string"
  );
}

function isUnreadable(value: unknown): value is ProjectUnreadableFile {
  return (
    isRecord(value) &&
    exactKeys(value, ["file", "sourceRevision"], ["message"]) &&
    validPath(value.file) &&
    Number.isSafeInteger(value.sourceRevision) &&
    (value.sourceRevision as number) >= 0 &&
    (value.message === undefined || typeof value.message === "string")
  );
}

export function isProjectIntelligenceWorkerRequest(
  value: unknown,
): value is ProjectIntelligenceWorkerRequest {
  if (!isRecord(value)) return false;
  if (
    value.protocolVersion !== PROJECT_INTELLIGENCE_PROTOCOL_VERSION ||
    (value.type !== "analyze" && value.type !== "dispose")
  ) {
    return false;
  }
  if (value.type === "dispose") {
    return exactKeys(value, ["protocolVersion", "type"]);
  }
  return (
    exactKeys(
      value,
      [
        "protocolVersion",
        "type",
        "requestId",
        "identity",
        "reset",
        "knownFiles",
        "upserts",
        "removals",
        "unreadable",
      ],
      ["mainDocument"],
    ) &&
    Number.isSafeInteger(value.requestId) &&
    (value.requestId as number) > 0 &&
    isProjectIntelligenceIdentity(value.identity) &&
    typeof value.reset === "boolean" &&
    (value.mainDocument === undefined || validPath(value.mainDocument)) &&
    Array.isArray(value.knownFiles) &&
    value.knownFiles.every(validPath) &&
    Array.isArray(value.upserts) &&
    value.upserts.every(isUpsert) &&
    Array.isArray(value.removals) &&
    value.removals.every(validPath) &&
    Array.isArray(value.unreadable) &&
    value.unreadable.every(isUnreadable)
  );
}

function isWorkerError(value: unknown): value is ProjectIntelligenceErrorResponse["error"] {
  return (
    isRecord(value) &&
    exactKeys(value, ["code", "message", "retryable"]) &&
    [
      "invalid_request",
      "input_limit",
      "result_limit",
      "analysis_failed",
    ].includes(String(value.code)) &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function isSnapshotShell(
  value: unknown,
): value is ProjectIntelligenceSnapshot {
  return (
    isRecord(value) &&
    exactKeys(
      value,
      [
        "protocolVersion",
        "identity",
        "status",
        "files",
        "definitions",
        "uses",
        "diagnostics",
        "outlines",
        "hierarchy",
        "bibliography",
        "stats",
        "detectedPackages",
        "documentClasses",
      ],
      ["reason"],
    ) &&
    value.protocolVersion === PROJECT_INTELLIGENCE_PROTOCOL_VERSION &&
    isProjectIntelligenceIdentity(value.identity) &&
    (value.status === "success" || value.status === "partial") &&
    isRecord(value.files) &&
    Array.isArray(value.definitions) &&
    Array.isArray(value.uses) &&
    Array.isArray(value.diagnostics) &&
    isRecord(value.outlines) &&
    isRecord(value.hierarchy) &&
    isRecord(value.bibliography) &&
    isRecord(value.stats) &&
    Array.isArray(value.detectedPackages) &&
    Array.isArray(value.documentClasses)
  );
}

export function isProjectIntelligenceWorkerResponse(
  value: unknown,
): value is ProjectIntelligenceWorkerResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PROJECT_INTELLIGENCE_PROTOCOL_VERSION ||
    !Number.isSafeInteger(value.requestId) ||
    (value.requestId as number) <= 0 ||
    !isProjectIntelligenceIdentity(value.identity)
  ) {
    return false;
  }
  if (value.type === "result") {
    return (
      exactKeys(value, [
        "protocolVersion",
        "type",
        "requestId",
        "identity",
        "snapshot",
      ]) && isSnapshotShell(value.snapshot)
    );
  }
  return (
    value.type === "error" &&
    exactKeys(value, [
      "protocolVersion",
      "type",
      "requestId",
      "identity",
      "error",
    ]) &&
    isWorkerError(value.error)
  );
}

export function sameProjectIntelligenceIdentity(
  left: ProjectIntelligenceIdentity,
  right: ProjectIntelligenceIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.requestGeneration === right.requestGeneration
  );
}
