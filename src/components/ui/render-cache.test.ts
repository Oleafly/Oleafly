import { describe, expect, it } from "vitest";
import { RenderCache } from "./render-cache";

describe("RenderCache", () => {
  it("returns cached values and reports size", () => {
    const cache = new RenderCache<string>(10, 100);
    cache.set("a", "A", 5);
    expect(cache.get("a")).toBe("A");
    expect(cache.has("a")).toBe(true);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.size).toBe(1);
    expect(cache.weight).toBe(5);
  });

  it("evicts the least recently used entry past the entry limit", () => {
    const cache = new RenderCache<string>(2, 1000);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.get("a");
    cache.set("c", "C");
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("evicts by weight while always keeping the newest entry", () => {
    const cache = new RenderCache<string>(10, 10);
    cache.set("a", "A", 6);
    cache.set("b", "B", 6);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    cache.set("huge", "H", 50);
    expect(cache.has("huge")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("replaces an existing key without double counting its weight", () => {
    const cache = new RenderCache<string>(10, 100);
    cache.set("a", "A", 5);
    cache.set("a", "A2", 7);
    expect(cache.weight).toBe(7);
    expect(cache.get("a")).toBe("A2");
  });

  it("clears everything", () => {
    const cache = new RenderCache<string>(10, 100);
    cache.set("a", "A", 5);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.weight).toBe(0);
    expect(cache.has("a")).toBe(false);
  });
});
