// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteLinkRecord } from "@/lib/tauri";
import {
  adjacency,
  buildGraph,
  clampZoom,
  createLayoutEngine,
  edgeArray,
  filterGraph,
  fitView,
  GRAPH_LAYOUT_KEY,
  graphSignature,
  hitTest,
  initialPositions,
  localGraph,
  matchesQuery,
  MAX_ZOOM,
  MIN_ZOOM,
  nodeRadius,
  noteKey,
  projectKey,
  readSavedPositions,
  savePositions,
  toWorld,
  zoomAt,
  type GraphData,
  type LayoutUpdate,
} from "./note-graph-layout";

function toScreen(view: { x: number; y: number; k: number }, wx: number, wy: number): [number, number] {
  return [wx * view.k + view.x, wy * view.k + view.y];
}

function record(projectId: string, noteId: string | null, links: [kind: "note" | "project", id: string][]): NoteLinkRecord {
  return { projectId, noteId, title: projectId, links: links.map(([kind, id]) => ({ kind, id, snippet: "" })) };
}

const notes = [
  { id: "a", title: "Alpha", color: "#111111", tags: ["lab/2024", "ml"] },
  { id: "b", title: "Beta", color: "#222222", icon: "🧪", tags: ["lab"] },
  { id: "c", title: "Gamma", color: "#333333" },
  { id: "d", title: "Delta", color: "#444444" },
];
const records = [
  record("a", "na", [
    ["note", "nb"],
    ["note", "nb"],
    ["note", "na"],
    ["project", "p1"],
    ["project", "c"],
    ["note", "missing"],
    ["project", "unknown"],
  ]),
  record("b", "nb", [
    ["note", "na"],
    ["note", "nc"],
  ]),
  record("c", "nc", []),
  record("zz", "nz", [["note", "na"]]),
];
const projects = [{ id: "p1", name: "Paper" }];

function graph(projectsShown = true): GraphData {
  return buildGraph({ notes, records, projects }, { projects: projectsShown, projectColor: "#999999" });
}

describe("buildGraph", () => {
  it("joins notes by front matter id, dedupes pairs and adds project nodes", () => {
    const built = graph();
    expect(built.nodes.map((node) => node.key)).toEqual([noteKey("a"), noteKey("b"), noteKey("c"), noteKey("d"), projectKey("p1")]);
    expect(built.edges).toEqual([
      { source: 0, target: 1 },
      { source: 0, target: 4 },
      { source: 0, target: 2 },
      { source: 1, target: 2 },
    ]);
    expect(built.nodes.map((node) => node.degree)).toEqual([3, 2, 2, 0, 1]);
    expect(built.nodes[4]).toMatchObject({ kind: "project", title: "Paper", color: "#999999", tags: [] });
    expect(built.nodes[1]).toMatchObject({ icon: "🧪", tags: ["lab"] });
    expect(built.nodes[2].tags).toEqual([]);
  });

  it("leaves project nodes out when they are turned off and reads no records", () => {
    expect(graph(false).nodes.some((node) => node.kind === "project")).toBe(false);
    const empty = buildGraph({ notes, records: null, projects: [] }, { projects: true, projectColor: "#999" });
    expect(empty.edges).toEqual([]);
    expect(empty.nodes).toHaveLength(4);
  });
});

