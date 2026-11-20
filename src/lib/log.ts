import { invoke } from "@tauri-apps/api/core";

const REPEAT_WINDOW_MS = 10_000;

export const IMPORT_FAILURE_GRACE_MS = 1_500;

const RESIZE_OBSERVER_NOTICE = /^ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/u;

const IMPORT_FAILED =
  /^(?:Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module)/u;

const repeats = new Map<string, { count: number }>();

let leaving = false;

function describe(e: unknown): string {
  if (e instanceof Error) {
    const detail = `${e.name}: ${e.message}`;
    if (!e.stack) return detail;
    return e.stack.startsWith(detail) ? e.stack : `${detail}\n${e.stack}`;
  }
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function headline(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end);
}

async function deliver(command: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, args);
  } catch {
    return;
  }
}

function send(command: string, message: string, level?: "info" | "warning"): Promise<void> {
  const args = level ? { level, message } : { message };
  const key = `${command}\u0000${level ?? "error"}\u0000${headline(message)}`;
  const seen = repeats.get(key);
  if (seen) {
    seen.count += 1;
    return Promise.resolve();
  }
  const burst = { count: 0 };
  repeats.set(key, burst);
  setTimeout(() => {
    repeats.delete(key);
    if (burst.count === 0) return;
    const times = burst.count === 1 ? "time" : "times";
    void deliver(command, {
      ...args,
      message: `${headline(message)} (repeated ${burst.count} more ${times} within ${REPEAT_WINDOW_MS / 1000} s)`,
    });
  }, REPEAT_WINDOW_MS);
  return deliver(command, args);
}

export function logError(scope: string, e: unknown): Promise<void> {
  const message = `${scope}: ${describe(e)}`;
  if (!(e instanceof Error && IMPORT_FAILED.test(e.message))) return send("log_frontend_error", message);
  return new Promise((resolve) => {
    setTimeout(() => {
      void (leaving ? send("log_frontend_entry", message, "info") : send("log_frontend_error", message)).then(resolve);
    }, IMPORT_FAILURE_GRACE_MS);
  });
}

export function logWarning(scope: string, e: unknown): Promise<void> {
  return send("log_frontend_entry", `${scope}: ${describe(e)}`, "warning");
}

export function logInfo(scope: string, e: unknown): Promise<void> {
  return send("log_frontend_entry", `${scope}: ${describe(e)}`, "info");
}

export function installErrorLogging(target: Window = window): void {
  target.addEventListener("pagehide", () => {
    leaving = true;
  });
  target.addEventListener("pageshow", () => {
    leaving = false;
  });
  target.addEventListener("unhandledrejection", (event) => {
    void logError("Unhandled promise rejection", event.reason);
  });
  target.addEventListener("error", (event) => {
    if (RESIZE_OBSERVER_NOTICE.test(event.message ?? "")) {
      void logInfo("layout", event.message);
      return;
    }
    void logError("Uncaught error", event.error ?? event.message);
  });
}
