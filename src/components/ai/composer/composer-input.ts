import { carriesFiles } from "@/lib/external-drop-guard";
import { carriesTreePath } from "@/lib/tree-drag";
import { isLinux } from "@/lib/utils";
import type { SlashItem } from "./types";

export const COMPOSER_MIN_REM = 3.5;
export const COMPOSER_DEFAULT_HEIGHT = 56;
export const COMPOSER_MAX_PANEL_SHARE = 0.6;
export const COMPOSER_GROW_MAX = 224;
export const COMPOSER_KEY_STEP = 20;

export function clampComposerHeight(height: number, panelHeight: number, rootFontPx = 16): number {
  const min = Math.round(COMPOSER_MIN_REM * rootFontPx);
  const max = Math.max(min, Math.round(panelHeight * COMPOSER_MAX_PANEL_SHARE));
  const value = Number.isFinite(height) ? height : COMPOSER_DEFAULT_HEIGHT;
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function composerGrowMax(resting: number): number {
  return Math.max(resting, COMPOSER_GROW_MAX);
}

export type ComposerKeyAction = "submit" | "queue" | "block" | "historyPrev" | "historyNext" | "default";

interface ComposerKeyState {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  busy: boolean;
  canQueue: boolean;
  canSubmit: boolean;
  empty: boolean;
  recalling: boolean;
  caretOnFirstLine?: boolean;
  caretOnLastLine?: boolean;
}

function enterAction(state: Pick<ComposerKeyState, "shiftKey" | "busy" | "canQueue" | "canSubmit">): ComposerKeyAction {
  if (state.shiftKey) return "default";
  if (state.busy) return state.canQueue ? "queue" : "block";
  return state.canSubmit ? "submit" : "block";
}

export function composerKeyAction(state: ComposerKeyState): ComposerKeyAction {
  if (state.key === "Enter") return enterAction(state);
  const modified = Boolean(state.shiftKey || state.altKey || state.ctrlKey || state.metaKey);
  if (state.key === "ArrowUp" && !modified && (state.empty || state.recalling)) {
    return state.caretOnFirstLine === false ? "default" : "historyPrev";
  }
  if (state.key === "ArrowDown" && !modified && state.recalling) {
    return state.caretOnLastLine === false ? "default" : "historyNext";
  }
  return "default";
}

export function caretLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { onFirstLine: boolean; onLastLine: boolean } {
  return {
    onFirstLine: !value.slice(0, selectionStart).includes("\n"),
    onLastLine: !value.slice(selectionEnd).includes("\n"),
  };
}

export function historyStep(
  history: readonly string[],
  index: number | null,
  direction: "prev" | "next",
): { index: number | null; value: string } | null {
  if (history.length === 0) return null;
  if (direction === "prev") {
    if (index === null) {
      const last = history.length - 1;
      return { index: last, value: history[last] };
    }
    if (index <= 0) return null;
    return { index: index - 1, value: history[index - 1] };
  }
  if (index === null) return null;
  if (index >= history.length - 1) return { index: null, value: "" };
  return { index: index + 1, value: history[index + 1] };
}

function isSlashCommandInput(value: string): boolean {
  return value.startsWith("/") && !value.includes("\n");
}

function slashCommandQuery(value: string): string {
  return isSlashCommandInput(value) ? value.slice(1).trim() : "";
}

export function slashMenuQuery(
  value: string,
  items: readonly Pick<SlashItem, "command">[],
  dismissedFor: string | null,
): string | null {
  if (!isSlashCommandInput(value) || value === dismissedFor) return null;
  const typed = value.slice(1);
  const known = items.some(
    (item) =>
      item.command !== undefined &&
      typed.startsWith(item.command) &&
      /^\s/.test(typed.slice(item.command.length)),
  );
  if (known) return null;
  return slashCommandQuery(value);
}

export type ComposerDropKind = "files" | "native" | "tree";

export function composerDropKind(
  transfer: DataTransfer | null | undefined,
  linux: boolean = isLinux,
): ComposerDropKind | null {
  if (!transfer) return null;
  if (carriesTreePath(transfer)) return "tree";
  if (carriesFiles(transfer)) return "files";
  const types = new Set(transfer.types ?? []);
  if (linux && types.has("text/uri-list") && !types.has("text/plain")) return "native";
  return null;
}

export function dropEffectFor(effectAllowed: string | undefined): "copy" | "move" | "link" | "none" {
  switch (effectAllowed) {
    case undefined:
    case "copy":
    case "copyLink":
    case "copyMove":
    case "all":
    case "uninitialized":
      return "copy";
    case "move":
    case "linkMove":
      return "move";
    case "link":
      return "link";
    default:
      return "none";
  }
}

export function pastedFiles(data: Pick<DataTransfer, "types" | "files"> | null | undefined): File[] {
  if (!data) return [];
  const types = Array.from(data.types ?? []);
  if (types.includes("text/plain")) return [];
  return Array.from(data.files ?? []);
}
