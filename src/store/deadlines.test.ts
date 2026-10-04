import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readDeadlines: vi.fn(),
  refreshDeadlines: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  readDeadlines: mocks.readDeadlines,
  refreshDeadlines: mocks.refreshDeadlines,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useDeadlinesStore } from "./deadlines";

const venue = {
  id: "neurips",
  title: "NeurIPS",
  full_name: "Neural Information Processing Systems",
  sub: "ML",
  rank: "A*",
  link: "https://neurips.cc",
  timezone: "AoE",
  deadlines: [{ kind: "paper", at: "2026-05-15 23:59" }],
  conf_date: "2026-12-01",
  place: "Vancouver",
};

beforeEach(() => {
  mocks.readDeadlines.mockReset();
  mocks.refreshDeadlines.mockReset().mockResolvedValue(undefined);
  mocks.logError.mockReset().mockResolvedValue(undefined);
  useDeadlinesStore.setState({ venues: null, generatedAt: null, busy: false, error: null });
});

describe("deadlines store", () => {
  it("loads the bundled venue list and its generation date", async () => {
    mocks.readDeadlines.mockResolvedValue(JSON.stringify({ generated_at: "2026-10-01", venues: [venue] }));

    await useDeadlinesStore.getState().openView();

    expect(useDeadlinesStore.getState()).toMatchObject({
      venues: [venue],
      generatedAt: "2026-10-01",
      error: null,
    });
  });

  it("treats a file without venues or a date as empty", async () => {
    mocks.readDeadlines.mockResolvedValue(JSON.stringify({ venues: "not a list", generated_at: "" }));

    await useDeadlinesStore.getState().openView();

    expect(useDeadlinesStore.getState().venues).toEqual([]);
    expect(useDeadlinesStore.getState().generatedAt).toBeNull();
  });

  it("shows the read error with an empty list when the file cannot be parsed", async () => {
    mocks.readDeadlines.mockResolvedValue("{broken");

    await useDeadlinesStore.getState().openView();

    const state = useDeadlinesStore.getState();
    expect(state.venues).toEqual([]);
    expect(state.error).toMatch(/SyntaxError/);
    expect(mocks.logError).toHaveBeenCalledWith("deadlines", expect.any(SyntaxError));
  });

  it("refreshes from the network and reloads the venues", async () => {
    mocks.readDeadlines.mockResolvedValue(JSON.stringify({ generated_at: "2026-10-04", venues: [venue] }));
    useDeadlinesStore.setState({ error: "old failure" });

    const pending = useDeadlinesStore.getState().refresh();
    expect(useDeadlinesStore.getState()).toMatchObject({ busy: true, error: null });
    await pending;

    expect(mocks.refreshDeadlines).toHaveBeenCalledTimes(1);
    expect(useDeadlinesStore.getState()).toMatchObject({
      venues: [venue],
      generatedAt: "2026-10-04",
      busy: false,
    });
  });

  it("keeps the current venues and reports the failure when a refresh fails", async () => {
    useDeadlinesStore.setState({ venues: [venue], generatedAt: "2026-09-01" });
    mocks.refreshDeadlines.mockRejectedValue("offline");

    await useDeadlinesStore.getState().refresh();

    expect(useDeadlinesStore.getState()).toMatchObject({
      venues: [venue],
      generatedAt: "2026-09-01",
      busy: false,
      error: "offline",
    });
    expect(mocks.readDeadlines).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("deadlines", "offline");
  });
});
