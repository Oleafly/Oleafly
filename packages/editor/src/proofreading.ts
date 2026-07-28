export const PROOFREADING_PROTOCOL_VERSION = 1 as const;

export const PROOFREADING_LIMITS = {
  grammarCharacters: 500_000,
  spellingCharacters: 500_000,
  // A full stress-size document can legitimately contain one finding for
  // every source character. This is a protocol safety ceiling, not a product
  // cutoff: the worker never truncates findings to reach it.
  diagnostics: 500_000,
  ignoredWords: 10_000,
  wordCharacters: 128,
} as const;

export type ProofreadingFormat =
  | "latex"
  | "markdown"
  | "plaintext"
  | "typst";
export type ProofreadingMode = "grammar" | "spelling" | "combined";
export type ProofreadingSurface = "source" | "visual";
export type ProofreadingDialect =
  | "american"
  | "british"
  | "australian"
  | "canadian"
  | "indian";
export type ProofreadingResultStatus =
  | "ready"
  | "partial"
  | "too_large"
  | "unsupported";

export interface ProofreadingIdentity {
  projectId: string | null;
  path: string;
  revision: number;
  requestGeneration: number;
  surface: ProofreadingSurface;
}

export interface ProofreadingSuggestion {
  text: string;
  /** Harper-compatible kind: 0 replace, 1 remove, 2 insert after. */
  kind: 0 | 1 | 2;
}

export interface ProofreadingDiagnostic {
  from: number;
  to: number;
  message: string;
  kind: string;
  source: "harper" | "hunspell";
  word: string;
  suggestions: ProofreadingSuggestion[];
}

export interface ProofreadingRequest {
  protocolVersion: typeof PROOFREADING_PROTOCOL_VERSION;
  type: "proofread";
  requestId: number;
  identity: ProofreadingIdentity;
  format: ProofreadingFormat;
  mode: ProofreadingMode;
  text: string;
  ignoredWords: string[];
  preferences: {
    showRegionalism: boolean;
    showWordChoice: boolean;
    dialect: ProofreadingDialect;
    /** Optional Hunspell pack (for example en_GB or de_DE). */
    dictionaryLocale?: string;
  };
}

export interface ProofreadingResult {
  protocolVersion: typeof PROOFREADING_PROTOCOL_VERSION;
  type: "result";
  requestId: number;
  identity: ProofreadingIdentity;
  status: ProofreadingResultStatus;
  diagnostics: ProofreadingDiagnostic[];
  message?: string;
  /** Exact Hunspell pack that produced a spelling result. */
  activeDictionaryLocale?: string;
  /** Retained for protocol compatibility; production results are never cut. */
  truncated?: boolean;
}

export interface ProofreadingError {
  protocolVersion: typeof PROOFREADING_PROTOCOL_VERSION;
  type: "error";
  requestId: number;
  identity: ProofreadingIdentity;
  error: {
    code:
      | "invalid_request"
      | "initialization_failed"
      | "analysis_failed";
    message: string;
    retryable: boolean;
  };
}

export type ProofreadingWorkerRequest =
  | ProofreadingRequest
  | {
      protocolVersion: typeof PROOFREADING_PROTOCOL_VERSION;
      type: "dispose";
    };

export type ProofreadingWorkerResponse =
  | ProofreadingResult
  | ProofreadingError;

export type ProofreadingInput = Omit<
  ProofreadingRequest,
  "protocolVersion" | "type" | "requestId"
>;

export function sameProofreadingIdentity(
  left: ProofreadingIdentity,
  right: ProofreadingIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.path === right.path &&
    left.revision === right.revision &&
    left.requestGeneration === right.requestGeneration &&
    left.surface === right.surface
  );
}

