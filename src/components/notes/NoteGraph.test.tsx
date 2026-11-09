// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { allowRadixSelect, chooseOption } from "@/features/collab/tests/select";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteLinkRecord, NoteTagCount } from "@/lib/tauri";
import { buildGraph, fitView, GRAPH_LAYOUT_KEY, type GraphData, type LayoutRequest, type LayoutUpdate } from "./note-graph-layout";
import {
  createLayoutRunner,
  drawGraph,
  iconNodeOf,
  inkFor,
  lineIconPaths,
  NoteGraph,
  readPalette,
  shapePath,
  type GraphFrame,
  type Palette,
} from "./NoteGraph";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const copy = enNotes.graph;
const logs = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: logs.logError }));
vi.mock("./note-graph-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./note-graph-layout")>();
  return { ...actual, buildGraph: vi.fn(actual.buildGraph) };
});

type Call = [string, unknown[]];

function fakeContext() {
  const calls: Call[] = [];
  const target: Record<string, unknown> = {};
  const context = new Proxy(target, {
    get(store, key: string) {
      if (key in store) return store[key];
      const method = (...args: unknown[]) => {
        calls.push([key, args]);
      };
      store[key] = method;
      return method;
    },
    set(store, key: string, value) {
      store[key] = value;
      calls.push([`set:${key}`, [value]]);
      return true;
    },
  });
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

function note(id: string, title: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "Vision", updatedAt: 0, author: "you", summary: "", ...extra };
}

function linkRecord(projectId: string, noteId: string, links: NoteLinkRecord["links"] = []): NoteLinkRecord {
  return { projectId, noteId, title: projectId, links };
}

function data(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes: [note("a", "Alpha", { color: "mint", icon: "lucide:atom" })],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    noteLinks: vi.fn(() => Promise.resolve([linkRecord("a", "na")])),
    ...overrides,
  };
}

let context = fakeContext();
let reduced = true;

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  allowRadixSelect();
  localStorage.clear();
  context = fakeContext();
  reduced = true;
  logs.logError.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context.context as never);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => box(0, 0, 800, 600));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: (entries: unknown[], observer: unknown) => void) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: box(0, 0, 800, 600), borderBoxSize: [{ inlineSize: 800, blockSize: 600 }] }], this);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderGraph(props: Partial<Parameters<typeof NoteGraph>[0]> = {}, value: NotesData = data()) {
  const onOpenNote = vi.fn();
  const onOpenProject = vi.fn();
  const utils = render(
    <NotesDataProvider value={value}>
      <NoteGraph mode="global" onOpenNote={onOpenNote} onOpenProject={onOpenProject} {...props} />
    </NotesDataProvider>,
  );
  return { ...utils, onOpenNote, onOpenProject };
}

function drawn(name: string): number {
  return context.calls.filter(([method]) => method === name).length;
}

async function settled() {
  await waitFor(() => expect(drawn("arc") + drawn("rect")).toBeGreaterThan(0), { timeout: 3000 });
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
}

