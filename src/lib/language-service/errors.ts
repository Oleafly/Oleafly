import type {
  LanguageServiceFeature,
  LanguageServiceRequestIdentity,
} from "./client";

export class LanguageServiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguageServiceStateError";
  }
}

export class UnsupportedLanguageServiceCapabilityError extends Error {
  readonly feature: LanguageServiceFeature;

  constructor(feature: LanguageServiceFeature) {
    super(`Language server did not advertise ${feature}`);
    this.name = "UnsupportedLanguageServiceCapabilityError";
    this.feature = feature;
  }
}

export class LanguageServiceTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`Language service request ${method} timed out after ${timeoutMs} ms`);
    this.name = "LanguageServiceTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class LanguageServiceAbortError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(`Language service request ${method} was aborted`);
    this.name = "LanguageServiceAbortError";
    this.method = method;
  }
}

export class LanguageServiceExitedError extends Error {
  constructor(message = "Language service exited") {
    super(message);
    this.name = "LanguageServiceExitedError";
  }
}

export class StaleLanguageServiceResultError extends Error {
  readonly identity: LanguageServiceRequestIdentity;

  constructor(identity: LanguageServiceRequestIdentity, reason: string) {
    super(`Discarded stale language service result: ${reason}`);
    this.name = "StaleLanguageServiceResultError";
    this.identity = identity;
  }
}

export function isLanguageServiceStaleError(
  error: unknown,
): error is StaleLanguageServiceResultError {
  return error instanceof StaleLanguageServiceResultError;
}

export function isLanguageServiceCancellation(
  error: unknown,
): error is LanguageServiceAbortError | LanguageServiceTimeoutError {
  return (
    error instanceof LanguageServiceAbortError ||
    error instanceof LanguageServiceTimeoutError
  );
}
