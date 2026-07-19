import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  TOUR_IDS,
  TOUR_SCHEMA_VERSION,
  type TourId,
  type TourStatus,
  tourRegistry,
} from "@/lib/tours/registry";

export const TOUR_STORAGE_KEY = "oleafly.tours";
export const LEGACY_TOUR_KEYS: Partial<Record<TourId, string>> = {
  home: "oleafly.tour.home.v1",
  workspace: "oleafly.tour.project.v1",
};

type SyncStateStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export interface PersistedTourEntry {
  status: TourStatus;
  version: number;
}

export interface PersistedTourState {
  schemaVersion: number;
  enabled: boolean;
  tours: Record<TourId, PersistedTourEntry>;
}

interface StoredTourState {
  schemaVersion: number;
  enabled: boolean;
  tours: Partial<Record<TourId, PersistedTourEntry>>;
}

export interface TourState extends PersistedTourState {
  activeTourId: TourId | null;
  activeStepIndex: number;
  start: (id: TourId, stepIndex?: number) => boolean;
  restart: (id: TourId, stepIndex?: number) => boolean;
  advance: () => void;
  back: () => void;
  complete: (id?: TourId) => void;
  dismiss: (id?: TourId) => void;
  stop: () => void;
  dismissAll: () => void;
  resetAll: () => void;
  setTourEnabled: (id: TourId, enabled: boolean) => void;
}

function pendingTours(): Record<TourId, PersistedTourEntry> {
  return Object.fromEntries(
    TOUR_IDS.map((id) => [id, { status: "pending", version: tourRegistry[id].version }]),
  ) as Record<TourId, PersistedTourEntry>;
}

export function defaultPersistedTourState(): PersistedTourState {
  return {
    schemaVersion: TOUR_SCHEMA_VERSION,
    enabled: true,
    tours: pendingTours(),
  };
}

function normalizeEntry(id: TourId, value: unknown, enabled: boolean): PersistedTourEntry {
  const version = tourRegistry[id].version;
  if (!value || typeof value !== "object") return { status: "pending", version };
  const entry = value as Partial<PersistedTourEntry>;
  const status =
    entry.status === "completed" || entry.status === "dismissed" ? entry.status : "pending";
  if (entry.version !== version && enabled) return { status: "pending", version };
  return { status, version };
}

export function migrateTourState(value: unknown): PersistedTourState {
  if (!value || typeof value !== "object") return defaultPersistedTourState();
  const stored = value as Partial<StoredTourState>;
  const explicitlyDisabled = stored.enabled === false;
  const source: Partial<Record<TourId, unknown>> =
    stored.tours && typeof stored.tours === "object" ? stored.tours : {};
  const tours = Object.fromEntries(
    TOUR_IDS.map((id) => [id, normalizeEntry(id, source[id], !explicitlyDisabled)]),
  ) as Record<TourId, PersistedTourEntry>;
  const allTerminal = TOUR_IDS.every((id) => tours[id].status !== "pending");
  return {
    schemaVersion: TOUR_SCHEMA_VERSION,
    enabled: !explicitlyDisabled && !allTerminal,
    tours,
  };
}

export function migrateLegacyTourState(storage: Pick<SyncStateStorage, "getItem">) {
  const state = defaultPersistedTourState();
  for (const id of TOUR_IDS) {
    const key = LEGACY_TOUR_KEYS[id];
    if (!key) continue;
    let legacy: string | null = null;
    try {
      legacy = storage.getItem(key);
    } catch {}
    if (legacy === "finished") state.tours[id].status = "completed";
    if (legacy === "skipped") state.tours[id].status = "dismissed";
  }
  return state;
}

const fallbackValues = new Map<string, string>();
const fallbackStorage: SyncStateStorage = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => void fallbackValues.set(key, value),
  removeItem: (key) => void fallbackValues.delete(key),
};

