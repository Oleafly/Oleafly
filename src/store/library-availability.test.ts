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

  it("keeps the same answers object when a forced recheck finds nothing new, so the library does not redraw", async () => {
    probeProjectAvailability.mockResolvedValue([
      { project_id: "linked-a", availability: "ok", modified_at_ms: 5_000 },
      { project_id: "linked-b", availability: "offline" },
    ]);
    const store = useLibraryAvailabilityStore.getState();
    await store.check(["linked-a", "linked-b"]);
    const { checked, modified } = useLibraryAvailabilityStore.getState();

    await store.check(["linked-a", "linked-b"], { force: true });
    expect(useLibraryAvailabilityStore.getState().checked).toBe(checked);
    expect(useLibraryAvailabilityStore.getState().modified).toBe(modified);

    probeProjectAvailability.mockResolvedValue([
      { project_id: "linked-a", availability: "missing", modified_at_ms: 6_000 },
    ]);
    await store.check(["linked-a"], { force: true });
    expect(useLibraryAvailabilityStore.getState().checked).toEqual({
      "linked-a": "missing",
      "linked-b": "offline",
    });
    expect(useLibraryAvailabilityStore.getState().modified).toEqual({ "linked-a": 6 });
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

  it("keeps when each folder's content last changed, in seconds, and keeps it across checks", async () => {
    probeProjectAvailability.mockResolvedValueOnce([
      { project_id: "linked-a", availability: "ok", modified_at_ms: 1_790_000_000_500 },
      { project_id: "linked-b", availability: "missing" },
    ]);
    const store = useLibraryAvailabilityStore.getState();
    await store.check(["linked-a", "linked-b"]);
    expect(useLibraryAvailabilityStore.getState().modified).toEqual({ "linked-a": 1_790_000_000.5 });

    probeProjectAvailability.mockResolvedValueOnce([{ project_id: "linked-a", availability: "offline" }]);
    await store.check(["linked-a"], { force: true });
    expect(useLibraryAvailabilityStore.getState().modified).toEqual({ "linked-a": 1_790_000_000.5 });

    store.reset();
    expect(useLibraryAvailabilityStore.getState().modified).toEqual({});
  });

  it("skips the call when there is nothing to check", async () => {
    await useLibraryAvailabilityStore.getState().check([]);
    expect(probeProjectAvailability).not.toHaveBeenCalled();
  });
});
