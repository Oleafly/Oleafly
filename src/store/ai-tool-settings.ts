import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export const AI_TOOL_SETTINGS_STORAGE_KEY = "oleafly.ai-tools";

export interface AiToolSettingsState {
  enabledByName: Record<string, boolean>;
  setToolEnabled: (name: string, enabled: boolean) => void;
  setToolsEnabled: (names: readonly string[], enabled: boolean) => void;
}

const fallbackValues = new Map<string, string>();

const fallbackStorage: StateStorage = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => void fallbackValues.set(key, value),
  removeItem: (key) => void fallbackValues.delete(key),
};

function browserStorage(): StateStorage {
  try {
    return typeof localStorage === "undefined" ? fallbackStorage : localStorage;
  } catch {
    return fallbackStorage;
  }
}

function normalizedEnabledMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] =>
      typeof entry[1] === "boolean"
    ),
  );
}

export function isToolEnabled(
  enabledByName: Readonly<Record<string, boolean>>,
  name: string,
): boolean {
  return enabledByName[name] !== false;
}

export const selectToolEnabled = (name: string) => (state: AiToolSettingsState) =>
  isToolEnabled(state.enabledByName, name);

export function createAiToolSettingsStore(storage: StateStorage = browserStorage()) {
  return create<AiToolSettingsState>()(
    persist(
      (set) => ({
        enabledByName: {},
        setToolEnabled: (name, enabled) =>
          set((state) => ({
            enabledByName: { ...state.enabledByName, [name]: enabled },
          })),
        setToolsEnabled: (names, enabled) =>
          set((state) => ({
            enabledByName: Object.fromEntries([
              ...Object.entries(state.enabledByName),
              ...Array.from(new Set(names), (name) => [name, enabled] as const),
            ]),
          })),
      }),
      {
        name: AI_TOOL_SETTINGS_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({ enabledByName: state.enabledByName }),
        merge: (persisted, current) => ({
          ...current,
          enabledByName: normalizedEnabledMap(
            (persisted as Partial<AiToolSettingsState> | undefined)?.enabledByName,
          ),
        }),
      },
    ),
  );
}

export const useAiToolSettingsStore = createAiToolSettingsStore();

export function setToolEnabled(name: string, enabled: boolean): void {
  useAiToolSettingsStore.getState().setToolEnabled(name, enabled);
}
