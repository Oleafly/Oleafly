
import { E2E_HOOKS } from "@/lib/e2e-flags";
import {
  grantTestOpenPaths,
  grantTestSavePath,
  pickOpenPaths,
  pickSaveDestination,
  pickTableImportFile,
  registerPickedFileForE2E,
} from "@/lib/tauri";
import type {
  OpenDialogOptions,
  OpenDialogReturn,
  SaveDialogOptions,
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
  window.__e2eFileDialogState ??= {
    openRequests: 0,
    saveRequests: 0,
  };
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

/** The E2E stand-in's answer in the dialog's shape: a folder or single pick
 * returns the first path, a multiple pick returns them all. */
function e2eOpenResult(
  paths: string[] | null,
  options?: OpenDialogOptions,
): string | string[] | null {
  if (paths === null) return null;
  if (options?.multiple && !options.directory) return paths;
  return paths[0] ?? null;
}

/** Takes the one-shot E2E pick and records it the way a real pick is. */
async function takeE2eOpenPick(
  state: E2eFileDialogState,
  options?: OpenDialogOptions,
): Promise<string | string[] | null> {
  const result = e2eOpenResult(state.nextImportPaths ?? null, options);
  delete state.nextImportPaths;
  if (result !== null) await grantTestOpenPaths(typeof result === "string" ? [result] : result);
  return result;
}

/**
 * The single application boundary for native open dialogs.
 *
 * The dialog runs in Rust, which records the picked paths: the commands that
 * read outside a project accept only those. E2E replaces only the
 * operating-system picker result and records it the same way. The production
 * click, import action, backend command, refresh, and conflict handling still
 * run.
 */
export async function pickOpenPath<T extends OpenDialogOptions>(
  options?: T,
): Promise<OpenDialogReturn<T>> {
  const state = e2eState();
  if (state) {
    state.openRequests += 1;
    if (Object.hasOwn(state, "nextImportPaths")) {
      return (await takeE2eOpenPick(state, options)) as OpenDialogReturn<T>;
    }
  }
  const paths = await pickOpenPaths(options);
  if (paths === null) return null as OpenDialogReturn<T>;
  return (options?.multiple ? paths : (paths[0] ?? null)) as OpenDialogReturn<T>;
}

export async function pickTableImportPath(): Promise<string | null> {
  const state = e2eState();
  if (state) {
    state.openRequests += 1;
    if (Object.hasOwn(state, "nextImportPaths")) {
      const paths = state.nextImportPaths ?? null;
      delete state.nextImportPaths;
      const path = paths?.[0] ?? null;
      return path === null ? null : registerPickedFileForE2E(path);
    }
  }
  return pickTableImportFile();
}

/**
 * The single application boundary for native save dialogs.
 *
 * The dialog runs in Rust, which records the chosen path: the commands that
 * write outside a project accept only that. A DEV-only one-shot path lets
 * native E2E inspect the artifact written by the real export/download handler
 * without attempting to automate an OS dialog; it is recorded the same way.
 */
export async function pickSavePath(options?: SaveDialogOptions): Promise<string | null> {
  const state = e2eState();
  if (state) {
    state.saveRequests += 1;
    if (Object.hasOwn(state, "nextSavePath")) {
      const path = state.nextSavePath ?? null;
      delete state.nextSavePath;
      return path === null ? null : grantTestSavePath(path);
    }
  }
  return pickSaveDestination(options);
}
