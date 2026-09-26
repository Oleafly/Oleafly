import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectAvailabilityReport } from "@/lib/tauri";

const probeProjectAvailability = vi.fn<(ids: string[]) => Promise<ProjectAvailabilityReport[]>>();
const logError = vi.fn(async () => {});

vi.mock("@/lib/tauri", () => ({
  probeProjectAvailability: (ids: string[]) => probeProjectAvailability(ids),
}));
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => logError(...(args as [])),
}));

import { useLibraryAvailabilityStore } from "./library-availability";

function reports(entries: Record<string, ProjectAvailabilityReport["availability"]>) {
  return Object.entries(entries).map(([project_id, availability]) => ({
    project_id,
    availability,
  }));
}

beforeEach(() => {
  vi.useRealTimers();
  probeProjectAvailability.mockReset();
  logError.mockReset();
  useLibraryAvailabilityStore.getState().reset();
});

describe("library folder checks", () => {
  it("records what each folder check found", async () => {
    probeProjectAvailability.mockResolvedValue(
      reports({ "linked-a": "ok", "linked-b": "offline", "linked-c": "permission_denied" }),
    );

    const found = await useLibraryAvailabilityStore
      .getState()
      .check(["linked-a", "linked-b", "linked-c"]);

    expect(probeProjectAvailability).toHaveBeenCalledWith(["linked-a", "linked-b", "linked-c"]);
    expect(found).toEqual({
      "linked-a": "ok",
      "linked-b": "offline",
      "linked-c": "permission_denied",
    });
    expect(useLibraryAvailabilityStore.getState().checked).toEqual(found);
    expect(useLibraryAvailabilityStore.getState().checking).toEqual({});
  });

  it("does not ask again right away unless forced, and keeps an earlier answer over unknown", async () => {
    vi.useFakeTimers();
    probeProjectAvailability.mockResolvedValueOnce(reports({ "linked-a": "missing" }));
    const store = useLibraryAvailabilityStore.getState();
    await store.check(["linked-a"]);
    await store.check(["linked-a"]);
    expect(probeProjectAvailability).toHaveBeenCalledTimes(1);

    probeProjectAvailability.mockResolvedValueOnce(reports({ "linked-a": "unknown" }));
    await store.check(["linked-a"], { force: true });
    expect(probeProjectAvailability).toHaveBeenCalledTimes(2);
    expect(useLibraryAvailabilityStore.getState().checked["linked-a"]).toBe("missing");

    vi.advanceTimersByTime(16_000);
    probeProjectAvailability.mockResolvedValueOnce(reports({ "linked-a": "ok" }));
    await store.check(["linked-a"]);
    expect(useLibraryAvailabilityStore.getState().checked["linked-a"]).toBe("ok");
  });

  it("joins a check that is already running instead of starting another", async () => {
    let finish: (value: ProjectAvailabilityReport[]) => void = () => {};
    probeProjectAvailability.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const store = useLibraryAvailabilityStore.getState();
    const first = store.check(["linked-a"]);
    expect(useLibraryAvailabilityStore.getState().checking).toEqual({ "linked-a": true });
    const second = store.check(["linked-a"], { force: true });
    finish(reports({ "linked-a": "ok" }));
    await Promise.all([first, second]);
    expect(probeProjectAvailability).toHaveBeenCalledTimes(1);
    expect(await second).toEqual({ "linked-a": "ok" });
  });

  it("stays quiet and unchanged when the check itself fails", async () => {
    probeProjectAvailability.mockRejectedValueOnce(new Error("ipc down"));

    await useLibraryAvailabilityStore.getState().check(["linked-a"]);

    expect(useLibraryAvailabilityStore.getState().checked).toEqual({});
    expect(useLibraryAvailabilityStore.getState().checking).toEqual({});
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("skips the call when there is nothing to check", async () => {
    await useLibraryAvailabilityStore.getState().check([]);
    expect(probeProjectAvailability).not.toHaveBeenCalled();
  });
});