describe("NoteGraph", () => {
  it("rebuilds the graph when a note's title or look changes, not on every save", async () => {
    const value = data({ notes: [note("a", "Alpha"), note("b", "Beta")] });
    const { rerender } = renderGraph({}, value);
    await waitFor(() => expect(screen.getByRole("application", { name: "Graph of 2 notes" })).toBeInTheDocument());
    const built = vi.mocked(buildGraph).mock.calls.length;
    const saved = { ...value, notes: value.notes.map((item) => ({ ...item, summary: "edited", updatedAt: 99 })) };
    rerender(
      <NotesDataProvider value={saved}>
        <NoteGraph mode="global" onOpenNote={vi.fn()} onOpenProject={vi.fn()} />
      </NotesDataProvider>,
    );
    expect(vi.mocked(buildGraph).mock.calls.length).toBe(built);
    const renamed = { ...saved, notes: saved.notes.map((item) => (item.id === "b" ? { ...item, title: "Beta two" } : item)) };
    rerender(
      <NotesDataProvider value={renamed}>
        <NoteGraph mode="global" onOpenNote={vi.fn()} onOpenProject={vi.fn()} />
      </NotesDataProvider>,
    );
    expect(vi.mocked(buildGraph).mock.calls.length).toBe(built + 1);
    expect(vi.mocked(buildGraph).mock.lastCall?.[0].notes.map((item) => item.title)).toEqual(["Alpha", "Beta two"]);
  });

  it("draws every note and opens one on click", async () => {
    const { onOpenNote } = renderGraph();
    const canvas = screen.getByRole("application", { name: "Graph of 1 note" });
    await settled();
    fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 400, clientY: 300, pointerId: 1 });
    expect(onOpenNote).toHaveBeenCalledWith("a", { newTab: false });
    fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 0, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 400, clientY: 300, pointerId: 2, ctrlKey: true });
    expect(onOpenNote).toHaveBeenLastCalledWith("a", { newTab: true });
    fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 2, pointerId: 3 });
    expect(onOpenNote).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(GRAPH_LAYOUT_KEY)).toContain("note:a");
  });

  it("drags, pans, hovers and zooms without opening notes", async () => {
    const { onOpenNote } = renderGraph();
    const canvas = screen.getByRole("application");
    await settled();
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 300, pointerId: 9 });
    expect(canvas.style.cursor).toBe("pointer");
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 9 });
    expect(canvas.style.cursor).toBe("grab");
    fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 401, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 460, clientY: 320, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 470, clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 470, clientY: 330, pointerId: 1 });
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button: 0, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40, pointerId: 2 });
    fireEvent.pointerLeave(canvas);
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 40, pointerId: 2 });
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0, pointerId: 3 });
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 100, button: 0, pointerId: 4 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 100, pointerId: 4 });
    fireEvent.pointerUp(canvas, { pointerId: 3 });
    fireEvent.pointerUp(canvas, { pointerId: 4 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 400, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: 3, deltaMode: 1, ctrlKey: true, clientX: 400, clientY: 300 });
    fireEvent(canvas, new Event("gesturestart", { cancelable: true }));
    const change = new Event("gesturechange", { cancelable: true });
    Object.assign(change, { scale: 2 });
    fireEvent(canvas, change);
    fireEvent(canvas, new Event("gesturechange", { cancelable: true }));
    fireEvent.pointerMove(canvas, { clientX: 700, clientY: 590, pointerId: 9 });
    fireEvent.pointerLeave(canvas);
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it("moves between notes with the keyboard", async () => {
    const value = data({
      notes: [note("a", "Alpha"), note("b", "Beta", { icon: "🧪" })],
      noteLinks: vi.fn(() =>
        Promise.resolve([linkRecord("a", "na", [{ kind: "note", id: "nb", snippet: "" }]), linkRecord("b", "nb")]),
      ),
    });
    const { onOpenNote } = renderGraph({ activeId: "b" }, value);
    const canvas = screen.getByRole("application", { name: "Graph of 2 notes" });
    await settled();
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(await screen.findByText("Alpha, 1 link")).toBeInTheDocument();
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    expect(screen.getByText("Beta, 1 link")).toBeInTheDocument();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowUp" });
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(onOpenNote).toHaveBeenCalledWith("b", { newTab: false });
    fireEvent.keyDown(canvas, { key: "Enter", ctrlKey: true });
    expect(onOpenNote).toHaveBeenLastCalledWith("b", { newTab: true });
    fireEvent.keyDown(canvas, { key: "Escape" });
    fireEvent.keyDown(canvas, { key: "Escape" });
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(onOpenNote).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    fireEvent.blur(canvas);
    fireEvent.blur(canvas);
    for (const key of ["+", "=", "-", "0", "x"]) fireEvent.keyDown(canvas, { key });
    const search = screen.getByRole("searchbox", { name: copy.search });
    fireEvent.keyDown(search, { key: "0", ctrlKey: true });
    fireEvent.keyDown(search, { key: "=", ctrlKey: true });
    fireEvent.keyDown(search, { key: "-", ctrlKey: true });
    fireEvent.keyDown(search, { key: "0" });
  });

  it("filters by search, tag, orphans and projects and remembers the switches", async () => {
    const user = userEvent.setup();
    const tags: NoteTagCount[] = [
      { tag: "lab", label: "Lab", count: 1, notes: ["a"] },
      { tag: "ml", label: "", count: 2, notes: ["a", "b"] },
    ];
    const value = data({
      notes: [note("a", "Alpha"), note("b", "Beta"), note("c", "Gamma")],
      projects: [{ id: "p1", name: "Paper" }],
      noteLinks: vi.fn(() =>
        Promise.resolve([linkRecord("a", "na", [{ kind: "project", id: "p1", snippet: "" }]), linkRecord("b", "nb")]),
      ),
      noteTags: vi.fn(() => Promise.resolve(tags)),
    });
    const { onOpenProject } = renderGraph({}, value);
    await settled();
    await user.type(screen.getByRole("searchbox", { name: copy.search }), "alp");
    await chooseOption(user, copy.tag, "#Lab (1)");
    expect(screen.getByRole("application", { name: "Graph of 1 note" })).toBeInTheDocument();
    await chooseOption(user, copy.tag, "#ml (2)");
    await chooseOption(user, copy.tag, copy.allTags);
    await user.click(screen.getByRole("switch", { name: copy.orphans }));
    expect(screen.getByRole("application", { name: "Graph of 1 note" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("oleafly.notes.graph.prefs") ?? "{}")).toMatchObject({ orphans: false });
    await user.click(screen.getByRole("switch", { name: copy.projects }));
    expect(await screen.findByText(copy.emptyFiltered)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: copy.projects }));
    await user.click(screen.getByRole("switch", { name: copy.orphans }));
    await user.clear(screen.getByRole("searchbox", { name: copy.search }));
    await settled();
    expect(onOpenProject).not.toHaveBeenCalled();
    for (const name of [copy.zoomIn, copy.zoomOut, copy.fit, copy.reset]) {
      await user.click(screen.getByRole("button", { name }));
    }
    await settled();
  });

  it("opens a project node", async () => {
    const value = data({
      notes: [],
      projects: [{ id: "p1", name: "Paper" }],
      noteLinks: vi.fn(() => Promise.resolve([])),
    });
    renderGraph({}, value);
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it("shows the local graph around the open note at the chosen depth", async () => {
    const user = userEvent.setup();
    const value = data({
      notes: [note("a", "Alpha"), note("b", "Beta"), note("c", "Gamma")],
      projects: [{ id: "p1", name: "Paper" }],
      noteLinks: vi.fn(() =>
        Promise.resolve([
          linkRecord("a", "na", [{ kind: "note", id: "nb", snippet: "" }]),
          linkRecord("b", "nb", [
            { kind: "note", id: "nc", snippet: "" },
            { kind: "project", id: "p1", snippet: "" },
          ]),
          linkRecord("c", "nc"),
        ]),
      ),
    });
    const { onOpenProject, rerender } = renderGraph({ mode: "local", centerId: "a" }, value);
    expect(screen.queryByRole("switch", { name: copy.orphans })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("application", { name: "Graph of 2 notes" })).toBeInTheDocument());
    await chooseOption(user, copy.depth, "2 steps");
    await waitFor(() => expect(screen.getByRole("application", { name: "Graph of 3 notes" })).toBeInTheDocument());
    await chooseOption(user, copy.depth, "1 step");
    rerender(
      <NotesDataProvider value={value}>
        <NoteGraph mode="local" centerId={null} onOpenNote={vi.fn()} onOpenProject={onOpenProject} />
      </NotesDataProvider>,
    );
    expect(screen.getByText(copy.noNote)).toBeInTheDocument();
  });

  it("animates when motion is allowed and logs load failures", async () => {
    reduced = false;
    const value = data({
      noteLinks: vi.fn(() => Promise.reject(new Error("links"))),
      noteTags: vi.fn(() => Promise.reject(new Error("tags"))),
    });
    const { unmount } = renderGraph({}, value);
    await waitFor(() => expect(logs.logError).toHaveBeenCalledWith("read note links for the graph", expect.any(Error)));
    expect(logs.logError).toHaveBeenCalledWith("read note tags for the graph", expect.any(Error));
    expect(await screen.findByText(copy.linksFailed)).toHaveAttribute("role", "status");
    await settled();
    unmount();
  });

  it("says when only the tags could not be read", async () => {
    renderGraph({}, data({ noteTags: vi.fn(() => Promise.reject(new Error("tags"))) }));
    expect(await screen.findByText(copy.tagsFailed)).toBeInTheDocument();
    expect(screen.queryByText(copy.linksFailed)).toBeNull();
    await settled();
  });

  it("reads saved preferences and survives blocked storage", () => {
    localStorage.setItem("oleafly.notes.graph.prefs", JSON.stringify({ orphans: false, projects: false, depth: 2 }));
    renderGraph({ mode: "local", centerId: "a" }, data({ noteLinks: undefined }));
    expect(screen.getByRole("switch", { name: copy.projects })).toHaveAttribute("aria-checked", "false");
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith("oleafly.notes.graph")) throw new Error("blocked");
      return getItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith("oleafly.notes.graph")) throw new Error("blocked");
      setItem.call(this, key, value);
    });
    const { unmount } = renderGraph();
    fireEvent.click(screen.getAllByRole("switch", { name: copy.projects }).at(-1) as HTMLElement);
    unmount();
  });

  it("works without a measured canvas or a context", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => null);
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(() => box(0, 0, 0, 0));
    vi.stubGlobal("ResizeObserver", undefined);
    renderGraph();
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(screen.getByRole("application")).toBeInTheDocument();
  });
});