export function isProofreadingWorkerResponse(
  value: unknown,
): value is ProofreadingWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const requestId = candidate.requestId;
  if (
    candidate.protocolVersion !== PROOFREADING_PROTOCOL_VERSION ||
    (candidate.type !== "result" && candidate.type !== "error") ||
    typeof requestId !== "number" ||
    !Number.isSafeInteger(requestId) ||
    requestId <= 0
  ) {
    return false;
  }
  const identity =
    candidate.identity && typeof candidate.identity === "object"
      ? (candidate.identity as Record<string, unknown>)
      : null;
  const validIdentity =
    !!identity &&
    (typeof identity.projectId === "string" ||
      identity.projectId === null) &&
    (typeof identity.projectId !== "string" ||
      identity.projectId.length <= 256) &&
    typeof identity.path === "string" &&
    identity.path.length <= 2_048 &&
    typeof identity.revision === "number" &&
    Number.isSafeInteger(identity.revision) &&
    identity.revision >= 0 &&
    typeof identity.requestGeneration === "number" &&
    Number.isSafeInteger(identity.requestGeneration) &&
    identity.requestGeneration > 0 &&
    (identity.surface === "source" || identity.surface === "visual");
  if (!validIdentity) return false;
  if (candidate.type === "error") {
    const error =
      candidate.error && typeof candidate.error === "object"
        ? (candidate.error as Record<string, unknown>)
        : null;
    return (
      !!error &&
      ["invalid_request", "initialization_failed", "analysis_failed"].includes(
        typeof error.code === "string" ? error.code : "",
      ) &&
      typeof error.message === "string" &&
      error.message.length <= 1_024 &&
      typeof error.retryable === "boolean"
    );
  }
  const status = candidate.status;
  const diagnostics = candidate.diagnostics;
  const message = candidate.message;
  const activeDictionaryLocale = candidate.activeDictionaryLocale;
  const truncated = candidate.truncated;
  if (
    !["ready", "partial", "too_large", "unsupported"].includes(
      typeof status === "string" ? status : "",
    ) ||
    !Array.isArray(diagnostics) ||
    diagnostics.length > PROOFREADING_LIMITS.diagnostics ||
    (status !== "ready" &&
      status !== "partial" &&
      diagnostics.length !== 0) ||
    (message !== undefined &&
      (typeof message !== "string" || message.length > 2_048)) ||
    (activeDictionaryLocale !== undefined &&
      (typeof activeDictionaryLocale !== "string" ||
        !/^[A-Za-z]{2,3}_[A-Za-z]{2,4}$/u.test(activeDictionaryLocale))) ||
    (truncated !== undefined && typeof truncated !== "boolean")
  ) {
    return false;
  }
  return diagnostics.every((value) => {
    if (!value || typeof value !== "object") return false;
    const diagnostic = value as Record<string, unknown>;
    const from = diagnostic.from;
    const to = diagnostic.to;
    const diagnosticMessage = diagnostic.message;
    const kind = diagnostic.kind;
    const word = diagnostic.word;
    const suggestions = diagnostic.suggestions;
    if (
      typeof from !== "number" ||
      !Number.isSafeInteger(from) ||
      typeof to !== "number" ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to <= from ||
      typeof diagnosticMessage !== "string" ||
      diagnosticMessage.length > 4_096 ||
      typeof kind !== "string" ||
      kind.length > 256 ||
      (diagnostic.source !== "harper" &&
        diagnostic.source !== "hunspell") ||
      typeof word !== "string" ||
      word.length > PROOFREADING_LIMITS.grammarCharacters ||
      !Array.isArray(suggestions) ||
      suggestions.length > 8
    ) {
      return false;
    }
    return suggestions.every((value) => {
      if (!value || typeof value !== "object") return false;
      const suggestion = value as Record<string, unknown>;
      return (
        typeof suggestion.text === "string" &&
        suggestion.text.length <= 4_096 &&
        (suggestion.kind === 0 ||
          suggestion.kind === 1 ||
          suggestion.kind === 2)
      );
    });
  });
}
