import { ApiError } from "../api";
import { OfflineError } from "../controller";
import en from "../i18n/en.json";

export type ErrorKey = keyof typeof en.errors;

export function errorKey(code: string): ErrorKey {
  return Object.hasOwn(en.errors, code) ? (code as ErrorKey) : "generic";
}

export function failureKey(error: unknown): ErrorKey {
  if (error instanceof OfflineError) return "offline";
  if (error instanceof ApiError) return errorKey(error.code);
  return "generic";
}
