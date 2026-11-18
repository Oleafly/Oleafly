import { invoke } from "@tauri-apps/api/core";

export async function logError(scope: string, e: unknown): Promise<void> {
  let detail: string;
  if (e instanceof Error) {
    detail = `${e.name}: ${e.message}`;
    if (e.stack) detail += `\n${e.stack}`;
  } else if (typeof e === "string") {
    detail = e;
  } else {
    try {
      detail = JSON.stringify(e);
    } catch {
      detail = String(e);
    }
  }
  try {
    await invoke("log_frontend_error", { message: `${scope}: ${detail}` });
  } catch {
    /* logging must never throw */
  }
}