export function resilientTourStorage(primary: SyncStateStorage): SyncStateStorage {
  const memory = new Map<string, string>();
  return {
    getItem: (key) => {
      try {
        const value = primary.getItem(key);
        if (value !== null) memory.set(key, value);
        return value ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem: (key, value) => {
      memory.set(key, value);
      try {
        primary.setItem(key, value);
      } catch {}
    },
    removeItem: (key) => {
      memory.delete(key);
      try {
        primary.removeItem(key);
      } catch {}
    },
  };
}

function browserStorage(): SyncStateStorage {
  try {
    return typeof localStorage === "undefined" ? fallbackStorage : localStorage;
  } catch {
    return fallbackStorage;
  }
}

function terminalOnly(state: PersistedTourState): StoredTourState {
  return {
    schemaVersion: state.schemaVersion,
    enabled: state.enabled,
    tours: Object.fromEntries(
      TOUR_IDS.flatMap((id) =>
        state.tours[id].status === "pending" ? [] : [[id, state.tours[id]]],
      ),
    ),
  };
}

function promoteLegacy(primary: SyncStateStorage) {
  try {
    if (primary.getItem(TOUR_STORAGE_KEY) !== null) return;
  } catch {
    return;
  }
  const legacy = migrateLegacyTourState(primary);
  if (TOUR_IDS.every((id) => legacy.tours[id].status === "pending")) return;
  try {
    primary.setItem(
      TOUR_STORAGE_KEY,
      JSON.stringify({ state: terminalOnly(legacy), version: TOUR_SCHEMA_VERSION }),
    );
  } catch {
    return;
  }
  for (const key of Object.values(LEGACY_TOUR_KEYS)) {
    try {
      primary.removeItem(key);
    } catch {}
  }
}

function clampStep(id: TourId, stepIndex: number) {
  const last = Math.max(0, tourRegistry[id].steps.length - 1);
  if (!Number.isFinite(stepIndex)) return 0;
  return Math.min(last, Math.max(0, Math.trunc(stepIndex)));
}

function terminalUpdate(
  state: TourState,
  id: TourId,
  status: Extract<TourStatus, "completed" | "dismissed">,
): Partial<TourState> {
  const tours = { ...state.tours, [id]: { ...state.tours[id], status } };
  return {
    tours,
    enabled:
      state.enabled && !TOUR_IDS.every((tourId) => tours[tourId].status !== "pending"),
    activeTourId: state.activeTourId === id ? null : state.activeTourId,
    activeStepIndex: state.activeTourId === id ? 0 : state.activeStepIndex,
  };
}

export function createTourState(primary: SyncStateStorage = browserStorage()) {
  promoteLegacy(primary);
  const storage: StateStorage = resilientTourStorage(primary);
  return create<TourState>()(
    persist(
      (set, get) => {
        const begin = (id: TourId, stepIndex: number, manual: boolean) => {
          const state = get();
          if (
            (!state.enabled && !manual) ||
            state.activeTourId !== null ||
            (!manual && state.tours[id].status !== "pending")
          ) {
            return false;
          }
          set({ activeTourId: id, activeStepIndex: clampStep(id, stepIndex) });
          return true;
        };
        return {
          ...defaultPersistedTourState(),
          activeTourId: null,
          activeStepIndex: 0,
          start: (id, stepIndex = 0) => begin(id, stepIndex, false),
          restart: (id, stepIndex = 0) => begin(id, stepIndex, true),
          advance: () =>
            set((state) => ({
              activeStepIndex: clampStep(
                state.activeTourId ?? "home",
                state.activeStepIndex + 1,
              ),
            })),
          back: () =>
            set((state) => ({
              activeStepIndex: clampStep(
                state.activeTourId ?? "home",
                state.activeStepIndex - 1,
              ),
            })),
          complete: (id) =>
            set((state) => {
              const target = id ?? state.activeTourId;
              return target ? terminalUpdate(state, target, "completed") : state;
            }),
          dismiss: (id) =>
            set((state) => {
              const target = id ?? state.activeTourId;
              return target ? terminalUpdate(state, target, "dismissed") : state;
            }),
          stop: () => set({ activeTourId: null, activeStepIndex: 0 }),
          dismissAll: () =>
            set({
              enabled: false,
              tours: Object.fromEntries(
                TOUR_IDS.map((id) => [
                  id,
                  { status: "dismissed", version: tourRegistry[id].version },
                ]),
              ) as Record<TourId, PersistedTourEntry>,
              activeTourId: null,
              activeStepIndex: 0,
            }),
          resetAll: () =>
            set({ ...defaultPersistedTourState(), activeTourId: null, activeStepIndex: 0 }),
          setTourEnabled: (id, enabled) =>
            set((state) => {
              const tours = {
                ...state.tours,
                [id]: {
                  status: enabled ? ("pending" as const) : ("dismissed" as const),
                  version: tourRegistry[id].version,
                },
              };
              return {
                tours,
                enabled:
                  enabled ||
                  (state.enabled &&
                    !TOUR_IDS.every((tourId) => tours[tourId].status !== "pending")),
                activeTourId: state.activeTourId === id ? null : state.activeTourId,
                activeStepIndex: state.activeTourId === id ? 0 : state.activeStepIndex,
              };
            }),
        };
      },
      {
        name: TOUR_STORAGE_KEY,
        version: TOUR_SCHEMA_VERSION,
        storage: createJSONStorage(() => storage),
        migrate: (state) => migrateTourState(state),
        merge: (stored, current) => ({
          ...current,
          ...migrateTourState(stored),
          activeTourId: null,
          activeStepIndex: 0,
        }),
        partialize: (state) => terminalOnly(state),
      },
    ),
  );
}

export const useTourStore = createTourState();
