import { i18n } from "@/i18n";
import { displayText } from "@/lib/display-path";

export const APP_ERROR_PREFIX = "@oleafly/error:";
export const PROJECT_NOT_FOUND = "project.not_found";
export const PROJECT_LINKED_NOT_RECYCLABLE = "project.linked_not_recyclable";
export const SHELL_ESCAPE_DECLINED = "project.shell_escape_declined";

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

const areaParams = new Map<string, () => Record<string, string>>();

/** Supplies params for every code of an area (`cloud.*` names the provider in
 * its messages). The backend's own params win over these. Returns a function
 * that stops supplying them. */
export function provideErrorParams(area: string, params: () => Record<string, string>): () => void {
  areaParams.set(area, params);
  return () => {
    if (areaParams.get(area) === params) areaParams.delete(area);
  };
}

function paramsOf(app: AppError): Record<string, string> {
  const dot = app.code.indexOf(".");
  const supplied = dot > 0 ? areaParams.get(app.code.slice(0, dot)) : undefined;
  return supplied ? { ...supplied(), ...app.params } : app.params;
}

/** A backend or runtime error as a sentence to show, with home paths as `~`. */
export function describeError(value: unknown): string {
  return displayText(errorSentence(value));
}

function errorKey(code: string): string | null {
  const dot = code.indexOf(".");
  const keys = [`errors:${code}`];
  if (dot > 0) keys.push(`${code.slice(0, dot)}:errors.${code.slice(dot + 1)}`);
  return keys.find((key) => dynamic.exists(key)) ?? null;
}

function errorSentence(value: unknown): string {
  const app = decodeAppError(value);
  if (app) {
    const key = errorKey(app.code);
    const message = key ? dynamic.t(key, paramsOf(app)) : i18n.t(($) => $.errors.unknown);
    return app.detail ? i18n.t(($) => $.errors.withDetail, { message, detail: app.detail }) : message;
  }
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value) return value;
  return i18n.t(($) => $.errors.unknown);
}
