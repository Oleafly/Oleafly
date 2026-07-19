import { beforeEach, describe, expect, it } from "vitest";
import { TOUR_IDS, tourRegistry } from "@/lib/tours/registry";
import {
  createTourState,
  defaultPersistedTourState,
  migrateLegacyTourState,
  migrateTourState,
  resilientTourStorage,
  TOUR_STORAGE_KEY,
} from "./tours";

function storageFixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("tour state", () => {
  let storage: ReturnType<typeof storageFixture>;

  beforeEach(() => {
    storage = storageFixture();
  });

  it("defaults every versioned tour to pending and enabled", () => {
    const state = defaultPersistedTourState();
    expect(state.enabled).toBe(true);
    expect(
      TOUR_IDS.map((id) => [state.tours[id].status, state.tours[id].version]),
    ).toEqual(TOUR_IDS.map((id) => ["pending", tourRegistry[id].version]));
  });

  it("persists terminal state but not an interrupted active tour or step", () => {
    const store = createTourState(storage);
    expect(store.getState().start("home", 3)).toBe(true);
    store.getState().complete();
    expect(JSON.parse(String(storage.getItem(TOUR_STORAGE_KEY) ?? "{}")).state).not.toHaveProperty(
      "activeTourId",
    );
    expect(
      JSON.parse(String(storage.getItem(TOUR_STORAGE_KEY) ?? "{}")).state.tours,
    ).not.toHaveProperty("workspace");

    const reloaded = createTourState(storage);
    expect(reloaded.getState().activeTourId).toBeNull();
    expect(reloaded.getState().activeStepIndex).toBe(0);
    expect(reloaded.getState().tours.home.status).toBe("completed");
  });

  it("reads legacy finished and skipped values without removing their keys", () => {
    const legacy = storageFixture({
      "oleafly.tour.home.v1": "finished",
      "oleafly.tour.project.v1": "skipped",
    });
    const state = migrateLegacyTourState(legacy);
    expect(state.tours.home.status).toBe("completed");
    expect(state.tours.workspace.status).toBe("dismissed");
    expect(legacy.getItem("oleafly.tour.home.v1")).toBe("finished");
    expect(legacy.getItem("oleafly.tour.project.v1")).toBe("skipped");
  });

  it("hydrates legacy values into the store when new storage is absent", () => {
    const legacy = storageFixture({
      "oleafly.tour.home.v1": "finished",
      "oleafly.tour.project.v1": "skipped",
    });
    const store = createTourState(legacy);
    expect(store.getState().tours.home.status).toBe("completed");
    expect(store.getState().tours.workspace.status).toBe("dismissed");
    expect(legacy.getItem("oleafly.tour.home.v1")).toBeNull();
    const reloaded = createTourState(legacy);
    expect(reloaded.getState().tours.home.status).toBe("completed");
    expect(reloaded.getState().tours.workspace.status).toBe("dismissed");
  });

  it("resets only an outdated tour version while enabled", () => {
    const current = defaultPersistedTourState();
    current.tours.home = { status: "completed", version: tourRegistry.home.version - 1 };
    current.tours.workspace.status = "dismissed";
    const migrated = migrateTourState(current);
    expect(migrated.tours.home.status).toBe("pending");
    expect(migrated.tours.workspace.status).toBe("dismissed");
  });

  it("does not silently re-enable or reset a globally disabled state", () => {
    const current = defaultPersistedTourState();
    current.enabled = false;
    current.tours.home = { status: "dismissed", version: 0 };
    const migrated = migrateTourState(current);
    expect(migrated.enabled).toBe(false);
    expect(migrated.tours.home.status).toBe("dismissed");
    expect(migrated.tours.home.version).toBe(tourRegistry.home.version);
  });

  it("prevents stacking and supports navigation without persisting progress", () => {
    const store = createTourState(storage);
    expect(store.getState().start("home")).toBe(true);
    expect(store.getState().start("settings")).toBe(false);
    store.getState().advance();
    store.getState().advance();
    store.getState().back();
    expect(store.getState().activeStepIndex).toBe(1);
  });

  it("starts pending tours normally and reserves terminal tours for manual restart", () => {
    const store = createTourState(storage);
    store.getState().complete("home");
    expect(store.getState().start("home")).toBe(false);
    expect(store.getState().restart("home", Number.POSITIVE_INFINITY)).toBe(true);
    expect(store.getState().activeStepIndex).toBe(0);
  });

  it("allows a manual context restart while tours are globally disabled", () => {
    const store = createTourState(storage);
    store.getState().dismissAll();
    expect(store.getState().start("home")).toBe(false);
    expect(store.getState().restart("home")).toBe(true);
    expect(store.getState().activeTourId).toBe("home");
    expect(store.getState().enabled).toBe(false);
  });

  it("completes and dismisses tours independently", () => {
    const store = createTourState(storage);
    store.getState().start("home");
    store.getState().complete();
    store.getState().start("settings");
    store.getState().dismiss();
    expect(store.getState().tours.home.status).toBe("completed");
    expect(store.getState().tours.settings.status).toBe("dismissed");
    expect(store.getState().tours.ai.status).toBe("pending");
  });

  it("enables and disables individual tours without resetting the others", () => {
    const store = createTourState(storage);
    store.getState().complete("home");
    store.getState().setTourEnabled("settings", false);
    expect(store.getState().tours.home.status).toBe("completed");
    expect(store.getState().tours.settings.status).toBe("dismissed");

    store.getState().setTourEnabled("settings", true);
    expect(store.getState().enabled).toBe(true);
    expect(store.getState().tours.settings.status).toBe("pending");
    expect(store.getState().tours.home.status).toBe("completed");
  });

  it("automatically disables after the final pending tour becomes terminal", () => {
    const store = createTourState(storage);
    for (const id of TOUR_IDS) store.getState().dismiss(id);
    expect(store.getState().enabled).toBe(false);
  });

  it("never re-enables an explicitly disabled store through terminal actions", () => {
    const store = createTourState(storage);
    store.getState().dismissAll();
    store.getState().complete("home");
    expect(store.getState().enabled).toBe(false);
  });

  it("normalizes an enabled all-terminal persisted state to disabled", () => {
    const current = defaultPersistedTourState();
    for (const id of TOUR_IDS) current.tours[id].status = "completed";
    expect(migrateTourState(current).enabled).toBe(false);
  });

  it("falls back to memory when storage operations throw", () => {
    const broken = resilientTourStorage({
      getItem: () => {
        throw new Error("read");
      },
      setItem: () => {
        throw new Error("write");
      },
      removeItem: () => {
        throw new Error("remove");
      },
    });
    expect(() => broken.setItem("tour-test", "value")).not.toThrow();
    expect(broken.getItem("tour-test")).toBe("value");
    expect(() => broken.removeItem("tour-test")).not.toThrow();
    expect(broken.getItem("tour-test")).toBeNull();
  });

  it("dismisses all and re-enable reset clears every prior terminal state", () => {
    const store = createTourState(storage);
    store.getState().dismissAll();
    expect(store.getState().enabled).toBe(false);
    expect(TOUR_IDS.every((id) => store.getState().tours[id].status === "dismissed")).toBe(true);
    store.getState().resetAll();
    expect(store.getState().enabled).toBe(true);
    expect(TOUR_IDS.every((id) => store.getState().tours[id].status === "pending")).toBe(true);
  });
});
