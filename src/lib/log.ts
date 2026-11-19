import { invoke } from "@tauri-apps/api/core";

function describe(e: unknown): string {
  if (e instanceof Error) {
    const detail = `${e.name}: ${e.message}`;
    return e.stack ? `${detail}\n${e.stack}` : detail;
  }
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function send(command: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, args);
  } catch {
    return;
  }
}

export function logError(scope: string, e: unknown): Promise<void> {
  return send("log_frontend_error", { message: `${scope}: ${describe(e)}` });
}

function logAt(level: "info" | "warning", scope: string, e: unknown): Promise<void> {
  return send("log_frontend_entry", { level, message: `${scope}: ${describe(e)}` });
}

export function logWarning(scope: string, e: unknown): Promise<void> {
  return logAt("warning", scope, e);
}

export function logInfo(scope: string, e: unknown): Promise<void> {
  return logAt("info", scope, e);
}