describe("filters", () => {
  it("keeps tagged notes with their projects and drops orphans", () => {
    const tagged = filterGraph(graph(), { tag: "Lab", orphans: true });
    expect(tagged.nodes.map((node) => node.id)).toEqual(["a", "b", "p1"]);
    expect(tagged.edges).toEqual([
      { source: 0, target: 1 },
      { source: 0, target: 2 },
    ]);
    const nested = filterGraph(graph(), { tag: "lab/2024", orphans: true });
    expect(nested.nodes.map((node) => node.id)).toEqual(["a", "p1"]);
    const linked = filterGraph(graph(), { tag: null, orphans: false });
    expect(linked.nodes.map((node) => node.id)).toEqual(["a", "b", "c", "p1"]);
    expect(filterGraph(graph(), { tag: null, orphans: true }).nodes).toHaveLength(5);
  });

  it("walks out from a note to the requested depth", () => {
    const full = graph();
    expect(localGraph(full, noteKey("c"), 1).nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(localGraph(full, noteKey("d"), 2).nodes.map((node) => node.id)).toEqual(["d"]);
    expect(localGraph(full, projectKey("p1"), 1).nodes.map((node) => node.id)).toEqual(["a", "p1"]);
    expect(localGraph(full, projectKey("p1"), 2).nodes).toHaveLength(4);
    expect(localGraph(full, noteKey("none"), 2)).toEqual({ nodes: [], edges: [] });
    expect(adjacency(full)[0]).toEqual([1, 4, 2]);
  });

  it("matches titles and tags and signs the structure", () => {
    const built = graph();
    expect(matchesQuery(built.nodes[0], "  alp ")).toBe(true);
    expect(matchesQuery(built.nodes[0], "ml")).toBe(true);
    expect(matchesQuery(built.nodes[2], "ml")).toBe(false);
    expect(matchesQuery(built.nodes[2], "")).toBe(true);
    expect(graphSignature(built)).toBe(graphSignature(graph()));
    expect(graphSignature(built)).not.toBe(graphSignature(graph(false)));
  });
});

describe("view math", () => {
  const nodes = [
    { degree: 0, kind: "note" as const },
    { degree: 9, kind: "note" as const },
  ];

  it("sizes nodes by links and caps them", () => {
    expect(nodeRadius({ degree: 0, kind: "note" })).toBe(4);
    expect(nodeRadius({ degree: 400, kind: "note" })).toBe(18);
    expect(nodeRadius({ degree: 400, kind: "project" })).toBe(12);
  });

  it("zooms around a point and converts coordinates", () => {
    const view = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 50);
    expect(view).toEqual({ k: 2, x: -100, y: -50 });
    expect(toWorld(view, 100, 50)).toEqual([100, 50]);
    expect(toScreen(view, 100, 50)).toEqual([100, 50]);
    expect(zoomAt(view, 1000, 0, 0).k).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });

  it("fits the layout into the canvas", () => {
    const positions = new Float32Array([-100, -50, 100, 50]);
    const view = fitView(positions, [nodes[0], nodes[0]], 400, 300);
    expect(view.k).toBeGreaterThan(1);
    expect(view.k).toBeLessThanOrEqual(2);
    expect(toScreen(view, 0, 0)).toEqual([200, 150]);
    expect(fitView(null, nodes, 400, 300)).toEqual({ x: 200, y: 150, k: 1 });
    expect(fitView(positions, nodes, 0, 300)).toEqual({ x: 0, y: 150, k: 1 });
    expect(fitView(new Float32Array([5, 5]), [nodes[0]], 400, 300).k).toBe(2);
  });

  it("hits the closest node under the pointer", () => {
    const positions = new Float32Array([0, 0, 10, 0]);
    const view = { x: 0, y: 0, k: 1 };
    expect(hitTest(positions, nodes, view, 9, 0)).toBe(1);
    expect(hitTest(positions, nodes, view, -2, 0)).toBe(0);
    expect(hitTest(positions, nodes, view, 200, 200)).toBe(-1);
    expect(hitTest(null, nodes, view, 0, 0)).toBe(-1);
  });
});

