import { decodeAppError, describeError } from "@/lib/app-error";

export interface SaveFailure {
  path: string;
  reason: string;
}

export function describeSaveFailure(failure: SaveFailure): string {
  return decodeAppError(failure.reason) ? describeError(failure.reason) : failure.reason;
}

export class SaveFlushError extends Error {
  readonly failures: SaveFailure[];

  constructor(failures: SaveFailure[]) {
    super(failures.map((failure) => `${failure.path}: ${describeSaveFailure(failure)}`).join("\n"));
    this.name = "SaveFlushError";
    this.failures = failures;
  }
}

export function codedSaveFailure(error: unknown): string | null {
  if (!(error instanceof SaveFlushError)) return null;
  return error.failures.find((failure) => decodeAppError(failure.reason))?.reason ?? null;
}
