import { invoke } from "@tauri-apps/api/core";

// Best-effort - never throws, so it is safe to call from any catch block.
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
    await invoke("append_app_log", { message: `${scope}: ${detail}` });
  } catch {
    /* logging must never throw */
  }
}

