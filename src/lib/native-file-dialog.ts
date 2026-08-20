
import { E2E_HOOKS } from "@/lib/e2e-flags";import {
  open as openNativeDialog,
  save as saveNativeDialog,
  type OpenDialogOptions,
  type OpenDialogReturn,
  type SaveDialogOptions,
} from "@tauri-apps/plugin-dialog";

interface E2eFileDialogState {
  nextImportPaths?: string[] | null;
  nextSavePath?: string | null;
  openRequests: number;
  saveRequests: number;
}

declare global {
  interface Window {
    __e2eFileDialogState?: E2eFileDialogState;
    __e2eSetNextImportPaths?: (paths: string[] | null) => void;
    __e2eSetNextSavePath?: (path: string | null) => void;
  }
}

function e2eState(): E2eFileDialogState | null {
  if (typeof window === "undefined" || !E2E_HOOKS) return null;
  if (!window.__e2eFileDialogState) {
    window.__e2eFileDialogState = {
      openRequests: 0,
      saveRequests: 0,
    };
  }
  return window.__e2eFileDialogState;
}

if (typeof window !== "undefined" && E2E_HOOKS) {
  window.__e2eSetNextImportPaths = (paths) => {
    const state = e2eState();
    if (state) state.nextImportPaths = paths?.slice() ?? null;
  };
  window.__e2eSetNextSavePath = (path) => {
    const state = e2eState();
    if (state) state.nextSavePath = path;
  };
}

/**
 * The single application boundary for native open dialogs.
 *
 * E2E replaces only the operating-system picker result. The production click,
 * import action, backend command, refresh, and conflict handling still run.
 */
export async function pickOpenPath<T extends OpenDialogOptions>(
  options?: T,
): Promise<OpenDialogReturn<T>> {
  const state = e2eState();
  if (state) {
    state.openRequests += 1;
    if (Object.hasOwn(state, "nextImportPaths")) {
      const paths = state.nextImportPaths ?? null;
      delete state.nextImportPaths;
      const result =
        paths === null
          ? null
          : options?.directory
            ? (paths[0] ?? null)
            : options?.multiple
              ? paths
              : (paths[0] ?? null);
      return result as OpenDialogReturn<T>;
    }
  }
  return openNativeDialog(options);
}

/**
 * The single application boundary for native save dialogs.
 *
 * A DEV-only one-shot path lets native E2E inspect the artifact written by the
 * real export/download handler without attempting to automate an OS dialog.
 */
export async function pickSavePath(options?: SaveDialogOptions): Promise<string | null> {
  const state = e2eState();
  if (state) {
    state.saveRequests += 1;
    if (Object.hasOwn(state, "nextSavePath")) {
      const path = state.nextSavePath;
      delete state.nextSavePath;
      return path ?? null;
    }
  }
  return saveNativeDialog(options);
}
