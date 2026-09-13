// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeSourceControlGraphRequest,
  showSourceControlGraph,
  SOURCE_CONTROL_SHOW_GRAPH_EVENT,
} from "./source-control-events";

afterEach(() => {
  vi.useRealTimers();
  consumeSourceControlGraphRequest();
});

describe("source control graph requests", () => {
  it("dispatches the reveal event and hands one pending request to the next mount", () => {
    const seen = vi.fn();
    window.addEventListener(SOURCE_CONTROL_SHOW_GRAPH_EVENT, seen);
    showSourceControlGraph();
    window.removeEventListener(SOURCE_CONTROL_SHOW_GRAPH_EVENT, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(consumeSourceControlGraphRequest()).toBe(true);
    expect(consumeSourceControlGraphRequest()).toBe(false);
  });

  it("drops a request that no panel picked up in time", () => {
    vi.useFakeTimers();
    showSourceControlGraph();
    vi.advanceTimersByTime(5_001);
    expect(consumeSourceControlGraphRequest()).toBe(false);
  });
});
