// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayoutRequest, LayoutUpdate } from "./note-graph-layout";

describe("note graph worker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.onmessage = null;
  });

  it("runs the layout engine on messages and transfers the positions", async () => {
    vi.useFakeTimers();
    const posted: { message: LayoutUpdate; transfer: Transferable[] }[] = [];
    vi.spyOn(window, "postMessage").mockImplementation(((message: LayoutUpdate, transfer: Transferable[]) => {
      posted.push({ message, transfer });
    }) as typeof window.postMessage);
    await import("./note-graph.worker");
    const handler = window.onmessage as unknown as (event: { data: LayoutRequest }) => void;
    handler({ data: { type: "start", generation: 1, count: 2, edges: new Uint32Array([0, 1]), positions: null, animate: true } });
    expect(posted[0].message.generation).toBe(1);
    expect(posted[0].transfer[0]).toBe(posted[0].message.positions.buffer);
    handler({ data: { type: "start", generation: 2, count: 2, edges: new Uint32Array([0, 1]), positions: null, animate: true } });
    expect(posted[1].message.generation).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(posted.at(-1)?.message.settled).toBe(true);
    handler({ data: { type: "stop" } });
  });
});
