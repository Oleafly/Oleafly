// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  outerPosition: vi.fn(), innerSize: vi.fn(), scaleFactor: vi.fn(),
  onMoved: vi.fn(), onResized: vi.fn(), offMoved: vi.fn(), offResized: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks }));

import {
  geometryOnScreen,
  readPreviewGeometry,
  readWindowGeometry,
  usePreviewGeometry,
  useWindowGeometry,
} from "./preview-geometry";

const geometry = { x: -800, y: 100, width: 800, height: 600 };
const storageKey = "oleafly.preview.geometry.paper";

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.outerPosition.mockResolvedValue({ x: -1600, y: 200 });
  mocks.innerSize.mockResolvedValue({ width: 1600, height: 1200 });
  mocks.scaleFactor.mockResolvedValue(2);
  mocks.onMoved.mockResolvedValue(mocks.offMoved);
  mocks.onResized.mockResolvedValue(mocks.offResized);
});
afterEach(() => vi.restoreAllMocks());

describe("saved preview geometry", () => {
  it("restores logical coordinates independently for each project", () => {
    localStorage.setItem(storageKey, JSON.stringify({ ...geometry, ignored: true }));
    expect(readPreviewGeometry("paper")).toEqual(geometry);
    expect(readPreviewGeometry("other")).toBeNull();
  });

  it.each([
    "null", "not-json", "{}",
    JSON.stringify({ ...geometry, x: "100" }),
    ...[
      { width: 319 }, { height: 239 }, { width: 8193 }, { height: 8193 },
      { x: -65537 }, { y: 65537 },
    ].map((invalid) => JSON.stringify({ ...geometry, ...invalid })),
  ])("ignores unusable saved geometry: %s", (serialized) => {
    localStorage.setItem(storageKey, serialized);
    expect(readPreviewGeometry("paper")).toBeNull();
  });

  it("tolerates storage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage denied"); });
    expect(readPreviewGeometry("paper")).toBeNull();
  });
});

describe("preview geometry persistence", () => {
  it("records logical size and position on mount, movement, and resize", async () => {
    const { unmount } = renderHook(() => usePreviewGeometry("paper", true));
    await waitFor(() => expect(readPreviewGeometry("paper")).toEqual(geometry));
    mocks.outerPosition.mockResolvedValue({ x: 200, y: 400 });
    await act(async () => { mocks.onMoved.mock.calls[0][0](); });
    expect(readPreviewGeometry("paper")).toEqual({ ...geometry, x: 100, y: 200 });
    mocks.innerSize.mockResolvedValue({ width: 2000, height: 1600 });
    await act(async () => { mocks.onResized.mock.calls[0][0](); });
    expect(readPreviewGeometry("paper")).toEqual({ x: 100, y: 200, width: 1000, height: 800 });
    unmount();
    await waitFor(() => {
      expect(mocks.offMoved).toHaveBeenCalledOnce();
      expect(mocks.offResized).toHaveBeenCalledOnce();
    });
  });

  it.each([["paper", false], ["", true]] as const)("does not access a window for project '%s' with enabled=%s", (project, enabled) => {
    renderHook(() => usePreviewGeometry(project, enabled));
    expect(mocks.outerPosition).not.toHaveBeenCalled();
    expect(mocks.onMoved).not.toHaveBeenCalled();
  });

  it("discards an unfinished measurement when switching projects", async () => {
    let resolvePosition!: (position: { x: number; y: number }) => void;
    mocks.outerPosition.mockReturnValueOnce(new Promise((resolve) => { resolvePosition = resolve; }));
    const { rerender } = renderHook(({ project }) => usePreviewGeometry(project, true), { initialProps: { project: "paper" } });
    rerender({ project: "next" });
    await waitFor(() => expect(readPreviewGeometry("next")).toEqual(geometry));
    await act(async () => { resolvePosition({ x: 20, y: 30 }); });
    expect(readPreviewGeometry("paper")).toBeNull();
    expect(mocks.offMoved).toHaveBeenCalledOnce();
    expect(mocks.offResized).toHaveBeenCalledOnce();
  });

  it("recovers on the next move after a native measurement fails", async () => {
    mocks.innerSize.mockRejectedValueOnce(new Error("window unavailable"));
    renderHook(() => usePreviewGeometry("paper", true));
    await act(async () => {});
    expect(readPreviewGeometry("paper")).toBeNull();
    await act(async () => { mocks.onMoved.mock.calls[0][0](); });
    expect(readPreviewGeometry("paper")).toEqual(geometry);
  });

  it("tolerates a write failure while storage is full", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    renderHook(() => usePreviewGeometry("paper", true));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(readPreviewGeometry("paper")).toBeNull();
  });
});

describe("geometry for any window", () => {
  it("reads and records under the key it is given", async () => {
    const { unmount } = renderHook(() => useWindowGeometry("oleafly.console.geometry.lab"));
    await waitFor(() => expect(readWindowGeometry("oleafly.console.geometry.lab")).toEqual(geometry));
    expect(readPreviewGeometry("lab")).toBeNull();
    unmount();
    await waitFor(() => expect(mocks.offMoved).toHaveBeenCalledOnce());
  });

  it("does nothing without a key", () => {
    renderHook(() => useWindowGeometry(null));
    expect(mocks.outerPosition).not.toHaveBeenCalled();
    expect(readWindowGeometry("oleafly.console.geometry.lab")).toBeNull();
  });
});

describe("geometryOnScreen", () => {
  const retina = { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, scaleFactor: 2 };
  const left = { position: { x: -1920, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };

  it("keeps a window that still sits on a connected screen", () => {
    expect(geometryOnScreen({ x: 100, y: 100, width: 800, height: 600 }, [retina])).toBe(true);
    expect(geometryOnScreen(geometry, [retina, left])).toBe(true);
  });

  it("drops a window whose screen is gone or that would hide past an edge", () => {
    expect(geometryOnScreen(geometry, [retina])).toBe(false);
    expect(geometryOnScreen({ x: 1400, y: 100, width: 800, height: 600 }, [retina])).toBe(false);
    expect(geometryOnScreen({ x: 100, y: -10, width: 800, height: 600 }, [retina])).toBe(false);
    expect(geometryOnScreen(geometry, [])).toBe(false);
  });
});
