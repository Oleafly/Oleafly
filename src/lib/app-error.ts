import { i18n } from "@/i18n";

export const APP_ERROR_PREFIX = "@oleafly/error:";

const dynamic = i18n as unknown as {
  t(key: string, params?: Record<string, unknown>): string;
  exists(key: string): boolean;
};

export class AppError extends Error {
  readonly code: string;
  readonly params: Record<string, string>;
  readonly detail: string | null;

  constructor(code: string, params: Record<string, string>, detail: string | null) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.params = params;
    this.detail = detail;
  }
}

export function decodeAppError(value: unknown): AppError | null {
  if (value instanceof AppError) return value;
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : null;
  if (!text?.startsWith(APP_ERROR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(APP_ERROR_PREFIX.length)) as {
      code?: unknown;
      params?: unknown;
      detail?: unknown;
    };
    if (typeof parsed.code !== "string") return null;
    const params: Record<string, string> = {};
    if (parsed.params && typeof parsed.params === "object") {
      for (const [key, param] of Object.entries(parsed.params as Record<string, unknown>)) {
        params[key] = String(param);
      }
    }
    return new AppError(parsed.code, params, typeof parsed.detail === "string" ? parsed.detail : null);
  } catch {
    return null;
  }
}

export function describeError(value: unknown): string {
  const app = decodeAppError(value);
  if (app) {
    const key = `errors:${app.code}`;
    const message = dynamic.exists(key) ? dynamic.t(key, app.params) : i18n.t(($) => $.errors.unknown);
    return app.detail ? i18n.t(($) => $.errors.withDetail, { message, detail: app.detail }) : message;
  }
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value) return value;
  return i18n.t(($) => $.errors.unknown);
}
