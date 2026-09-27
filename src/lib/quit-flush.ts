import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirmQuitDuringInstall, confirmQuitFlush } from "@/lib/tauri";
import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";
import { i18n } from "@/i18n";

export const QUIT_FLUSH_REQUESTED = "quit-flush-requested";
export const INSTALL_QUIT_BLOCKED = "tinytex-quit-blocked";
const QUIT_FLUSH_TIMEOUT_MS = 5_000;

type QuitResponder = "flush" | "install";

const claims: Record<QuitResponder, number> = { flush: 0, install: 0 };
let answering = false;

export function flushForQuitWithDeadline(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(i18n.t(($) => $.shell.quitGuard.flushTimeout)));
    }, QUIT_FLUSH_TIMEOUT_MS);
  });
  return Promise.race([useFilesStore.getState().flushForQuit(), deadline]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

function claim(responder: QuitResponder): () => void {
  claims[responder] += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims[responder] -= 1;
  };
}

export function claimQuitRequests(): () => void {
  return claim("flush");
}

export function claimInstallQuitRequests(): () => void {
  return claim("install");
}

export function answerQuitRequest(answer: () => Promise<void>): void {
  if (answering) return;
  answering = true;
  void answer()
    .catch((error: unknown) => logError("answer the quit request", error))
    .finally(() => {
      answering = false;
    });
}

async function flushThenConfirm(restart: boolean): Promise<void> {
  try {
    await flushForQuitWithDeadline();
  } catch (error) {
    await logError("save before quitting without the workspace", error);
  }
  await confirmQuitFlush(restart);
}

export async function installQuitFallback(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const stops = await Promise.all([
    listen<boolean>(QUIT_FLUSH_REQUESTED, (event) => {
      if (claims.flush > 0) return;
      answerQuitRequest(() => flushThenConfirm(event.payload === true));
    }),
    listen(INSTALL_QUIT_BLOCKED, () => {
      if (claims.install > 0) return;
      void confirmQuitDuringInstall().catch((error: unknown) =>
        logError("quit during install without the workspace", error),
      );
    }),
  ]);
  return () => {
    for (const stop of stops) stop();
  };
}
