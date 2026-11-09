// @vitest-environment jsdom


import { describe, expect, it, vi } from "vitest";
import type { NoteLinkRecord } from "@/lib/tauri";
import {
  adjacency,
  buildGraph,
  clampZoom,
  createLayoutEngine,
  DEFAULT_FORCES,
  edgeArray,
  filterGraph,
  fitView,
  GRAPH_LAYOUT_KEY,
  graphSignature,
  hitTest,
  initialPositions,
  localGraph,
  matchesQuery,
  MAX_TICKS,
  MAX_ZOOM,
  MIN_ZOOM,
  nodeRadius,
  noteKey,
  projectKey,
  readSavedPositions,
  savePositions,
  Simulation,
  toScreen,
  toWorld,
  zoomAt,
  type GraphData,
  type LayoutUpdate,
} from "./note-graph-layout";

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
  function memory(initial?: string) {
    const store = new Map<string, string>(initial === undefined ? [] : [[GRAPH_LAYOUT_KEY, initial]]);
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      store,
    };
  }

  it("reads only well formed entries", () => {
    expect(readSavedPositions(memory()).size).toBe(0);
    expect(readSavedPositions(memory("not json")).size).toBe(0);
    expect(readSavedPositions(memory(JSON.stringify({ version: 2, positions: {} }))).size).toBe(0);
    expect(readSavedPositions(memory(JSON.stringify({ version: 1, positions: null }))).size).toBe(0);
    const saved = readSavedPositions(
      memory(JSON.stringify({ version: 1, positions: { a: [1, 2], b: [1], c: ["x", 2], d: [Number.NaN, 1] } })),
    );
    expect([...saved]).toEqual([["a", [1, 2]]]);
  });

  it("merges, rounds and survives a full or broken storage", () => {
    const storage = memory();
    const merged = savePositions([{ key: "b" }], new Float32Array([1.234, 5.678]), new Map([["a", [0, 0]]]), storage);
    expect([...merged]).toEqual([
      ["a", [0, 0]],
      ["b", [1.2, 5.7]],
    ]);
    expect(readSavedPositions(storage).get("b")).toEqual([1.2, 5.7]);
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(savePositions([{ key: "x" }], new Float32Array([1, 1]), new Map(), failing).get("x")).toEqual([1, 1]);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: vi.fn(),
    };
    expect(readSavedPositions(broken).size).toBe(0);
  });

  it("uses the default storage", () => {
    localStorage.removeItem(GRAPH_LAYOUT_KEY);
    savePositions([{ key: "k" }], new Float32Array([3, 4]), new Map());
    expect(readSavedPositions().get("k")).toEqual([3, 4]);
    localStorage.removeItem(GRAPH_LAYOUT_KEY);
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

function settle(simulation: Simulation): number {
  let ticks = 0;
  while (!simulation.settled() && ticks < 2000) {
    simulation.tick();
    ticks += 1;
  }
  return ticks;
}

describe("Simulation", () => {
  it("settles a linked chain apart and near link length", () => {
    const simulation = new Simulation(5, chain(5), null);
    expect(simulation.alpha).toBe(1);
    const ticks = settle(simulation);
    expect(ticks).toBeLessThan(MAX_TICKS);
    const positions = simulation.positions();
    for (let index = 1; index < 5; index++) {
      const distance = Math.hypot(positions[index * 2] - positions[index * 2 - 2], positions[index * 2 + 1] - positions[index * 2 - 1]);
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(200);
    }
  });

  it("starts warm from known positions and places new nodes next to their neighbours", () => {
    const start = new Float32Array([100, 100, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
    const simulation = new Simulation(3, new Uint32Array([0, 1, 9, 0, 2, 2]), start);
    expect(simulation.alpha).toBe(0.6);
    expect(Math.hypot(simulation.x[1] - 100, simulation.y[1] - 100)).toBeLessThan(DEFAULT_FORCES.linkDistance);
    const warm = new Simulation(2, new Uint32Array([1, 0]), new Float32Array([0, 0, 50, 0]));
    expect(warm.alpha).toBe(0.25);
    expect(new Simulation(0, new Uint32Array(0), null).alpha).toBe(0);
  });

  it("pins, releases and reheats nodes", () => {
    const simulation = new Simulation(2, new Uint32Array([0, 1]), null);
    simulation.pin(0, 500, -500);
    simulation.pin(9, 1, 1);
    settle(simulation);
    expect([simulation.x[0], simulation.y[0]]).toEqual([500, -500]);
    simulation.unpin(0);
    simulation.unpin(7);
    expect(simulation.fixed[0]).toBe(0);
    simulation.pin(1, 1, 1);
    simulation.unpin(null);
    expect(simulation.fixed[1]).toBe(0);
    simulation.reheat(0.5);
    expect(simulation.alpha).toBe(0.5);
    simulation.alphaTarget = 0.3;
    expect(simulation.settled()).toBe(false);
  });

  it("pushes apart nodes that start on the same spot", () => {
    const start = new Float32Array(Array.from({ length: 40 }, () => 7));
    const simulation = new Simulation(20, new Uint32Array(0), start);
    for (let tick = 0; tick < 60; tick++) simulation.tick();
    const positions = simulation.positions();
    const spread = Math.hypot(positions[0] - positions[2], positions[1] - positions[3]);
    expect(spread).toBeGreaterThan(0);
    const one = new Simulation(1, new Uint32Array(0), null);
    one.tick();
    expect(Number.isFinite(one.x[0])).toBe(true);
    const none = new Simulation(0, new Uint32Array(0), null);
    none.tick();
    expect(none.positions()).toHaveLength(0);
  });

  it("keeps two thousand nodes fast enough for a smooth frame", () => {
    const count = 2000;
    const edges: number[] = [];
    for (let index = 1; index < count; index++) edges.push(index, Math.floor(index / 3));
    const simulation = new Simulation(count, new Uint32Array(edges), null);
    simulation.tick();
    const started = performance.now();
    for (let tick = 0; tick < 5; tick++) simulation.tick();
    expect((performance.now() - started) / 5).toBeLessThan(300);
    expect(simulation.positions().every(Number.isFinite)).toBe(true);
  });
});

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

  it("animates in slices until the layout settles", () => {
    let clock = 0;
    const { engine, updates, flush } = harness(() => {
      clock += 5;
      return clock;
    });
    engine.handle({ type: "start", generation: 1, count: 3, edges: chain(3), positions: null, animate: true });
    expect(updates[0]).toMatchObject({ generation: 1, settled: false });
    expect(updates[0].positions).toHaveLength(6);
    expect(flush(1000)).toBeGreaterThan(5);
    expect(updates.at(-1)?.settled).toBe(true);
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

  it("separates linked nodes that start together, places nodes beside known targets and keeps far clusters apart", () => {
    const together = new Simulation(2, new Uint32Array([0, 1]), new Float32Array([5, 5, 5, 5]));
    together.tick();
    expect(Number.isFinite(together.x[0])).toBe(true);
    const beside = new Simulation(2, new Uint32Array([0, 1]), new Float32Array([Number.NaN, Number.NaN, 300, 300]));
    expect(Math.hypot(beside.x[0] - 300, beside.y[0] - 300)).toBeLessThan(DEFAULT_FORCES.linkDistance);
    const far = new Float32Array([0, 0, 1, 0, 9000, 9000, 9001, 9000, 0, 1]);
    const apart = new Simulation(5, new Uint32Array(0), far, { ...DEFAULT_FORCES, gravity: 0 });
    apart.tick();
    expect(apart.x[2]).toBeGreaterThan(8000);
    const pair = new Simulation(2, new Uint32Array(0), new Float32Array([0, 0, 9000, 9000]), { ...DEFAULT_FORCES, gravity: 0 });
    pair.tick();
    expect([pair.x[0], pair.y[0]]).toEqual([0, 0]);
  });

  it("grows the tree for points that sit almost on top of each other", () => {
    const start = new Float32Array([0, 0, 1e-9, 0, 1000, 1000, 2e-9, 0]);
    const simulation = new Simulation(4, new Uint32Array(0), start);
    simulation.tick();
    expect(simulation.positions().every(Number.isFinite)).toBe(true);
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
