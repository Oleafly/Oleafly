import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export const BOARD_SAVE_DELAY_MS = 300;

export interface BoardScene {
  readonly elements: NonNullable<ImportedDataState["elements"]>;
  readonly appState: NonNullable<ImportedDataState["appState"]>;
  readonly files: NonNullable<ImportedDataState["files"]>;
}

export type BoardCamera = Readonly<Pick<AppState, "scrollX" | "scrollY" | "zoom">>;

const cameras = new Map<string, BoardCamera>();

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readBoardScene(content: string): BoardScene | null {
  if (content.trim() === "") return { elements: [], appState: {}, files: {} };
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(data) || (data.type !== undefined && data.type !== "excalidraw") || !Array.isArray(data.elements)) {
    return null;
  }
  return {
    elements: data.elements as BoardScene["elements"],
    appState: isRecord(data.appState) ? (data.appState as BoardScene["appState"]) : {},
    files: isRecord(data.files) ? (data.files as BoardScene["files"]) : {},
  };
}

export function boardLanguage(language: string, codes: readonly string[]): string {
  const wanted = LANGUAGE_ALIASES[language] ?? language;
  if (codes.includes(wanted)) return wanted;
  const base = wanted.split("-")[0];
  return codes.find((code) => code === base) ?? codes.find((code) => code.startsWith(`${base}-`)) ?? "en";
}

export function boardCamera(key: string): BoardCamera | undefined {
  return cameras.get(key);
}

export function rememberBoardCamera(key: string, camera: BoardCamera): void {
  cameras.set(key, camera);
}