describe("saved positions", () => {
  beforeEach(() => {
    localStorage.removeItem(GRAPH_LAYOUT_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(GRAPH_LAYOUT_KEY);
  });

  it("reads only well formed entries", () => {
    expect(readSavedPositions().size).toBe(0);
    for (const raw of ["not json", JSON.stringify({ version: 2, positions: {} }), JSON.stringify({ version: 1, positions: null }), "null"]) {
      localStorage.setItem(GRAPH_LAYOUT_KEY, raw);
      expect(readSavedPositions().size).toBe(0);
    }
    localStorage.setItem(
      GRAPH_LAYOUT_KEY,
      JSON.stringify({ version: 1, positions: { a: [1, 2], b: [1], c: ["x", 2], d: [Number.NaN, 1] } }),
    );
    expect([...readSavedPositions()]).toEqual([["a", [1, 2]]]);
  });

  it("merges, rounds and survives a full or broken storage", () => {
    const merged = savePositions([{ key: "b" }], new Float32Array([1.234, 5.678]), new Map([["a", [0, 0]]]));
    expect([...merged]).toEqual([
      ["a", [0, 0]],
      ["b", [1.2, 5.7]],
    ]);
    expect(readSavedPositions().get("b")).toEqual([1.2, 5.7]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(savePositions([{ key: "x" }], new Float32Array([1, 1]), new Map()).get("x")).toEqual([1, 1]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSavedPositions().size).toBe(0);
  });

  it("warms the start from known positions", () => {
    expect(initialPositions([{ key: "a" }], new Map())).toBeNull();
    const start = initialPositions([{ key: "a" }, { key: "b" }], new Map([["b", [3, 4] as const]]));
    expect(Number.isNaN(start?.[0])).toBe(true);
    expect([start?.[2], start?.[3]]).toEqual([3, 4]);
    expect([...edgeArray([{ source: 1, target: 2 }])]).toEqual([1, 2]);
  });
});

function chain(count: number): Uint32Array {
  const edges: number[] = [];
  for (let index = 1; index < count; index++) edges.push(index - 1, index);
  return new Uint32Array(edges);
}

describe("createLayoutEngine", () => {
  function harness(now: () => number = () => 0) {
    const updates: LayoutUpdate[] = [];
    const queue: (() => void)[] = [];
    const timer = {
      set: vi.fn((callback: () => void) => {
        queue.push(callback);
        return queue.length;
      }),
      clear: vi.fn(),
    };
    const engine = createLayoutEngine((update) => updates.push(update), timer, now);
    const flush = (limit = 100) => {
      let runs = 0;
      while (queue.length > 0 && runs < limit) {
        queue.shift()?.();
        runs += 1;
      }
      return runs;
    };
    return { engine, updates, timer, flush, queue };
  }

  function gap(positions: Float32Array | undefined, a: number, b: number): number {
    if (!positions) return Number.NaN;
    return Math.hypot(positions[a * 2] - positions[b * 2], positions[a * 2 + 1] - positions[b * 2 + 1]);
  }

  it("animates in slices until a linked chain settles apart", () => {
    let clock = 0;
    const { engine, updates, flush } = harness(() => {
      clock += 5;
      return clock;
    });
    engine.handle({ type: "start", generation: 1, count: 5, edges: chain(5), positions: null, animate: true });
    expect(updates[0]).toMatchObject({ generation: 1, settled: false });
    expect(updates[0].positions).toHaveLength(10);
    expect(flush(1000)).toBeGreaterThan(5);
    const last = updates.at(-1);
    expect(last?.settled).toBe(true);
    for (let index = 1; index < 5; index++) {
      expect(gap(last?.positions, index, index - 1)).toBeGreaterThan(10);
      expect(gap(last?.positions, index, index - 1)).toBeLessThan(200);
    }
  });

  it("starts from known positions and places new nodes beside their linked neighbours", () => {
    const { engine, updates } = harness();
    const start = new Float32Array([100, 100, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
    engine.handle({ type: "start", generation: 7, count: 3, edges: new Uint32Array([0, 1, 9, 0, 2, 2]), positions: start, animate: true });
    const first = updates[0].positions;
    expect([first[0], first[1]]).toEqual([100, 100]);
    expect(Math.hypot(first[2] - 100, first[3] - 100)).toBeLessThan(46);
    expect([...first].every(Number.isFinite)).toBe(true);
  });

  it("pushes apart nodes that start on the same spot", () => {
    const { engine, updates, flush } = harness();
    engine.handle({ type: "start", generation: 8, count: 20, edges: new Uint32Array(0), positions: new Float32Array(40).fill(7), animate: false });
    flush();
    expect(gap(updates.at(-1)?.positions, 0, 1)).toBeGreaterThan(0);
  });

  it("settles in one step for reduced motion and only moves pins", () => {
    const { engine, updates, flush } = harness();
    engine.handle({ type: "start", generation: 2, count: 4, edges: chain(4), positions: null, animate: false });
    expect(flush()).toBe(1);
    expect(updates.at(-1)?.settled).toBe(true);
    const before = updates.length;
    engine.handle({ type: "pin", generation: 2, index: 0, x: 9, y: 8 });
    expect(updates).toHaveLength(before + 1);
    expect([updates.at(-1)?.positions[0], updates.at(-1)?.positions[1]]).toEqual([9, 8]);
    engine.handle({ type: "drag", generation: 2, active: true });
    engine.handle({ type: "unpin", generation: 2, index: 0 });
    expect(flush()).toBe(0);
  });

  it("ignores a pin or unpin whose index is not a node", () => {
    const { engine, updates, flush } = harness();
    engine.handle({ type: "start", generation: 4, count: 3, edges: chain(3), positions: null, animate: false });
    flush();
    const before = updates.length;
    for (const index of ["__proto__", "constructor", -1, 1.5, 3] as unknown as number[]) {
      engine.handle({ type: "pin", generation: 4, index, x: 5, y: 5 });
      engine.handle({ type: "unpin", generation: 4, index });
    }
    expect(updates).toHaveLength(before);
    expect(Object.hasOwn(Array.prototype, "fx")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "fx")).toBe(false);
  });

  it("reheats while dragging and ignores stale generations", () => {
    let clock = 0;
    const { engine, updates, flush, timer } = harness(() => {
      clock += 1;
      return clock;
    });
    engine.handle({ type: "start", generation: 3, count: 2, edges: chain(2), positions: null, animate: true });
    flush(1000);
    const settled = updates.length;
    engine.handle({ type: "pin", generation: 1, index: 0, x: 0, y: 0 });
    expect(updates).toHaveLength(settled);
    engine.handle({ type: "drag", generation: 3, active: true });
    engine.handle({ type: "pin", generation: 3, index: 0, x: 40, y: 40 });
    flush(3);
    expect(updates.at(-1)?.settled).toBe(false);
    engine.handle({ type: "drag", generation: 3, active: false });
    engine.handle({ type: "unpin", generation: 3, index: null });
    flush(1000);
    expect(updates.at(-1)?.settled).toBe(true);
    engine.handle({ type: "start", generation: 4, count: 2, edges: chain(2), positions: null, animate: true });
    engine.handle({ type: "stop" });
    expect(timer.clear).toHaveBeenCalled();
    engine.handle({ type: "stop" });
    engine.handle({ type: "drag", generation: 4, active: true });
  });

  it("reports an empty graph as settled at once", () => {
    const { engine, updates, flush } = harness();
    engine.handle({ type: "start", generation: 5, count: 0, edges: new Uint32Array(0), positions: null, animate: true });
    expect(updates).toEqual([{ type: "positions", generation: 5, positions: new Float32Array(0), settled: true }]);
    expect(flush()).toBe(0);
  });

  it("gives up after the tick budget", () => {
    const { engine, updates, flush } = harness();
    engine.handle({ type: "start", generation: 6, count: 2, edges: chain(2), positions: null, animate: false });
    engine.handle({ type: "drag", generation: 6, active: true });
    flush();
    expect(updates.at(-1)?.settled).toBe(true);
  });
});

describe("edge cases", () => {
  it("shares one project node and skips records without a note id", () => {
    const shared = buildGraph(
      {
        notes: [
          { id: "a", title: "A", color: "#000" },
          { id: "b", title: "B", color: "#000" },
        ],
        records: [record("a", null, [["project", "p1"]]), record("b", "nb", [["project", "p1"]])],
        projects: [{ id: "p1", name: "Paper" }],
      },
      { projects: true, projectColor: "#999" },
    );
    expect(shared.nodes.filter((node) => node.kind === "project")).toHaveLength(1);
    expect(shared.nodes[2].degree).toBe(2);
  });

  it("survives storage that cannot even be reached", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    expect(readSavedPositions().size).toBe(0);
    expect(savePositions([{ key: "a" }], new Float32Array([1, 2]), new Map()).size).toBe(1);
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
  });

  it("does nothing when a cleared timer still fires", () => {
    const queue: (() => void)[] = [];
    const updates: LayoutUpdate[] = [];
    const engine = createLayoutEngine((update) => updates.push(update), {
      set: (callback) => queue.push(callback),
      clear: () => {},
    });
    engine.handle({ type: "start", generation: 1, count: 2, edges: chain(2), positions: null, animate: true });
    engine.handle({ type: "stop" });
    queue.shift()?.();
    expect(updates).toHaveLength(1);
  });
});