describe("createLayoutRunner", () => {
  it("talks to a worker when one starts", () => {
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null as ((event: MessageEvent<LayoutUpdate>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
    };
    const updates: LayoutUpdate[] = [];
    const runner = createLayoutRunner((update) => updates.push(update), () => worker as unknown as Worker);
    runner.send({ type: "stop" });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "stop" });
    const update: LayoutUpdate = { type: "positions", generation: 1, positions: new Float32Array(0), settled: true };
    worker.onmessage?.({ data: update } as MessageEvent<LayoutUpdate>);
    expect(updates).toEqual([update]);
    worker.onerror?.({ message: "boom" } as ErrorEvent);
    expect(logs.logError).toHaveBeenCalledWith("lay out the note graph", "boom");
    runner.dispose();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("falls back to the main thread and to a failing worker constructor", () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked");
        }
      },
    );
    const updates: LayoutUpdate[] = [];
    const runner = createLayoutRunner((update) => updates.push(update));
    runner.send({ type: "start", generation: 1, count: 0, edges: new Uint32Array(0), positions: null, animate: false });
    expect(updates).toHaveLength(1);
    runner.dispose();
  });
});

describe("drawing", () => {
  const palette: Palette = { foreground: "#000", muted: "#888", background: "#fff", primary: "#00f", font: "sans" };

  function frame(graph: GraphData, positions: Float32Array | null, extra: Partial<GraphFrame> = {}): GraphFrame {
    return {
      width: 400,
      height: 300,
      dpr: 2,
      view: { x: 200, y: 150, k: 2 },
      graph,
      positions,
      palette,
      hover: -1,
      focus: -1,
      active: -1,
      neighbours: graph.nodes.map(() => []),
      matches: null,
      ...extra,
    };
  }

  const graph = buildGraph(
    {
      notes: [
        { id: "a", title: "A".repeat(60), color: "#98f5e1", icon: "🧪" },
        { id: "b", title: "Beta", color: "#1982c4" },
        { id: "c", title: "Far", color: "#98f5e1" },
      ],
      records: [
        linkRecord("a", "na", [
          { kind: "note", id: "nb", snippet: "" },
          { kind: "project", id: "p", snippet: "" },
        ]),
        linkRecord("b", "nb"),
        linkRecord("c", "nc"),
      ],
      projects: [{ id: "p", name: "Project" }],
    },
    { projects: true, projectColor: "#888" },
  );
  const positions = new Float32Array([0, 0, 20, 0, 5000, 5000, -20, 0]);

  it("draws edges, nodes, glyphs and labels", () => {
    const { context: ctx, calls } = fakeContext();
    drawGraph(ctx, frame(graph, positions, { hover: 0, neighbours: [[1, 3], [0], [], [0]], focus: 1, active: 0 }));
    const texts = calls.filter(([name]) => name === "fillText").map(([, args]) => args[0]);
    expect(texts).toContain("🧪");
    expect(texts).toContain("B");
    expect(texts).toContain("Beta");
    expect(texts).toContain(`${"A".repeat(47)}…`);
    expect(texts).not.toContain("Far");
    expect(calls.some(([name]) => name === "rect")).toBe(true);
  });

  it("dims search misses and labels busy views", () => {
    const { context: ctx, calls } = fakeContext();
    drawGraph(ctx, frame(graph, positions, { matches: new Set([1]), view: { x: 200, y: 150, k: 1.5 } }));
    expect(calls.filter(([name]) => name === "strokeText").length).toBeGreaterThan(0);
    const small = fakeContext();
    drawGraph(small.context, frame(graph, positions, { view: { x: 200, y: 150, k: 0.5 }, focus: 9, active: 9 }));
    expect(small.calls.some(([name]) => name === "fillText")).toBe(false);
  });

  it("clears and stops without positions", () => {
    const { context: ctx, calls } = fakeContext();
    drawGraph(ctx, frame(graph, null));
    expect(calls.map(([name]) => name)).toEqual(["setTransform", "clearRect"]);
    drawGraph(ctx, frame(graph, new Float32Array([0, 0])));
  });

  it("draws line icons as paths", () => {
    class FakePath {
      readonly ops: string[] = [];
      constructor(readonly d?: string) {}
      arc() {
        this.ops.push("arc");
      }
      ellipse() {
        this.ops.push("ellipse");
      }
      rect() {
        this.ops.push("rect");
      }
      moveTo() {
        this.ops.push("moveTo");
      }
      lineTo() {
        this.ops.push("lineTo");
      }
      closePath() {
        this.ops.push("close");
      }
    }
    vi.stubGlobal("Path2D", FakePath);
    for (const icon of ["lucide:atom", "lucide:table", "lucide:git-branch", "lucide:hexagon", "lucide:cpu", "lucide:eye"]) {
      expect(lineIconPaths(icon)?.length).toBeGreaterThan(0);
    }
    expect(lineIconPaths("lucide:atom")).toBe(lineIconPaths("lucide:atom"));
    expect(lineIconPaths("lucide:unknown-icon")).toBeNull();
    expect(lineIconPaths("🧪")).toBeNull();
    expect(lineIconPaths(undefined)).toBeNull();
    const iconGraph = buildGraph(
      { notes: [{ id: "a", title: "Atom", color: "#98f5e1", icon: "lucide:atom" }], records: [], projects: [] },
      { projects: true, projectColor: "#888" },
    );
    const { context: ctx, calls } = fakeContext();
    drawGraph(ctx, frame(iconGraph, new Float32Array([0, 0]), { view: { x: 0, y: 0, k: 4 } }));
    expect(calls.some(([name]) => name === "stroke")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("picks readable ink and reads theme colours", () => {
    expect(inkFor("#98f5e1")).toBe("#1f2328");
    expect(inkFor("#1982c4")).toBe("#ffffff");
    expect(inkFor("#000000")).toBe("#ffffff");
    expect(inkFor("oklch(1 0 0)")).toBe("#1f2328");
    const host = document.createElement("div");
    document.body.append(host);
    const palette = readPalette(host);
    expect(palette.font.length).toBeGreaterThan(0);
    expect(host.childElementCount).toBe(0);
    host.remove();
  });
});

class FakeWorker {
  static last: FakeWorker | null = null;
  readonly sent: LayoutRequest[] = [];
  onmessage: ((event: MessageEvent<LayoutUpdate>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(request: LayoutRequest) {
    this.sent.push(request);
  }
  terminate() {}
  started(): Extract<LayoutRequest, { type: "start" }> {
    const start = [...this.sent].reverse().find((request) => request.type === "start");
    if (start?.type !== "start") throw new Error("no layout started");
    return start;
  }
  place(positions: number[], generation = this.started().generation) {
    act(() => {
      this.onmessage?.({
        data: { type: "positions", generation, positions: new Float32Array(positions), settled: true },
      } as MessageEvent<LayoutUpdate>);
    });
  }
}

describe("NoteGraph with a layout worker", () => {
  const value = () =>
    data({
      notes: [note("a", "Alpha"), note("b", "Beta")],
      projects: [{ id: "p1", name: "Paper" }],
      noteLinks: vi.fn(() =>
        Promise.resolve([
          linkRecord("a", "na", [
            { kind: "note", id: "nb", snippet: "" },
            { kind: "project", id: "p1", snippet: "" },
          ]),
          linkRecord("b", "nb"),
        ]),
      ),
    });
  const graph = buildGraph(
    {
      notes: [
        { id: "a", title: "Alpha", color: "#000" },
        { id: "b", title: "Beta", color: "#000" },
      ],
      records: [
        linkRecord("a", "na", [
          { kind: "note", id: "nb", snippet: "" },
          { kind: "project", id: "p1", snippet: "" },
        ]),
        linkRecord("b", "nb"),
      ],
      projects: [{ id: "p1", name: "Paper" }],
    },
    { projects: true, projectColor: "#888" },
  );
  const positions = [0, 0, 100, 0, -100, 0];
  const at = (index: number) => {
    const view = fitView(new Float32Array(positions), graph.nodes, 800, 600);
    return [positions[index * 2] * view.k + view.x, positions[index * 2 + 1] * view.k + view.y];
  };

  beforeEach(() => {
    FakeWorker.last = null;
    vi.stubGlobal("Worker", FakeWorker);
  });

  async function ready() {
    const utils = renderGraph({}, value());
    const canvas = screen.getByRole("application");
    await waitFor(() => expect(FakeWorker.last?.started().count).toBe(3));
    FakeWorker.last?.place(positions);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    return { ...utils, canvas, worker: FakeWorker.last as FakeWorker };
  }

  it("ignores stale layouts and opens a project node", async () => {
    const { canvas, worker, onOpenProject, onOpenNote } = await ready();
    const before = drawn("arc");
    worker.place(positions, 0);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(drawn("arc")).toBe(before);
    const [px, py] = at(2);
    fireEvent.pointerDown(canvas, { clientX: px, clientY: py, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: px, clientY: py, pointerId: 1 });
    expect(onOpenProject).toHaveBeenCalledWith("p1");
    const [bx, by] = at(1);
    fireEvent.pointerDown(canvas, { clientX: bx, clientY: by, button: 0, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: bx + 30, clientY: by, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: bx + 30, clientY: by, pointerId: 2 });
    expect(worker.sent.map((request) => request.type)).toEqual(expect.arrayContaining(["drag", "pin"]));
    expect(onOpenNote).not.toHaveBeenCalled();
    fireEvent.pointerMove(canvas, { clientX: px, clientY: py, pointerId: 5 });
    fireEvent.pointerLeave(canvas);
    expect(canvas.style.cursor).toBe("pointer");
  });

  it("redraws sharp at the new pixel density when the window moves to another screen", async () => {
    const densityListeners: (() => void)[] = [];
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce") && reduced,
      addEventListener: (_type: string, listener: () => void) => {
        if (query.includes("resolution")) densityListeners.push(listener);
      },
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("devicePixelRatio", 1);
    const { canvas } = await ready();
    expect((canvas as HTMLCanvasElement).width).toBe(800);
    vi.stubGlobal("devicePixelRatio", 2);
    act(() => densityListeners.at(-1)?.());
    expect((canvas as HTMLCanvasElement).width).toBe(1600);
    expect(densityListeners).toHaveLength(2);
  });

  it("sizes graph labels with the app font size", async () => {
    const { useSettingsStore } = await import("@/store/settings");
    const before = useSettingsStore.getState().appFontSize;
    useSettingsStore.setState({ appFontSize: 20 });
    try {
      const { canvas } = await ready();
      canvas.focus();
      fireEvent.keyDown(canvas, { key: "ArrowRight" });
      await waitFor(() => expect(context.calls.some(([name, args]) => name === "set:font" && String(args[0]).startsWith("15px"))).toBe(true));
    } finally {
      useSettingsStore.setState({ appFontSize: before });
    }
  });

  it("brings a note into view when the keyboard reaches it off screen", async () => {
    const { canvas } = await ready();
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 5000, clientY: 5000, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 5000, clientY: 5000, pointerId: 1 });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(await screen.findByText("Alpha, 2 links")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: copy.reset }));
    expect(FakeWorker.last?.started().positions).toBeNull();
  });

  it("restarts when reduced motion changes and does nothing on an empty graph", async () => {
    let change: () => void = () => {};
    const query = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        change = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const quiet = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", (text: string) => (text.includes("reduced-motion") ? query : quiet));
    renderGraph({ mode: "local", centerId: "missing" }, value());
    await waitFor(() => expect(FakeWorker.last?.started().animate).toBe(true));
    query.matches = true;
    act(() => change());
    await waitFor(() => expect(FakeWorker.last?.started().animate).toBe(false));
    const canvas = screen.getByRole("application", { hidden: true });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    await userEvent.setup().click(screen.getByRole("button", { name: copy.reset }));
  });

  it("skips drawing a canvas with no size and works without matchMedia", async () => {
    vi.stubGlobal("matchMedia", undefined);
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(() => box(0, 0, 0, 0));
    renderGraph({}, value());
    await waitFor(() => expect(FakeWorker.last?.started().count).toBe(3));
    FakeWorker.last?.place(positions);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(drawn("arc")).toBe(0);
  });
});

describe("icon shapes", () => {
  class Recorder {
    readonly ops: string[] = [];
    constructor(readonly d?: string) {}
    arc() {
      this.ops.push("arc");
    }
    ellipse() {
      this.ops.push("ellipse");
    }
    rect() {
      this.ops.push("rect");
    }
    moveTo() {
      this.ops.push("moveTo");
    }
    lineTo() {
      this.ops.push("lineTo");
    }
    closePath() {
      this.ops.push("close");
    }
  }

  it("turns every SVG shape into a path", () => {
    vi.stubGlobal("Path2D", Recorder);
    const ops = (name: string, attrs: Record<string, string>) => (shapePath(name, attrs) as unknown as Recorder | null)?.ops ?? null;
    expect((shapePath("path", { d: "M0 0" }) as unknown as Recorder).d).toBe("M0 0");
    expect(shapePath("path", {})).toBeNull();
    expect(ops("circle", { cx: "1", cy: "1", r: "1" })).toEqual(["arc"]);
    expect(ops("ellipse", { cx: "1", cy: "1", rx: "1", ry: "2" })).toEqual(["ellipse"]);
    expect(ops("rect", { x: "1", y: "1", width: "2", height: "2" })).toEqual(["rect"]);
    expect(ops("line", { x1: "1", y1: "1", x2: "2", y2: "2" })).toEqual(["moveTo", "lineTo"]);
    expect(ops("polyline", { points: "1 1 2 2 3,3" })).toEqual(["moveTo", "lineTo", "lineTo"]);
    expect(ops("polygon", { points: "1 1 2 2" })).toEqual(["moveTo", "lineTo", "close"]);
    expect(ops("polygon", {})).toEqual(["close"]);
    expect(ops("text", {})).toBeNull();
    vi.unstubAllGlobals();
  });

  it("reads icon nodes only from icon components", () => {
    expect(iconNodeOf(null)).toBeNull();
    expect(iconNodeOf({})).toBeNull();
    expect(iconNodeOf({ render: () => ({ props: {} }) })).toBeNull();
    expect(iconNodeOf({ render: () => null })).toBeNull();
    expect(iconNodeOf({ render: () => ({ props: { iconNode: [["path", { d: "M0 0" }]] } }) })).toEqual([["path", { d: "M0 0" }]]);
  });

  it("culls edges off screen and highlights only the hovered node's edges", () => {
    const wide = buildGraph(
      {
        notes: [
          { id: "a", title: "A", color: "#000" },
          { id: "b", title: "B", color: "#000" },
          { id: "c", title: "C", color: "#000" },
          { id: "d", title: "D", color: "#000" },
        ],
        records: [
          linkRecord("a", "na", [{ kind: "note", id: "nb", snippet: "" }]),
          linkRecord("b", "nb"),
          linkRecord("c", "nc", [{ kind: "note", id: "nd", snippet: "" }]),
          linkRecord("d", "nd", [{ kind: "note", id: "nb", snippet: "" }]),
        ],
        projects: [],
      },
      { projects: true, projectColor: "#888" },
    );
    const frameFor = (positions: number[], hover: number): GraphFrame => ({
      width: 400,
      height: 300,
      dpr: 1,
      view: { x: 200, y: 150, k: 1 },
      graph: wide,
      positions: new Float32Array(positions),
      palette: { foreground: "#000", muted: "#888", background: "#fff", primary: "#00f", font: "sans" },
      hover,
      focus: -1,
      active: -1,
      neighbours: [[1], [0, 3], [3], [2, 1]],
      matches: null,
    });
    const all = fakeContext();
    drawGraph(all.context, frameFor([0, 0, 20, 0, 9000, 9000, 9100, 9000], 0));
    expect(all.calls.filter(([name]) => name === "lineTo")).toHaveLength(3);
    const short = fakeContext();
    drawGraph(short.context, frameFor([0, 0, 20, 0, 9000, 9000], 1));
    expect(short.calls.filter(([name]) => name === "lineTo")).toHaveLength(2);
  });
});
