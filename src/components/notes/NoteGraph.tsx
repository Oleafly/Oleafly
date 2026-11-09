import { Maximize, Minus, Plus, RotateCcw, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { compareText } from "@/lib/intl";
import { readJson, writeJson } from "@/lib/local-storage";
import { logError } from "@/lib/log";
import { hexLuminance } from "@/lib/peer-colors";
import { useReducedMotion } from "@/lib/reduced-motion";
import type { NoteLinkRecord, NoteTagCount } from "@/lib/tauri";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { useSettingsStore } from "@/store/settings";
import {
  buildGraph,
  createLayoutEngine,
  edgeArray,
  filterGraph,
  fitView,
  FRAME_MS,
  graphSignature,
  hitTest,
  initialPositions,
  localGraph,
  matchesQuery,
  noteKey,
  nodeRadius,
  readSavedPositions,
  savePositions,
  toWorld,
  zoomAt,
  type GraphData,
  type LayoutRequest,
  type LayoutUpdate,
  type View,
} from "./note-graph-layout";
import { LINE_ICON_PREFIX, LINE_ICONS, NOTE_COLOR_HEX } from "./note-icons";
import { useNotesData } from "./notes-data";
import { useVaultKey, vaultLoad } from "./vault-loads";

export type GraphMode = "global" | "local";

export interface NoteGraphProps {
  mode: GraphMode;
  centerId?: string | null;
  activeId?: string | null;
  onOpenNote: (projectId: string, options: { newTab: boolean }) => void;
  onOpenProject?: (projectId: string) => void;
}

export interface LayoutRunner {
  send(request: LayoutRequest): void;
  dispose(): void;
}

export interface Palette {
  foreground: string;
  muted: string;
  background: string;
  primary: string;
  font: string;
  labelSize?: number;
}

export interface GraphFrame {
  width: number;
  height: number;
  dpr: number;
  view: View;
  graph: GraphData;
  positions: Float32Array | null;
  palette: Palette;
  hover: number;
  focus: number;
  active: number;
  neighbours: readonly (readonly number[])[];
  matches: ReadonlySet<number> | null;
}

interface GraphPrefs {
  orphans: boolean;
  projects: boolean;
  depth: 1 | 2;
}

type IconNode = readonly (readonly [string, Readonly<Record<string, string>>])[];

const PREFS_KEY = "oleafly.notes.graph.prefs";
const ALL_TAGS = "__all__";
const ICON_MIN_PX = 9;
const LABEL_ZOOM = 1.15;
const LABEL_LIMIT = 400;
const DRAG_THRESHOLD_PX = 4;
const KEY_ZOOM = 1.25;
const LABEL_PX = 12;
const BASE_FONT_PX = 16;
const FALLBACK_PALETTE: Palette = {
  foreground: "#1f2328",
  muted: "#8a8f98",
  background: "#ffffff",
  primary: "#1982c4",
  font: "system-ui, sans-serif",
};
const DEFAULT_PREFS: GraphPrefs = { orphans: true, projects: true, depth: 1 };
const iconCache = new Map<string, Path2D[] | null>();

function readPrefs(): GraphPrefs {
  const parsed = readJson<Partial<GraphPrefs> | null>(PREFS_KEY, null);
  return {
    orphans: typeof parsed?.orphans === "boolean" ? parsed.orphans : DEFAULT_PREFS.orphans,
    projects: typeof parsed?.projects === "boolean" ? parsed.projects : DEFAULT_PREFS.projects,
    depth: parsed?.depth === 2 ? 2 : 1,
  };
}

function savePrefs(prefs: GraphPrefs): void {
  writeJson(PREFS_KEY, prefs);
}

interface VaultRead<T> {
  value: T;
  failed: boolean;
}

function useVaultRead<T>(load: (() => Promise<T>) | undefined, empty: T, what: string): VaultRead<T> {
  const vault = useVaultKey();
  const [read, setRead] = useState<VaultRead<T>>({ value: empty, failed: false });
  useEffect(() => {
    if (!load) return;
    let live = true;
    vaultLoad(load, vault).then(
      (value) => {
        if (live) setRead({ value, failed: false });
      },
      (error: unknown) => {
        void logError(what, error);
        if (live) setRead((current) => ({ value: current.value, failed: true }));
      },
    );
    return () => {
      live = false;
    };
  }, [load, vault, what]);
  return read;
}

const NO_TAGS: readonly NoteTagCount[] = [];


function defaultWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./note-graph.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

export function createLayoutRunner(
  onUpdate: (update: LayoutUpdate) => void,
  makeWorker: () => Worker | null = defaultWorker,
): LayoutRunner {
  const worker = makeWorker();
  if (worker) {
    worker.onmessage = (event: MessageEvent<LayoutUpdate>) => onUpdate(event.data);
    worker.onerror = (event: ErrorEvent) => void logError("lay out the note graph", event.message);
    return {
      send: (request) => worker.postMessage(request),
      dispose: () => worker.terminate(),
    };
  }
  const engine = createLayoutEngine(onUpdate, {
    set: (callback) => window.setTimeout(callback, FRAME_MS),
    clear: (handle) => window.clearTimeout(handle as number),
  });
  return {
    send: (request) => engine.handle(request),
    dispose: () => engine.handle({ type: "stop" }),
  };
}

export function readPalette(element: HTMLElement): Palette {
  const probe = document.createElement("span");
  probe.style.display = "none";
  element.appendChild(probe);
  const resolve = (token: string, fallback: string) => {
    probe.style.color = `var(${token})`;
    const value = getComputedStyle(probe).color;
    return value && value !== "" ? value : fallback;
  };
  const palette: Palette = {
    foreground: resolve("--foreground", FALLBACK_PALETTE.foreground),
    muted: resolve("--muted-foreground", FALLBACK_PALETTE.muted),
    background: resolve("--background", FALLBACK_PALETTE.background),
    primary: resolve("--primary", FALLBACK_PALETTE.primary),
    font: getComputedStyle(element).fontFamily || FALLBACK_PALETTE.font,
  };
  probe.remove();
  return palette;
}

export function inkFor(hex: string): string {
  const luminance = hexLuminance(hex);
  if (luminance === null) return FALLBACK_PALETTE.foreground;
  return luminance > 0.4 ? "#1f2328" : "#ffffff";
}

export function iconNodeOf(component: unknown): IconNode | null {
  const render = (component as { render?: (props: object, ref: null) => unknown } | null)?.render;
  if (typeof render !== "function") return null;
  const element = render({}, null) as { props?: { iconNode?: IconNode } } | null;
  const node = element?.props?.iconNode;
  return Array.isArray(node) ? node : null;
}

export function shapePath(name: string, attrs: Readonly<Record<string, string>>): Path2D | null {
  const number = (key: string) => Number.parseFloat(attrs[key] ?? "0");
  if (name === "path") return attrs.d ? new Path2D(attrs.d) : null;
  const path = new Path2D();
  if (name === "circle") path.arc(number("cx"), number("cy"), number("r"), 0, Math.PI * 2);
  else if (name === "ellipse") path.ellipse(number("cx"), number("cy"), number("rx"), number("ry"), 0, 0, Math.PI * 2);
  else if (name === "rect") path.rect(number("x"), number("y"), number("width"), number("height"));
  else if (name === "line") {
    path.moveTo(number("x1"), number("y1"));
    path.lineTo(number("x2"), number("y2"));
  } else if (name === "polyline" || name === "polygon") {
    const points = (attrs.points ?? "").trim().split(/[\s,]+/u).map(Number);
    for (let index = 0; index + 1 < points.length; index += 2) {
      if (index === 0) path.moveTo(points[0], points[1]);
      else path.lineTo(points[index], points[index + 1]);
    }
    if (name === "polygon") path.closePath();
  } else return null;
  return path;
}

export function lineIconPaths(icon: string | undefined): Path2D[] | null {
  if (!icon?.startsWith(LINE_ICON_PREFIX) || typeof Path2D === "undefined") return null;
  const cached = iconCache.get(icon);
  if (cached !== undefined) return cached;
  const id = icon.slice(LINE_ICON_PREFIX.length);
  const entry = Object.hasOwn(LINE_ICONS, id) ? LINE_ICONS[id] : null;
  const node = entry ? iconNodeOf(entry.icon) : null;
  const paths = node ? node.flatMap(([name, attrs]) => shapePath(name, attrs) ?? []) : null;
  const result = paths && paths.length > 0 ? paths : null;
  iconCache.set(icon, result);
  return result;
}

function initialOf(title: string): string {
  const first = Array.from(title.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

function drawGlyph(ctx: CanvasRenderingContext2D, node: GraphData["nodes"][number], x: number, y: number, r: number, font: string) {
  const ink = node.kind === "project" ? "#ffffff" : inkFor(node.color);
  const paths = lineIconPaths(node.icon);
  if (paths) {
    const size = r * 1.15;
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of paths) ctx.stroke(path);
    ctx.restore();
    return;
  }
  const emoji = node.icon && !node.icon.startsWith(LINE_ICON_PREFIX) ? node.icon : null;
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${emoji ? r * 1.1 : r * 1.05}px ${font}`;
  ctx.fillText(emoji ?? initialOf(node.title), x, y + (emoji ? 0 : r * 0.05));
}

function traceNode(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number) {
  if (kind === "project") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function drawGraph(ctx: CanvasRenderingContext2D, frame: GraphFrame): void {
  const { width, height, dpr, view, graph, positions, palette, hover, focus, active, neighbours, matches } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!positions || graph.nodes.length === 0) return;
  const count = Math.min(graph.nodes.length, positions.length / 2);
  const [left, top] = toWorld(view, -40, -40);
  const [right, bottom] = toWorld(view, width + 40, height + 40);
  const visible = (index: number) => {
    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    return x >= left && x <= right && y >= top && y <= bottom;
  };
  const lit = hover >= 0 ? new Set<number>([hover, ...(neighbours[hover] ?? [])]) : null;
  const dimmed = (index: number) => (lit !== null && !lit.has(index)) || (matches !== null && !matches.has(index));

  ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
  ctx.lineWidth = 1 / view.k;
  ctx.strokeStyle = palette.muted;
  ctx.globalAlpha = lit || matches ? 0.14 : 0.4;
  ctx.beginPath();
  for (const edge of graph.edges) {
    if (edge.source >= count || edge.target >= count) continue;
    if (!visible(edge.source) && !visible(edge.target)) continue;
    ctx.moveTo(positions[edge.source * 2], positions[edge.source * 2 + 1]);
    ctx.lineTo(positions[edge.target * 2], positions[edge.target * 2 + 1]);
  }
  ctx.stroke();
  if (lit) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 1.6 / view.k;
    ctx.beginPath();
    for (const edge of graph.edges) {
      if (edge.source !== hover && edge.target !== hover) continue;
      if (edge.source >= count || edge.target >= count) continue;
      ctx.moveTo(positions[edge.source * 2], positions[edge.source * 2 + 1]);
      ctx.lineTo(positions[edge.target * 2], positions[edge.target * 2 + 1]);
    }
    ctx.stroke();
  }

  const groups = new Map<string, number[]>();
  const shown: number[] = [];
  for (let index = 0; index < count; index++) {
    if (!visible(index)) continue;
    shown.push(index);
    const node = graph.nodes[index];
    const key = `${dimmed(index) ? "d" : "n"}|${node.kind}|${node.kind === "project" ? palette.muted : node.color}`;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  }
  for (const [key, members] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [state, kind, color] = key.split("|");
    ctx.globalAlpha = state === "d" ? 0.2 : kind === "project" ? 0.65 : 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const index of members) {
      traceNode(ctx, kind, positions[index * 2], positions[index * 2 + 1], nodeRadius(graph.nodes[index]));
    }
    ctx.fill();
    ctx.strokeStyle = palette.foreground;
    ctx.globalAlpha = state === "d" ? 0.08 : 0.25;
    ctx.lineWidth = 1 / view.k;
    ctx.stroke();
  }
  for (const [index, width] of [
    [active, 2.5],
    [focus, 3],
  ] as const) {
    if (index < 0 || index >= count) continue;
    const node = graph.nodes[index];
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = width / view.k;
    ctx.beginPath();
    traceNode(ctx, node.kind, positions[index * 2], positions[index * 2 + 1], nodeRadius(node) + width / view.k);
    ctx.stroke();
  }

  for (const index of shown) {
    const node = graph.nodes[index];
    const r = nodeRadius(node);
    if (r * view.k < ICON_MIN_PX) continue;
    ctx.globalAlpha = dimmed(index) ? 0.3 : 1;
    drawGlyph(ctx, node, positions[index * 2], positions[index * 2 + 1], r, palette.font);
  }

  const labelled = new Set<number>();
  if (lit) for (const index of lit) labelled.add(index);
  if (focus >= 0) labelled.add(focus);
  if (active >= 0) labelled.add(active);
  if (view.k >= LABEL_ZOOM) {
    const ranked = shown.filter((index) => !dimmed(index)).sort((a, b) => graph.nodes[b].degree - graph.nodes[a].degree);
    for (const index of ranked.slice(0, LABEL_LIMIT)) labelled.add(index);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${palette.labelSize ?? LABEL_PX}px ${palette.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  for (const index of labelled) {
    if (index < 0 || index >= count) continue;
    const node = graph.nodes[index];
    const x = positions[index * 2] * view.k + view.x;
    const y = positions[index * 2 + 1] * view.k + view.y + nodeRadius(node) * view.k + 4;
    const title = node.title.length > 48 ? `${node.title.slice(0, 47)}…` : node.title;
    ctx.globalAlpha = dimmed(index) && !(lit?.has(index) ?? false) ? 0.35 : 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.background;
    ctx.strokeText(title, x, y);
    ctx.fillStyle = palette.foreground;
    ctx.fillText(title, x, y);
  }
  ctx.globalAlpha = 1;
}

function ControlSwitch({ id, label, checked, onChange }: Readonly<{ id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }>) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted-foreground">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

function IconButton({ label, onClick, children }: Readonly<{ label: string; onClick: () => void; children: ReactNode }>) {
  return (
    <Tooltip label={label} side="bottom">
      <Button variant="ghost" size="icon" aria-label={label} className="size-7" onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function NoteGraph({ mode, centerId = null, activeId = null, onOpenNote, onOpenProject }: Readonly<NoteGraphProps>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const linkRead = useVaultRead<readonly NoteLinkRecord[] | null>(data.noteLinks, null, "read note links for the graph");
  const tagRead = useVaultRead(data.noteTags, NO_TAGS, "read note tags for the graph");
  const records = linkRead.value;
  const tags = tagRead.value;
  const theme = useAppTheme();
  const reduced = useReducedMotion();
  const appFontSize = useSettingsStore((state) => state.appFontSize);
  const baseId = useId();
  const [prefs, setPrefs] = useState(readPrefs);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<LayoutRunner | null>(null);
  const generationRef = useRef(0);
  const positionsRef = useRef<Float32Array | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const movedRef = useRef(false);
  const hoverRef = useRef(-1);
  const focusRef = useRef(-1);
  const paletteRef = useRef<Palette>(FALLBACK_PALETTE);
  const frameRef = useRef(0);
  const savedRef = useRef<Map<string, [number, number]>>(mode === "global" ? readSavedPositions() : new Map());
  const knownRef = useRef<Map<string, [number, number]>>(new Map());
  const gestureRef = useRef<
    | { kind: "pan"; x: number; y: number; viewX: number; viewY: number }
    | { kind: "node"; index: number; x: number; y: number; moved: boolean }
    | { kind: "pinch"; distance: number; k: number }
    | null
  >(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());

  const updatePrefs = (next: Partial<GraphPrefs>) =>
    setPrefs((current) => {
      const merged = { ...current, ...next };
      savePrefs(merged);
      return merged;
    });

  const tagsByNote = useMemo(() => {
    const byNote = new Map<string, string[]>();
    for (const entry of tags) {
      for (const noteId of entry.notes) {
        const list = byNote.get(noteId) ?? [];
        list.push(entry.tag.toLowerCase());
        byNote.set(noteId, list);
      }
    }
    return byNote;
  }, [tags]);

  const full = useMemo(
    () =>
      buildGraph(
        {
          notes: data.notes.map((note) => ({
            id: note.id,
            title: note.title,
            icon: note.icon,
            color: NOTE_COLOR_HEX[note.color ?? "blue"] ?? NOTE_COLOR_HEX.blue,
            tags: tagsByNote.get(note.id),
          })),
          records,
          projects: data.projects ?? [],
        },
        { projects: prefs.projects, projectColor: paletteRef.current.muted },
      ),
    [data.notes, data.projects, prefs.projects, records, tagsByNote],
  );

  const graph = useMemo(() => {
    if (mode === "local") return centerId ? localGraph(full, noteKey(centerId), prefs.depth) : { nodes: [], edges: [] };
    return filterGraph(full, { tag, orphans: prefs.orphans });
  }, [centerId, full, mode, prefs.depth, prefs.orphans, tag]);
  const graphRef = useRef(graph);
  const signature = useMemo(() => graphSignature(graph), [graph]);

  const neighbours = useMemo(() => {
    const lists: number[][] = graph.nodes.map(() => []);
    for (const edge of graph.edges) {
      lists[edge.source].push(edge.target);
      lists[edge.target].push(edge.source);
    }
    return lists;
  }, [graph]);

  const matches = useMemo(() => {
    if (query.trim() === "") return null;
    const found = new Set<number>();
    graph.nodes.forEach((node, index) => {
      if (matchesQuery(node, query)) found.add(index);
    });
    return found;
  }, [graph, query]);

  const order = useMemo(
    () => graph.nodes.map((_, index) => index).sort((a, b) => compareText(graph.nodes[a].title, graph.nodes[b].title)),
    [graph],
  );

  const activeIndex = useMemo(
    () => (activeId ? graph.nodes.findIndex((node) => node.key === noteKey(activeId)) : -1),
    [activeId, graph],
  );

  const frameState = useRef({ neighbours, matches, activeIndex });
  const startedRef = useRef<{ signature: string; reduced: boolean } | null>(null);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height, dpr } = sizeRef.current;
    if (width === 0 || height === 0) return;
    drawGraph(ctx, {
      width,
      height,
      dpr,
      view: viewRef.current,
      graph: graphRef.current,
      positions: positionsRef.current,
      palette: paletteRef.current,
      hover: hoverRef.current,
      focus: focusRef.current,
      active: frameState.current.activeIndex,
      neighbours: frameState.current.neighbours,
      matches: frameState.current.matches,
    });
  }, []);

  const requestDraw = useCallback(() => {
    if (frameRef.current !== 0) return;
    frameRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  const fitToView = useCallback(() => {
    const { width, height } = sizeRef.current;
    viewRef.current = fitView(positionsRef.current, graphRef.current.nodes, width, height);
    requestDraw();
  }, [requestDraw]);

  const onUpdate = useCallback(
    (update: LayoutUpdate) => {
      if (update.generation !== generationRef.current) return;
      positionsRef.current = update.positions;
      if (!movedRef.current) {
        const { width, height } = sizeRef.current;
        viewRef.current = fitView(update.positions, graphRef.current.nodes, width, height);
      }
      if (update.settled && mode === "global") {
        savedRef.current = savePositions(graphRef.current.nodes, update.positions, savedRef.current);
      }
      requestDraw();
    },
    [mode, requestDraw],
  );
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const runner = createLayoutRunner((update) => onUpdateRef.current(update));
    runnerRef.current = runner;
    return () => {
      runner.dispose();
      runnerRef.current = null;
      if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const previous = graphRef.current;
    graphRef.current = graph;
    const last = startedRef.current;
    if (last && last.signature === signature && last.reduced === reduced) {
      requestDraw();
      return;
    }
    startedRef.current = { signature, reduced };
    const positions = positionsRef.current;
    if (positions) {
      const count = Math.min(previous.nodes.length, positions.length / 2);
      for (let index = 0; index < count; index++) {
        knownRef.current.set(previous.nodes[index].key, [positions[index * 2], positions[index * 2 + 1]]);
      }
    }
    const known = new Map([...savedRef.current, ...knownRef.current]);
    const start = initialPositions(graph.nodes, known);
    generationRef.current += 1;
    positionsRef.current = null;
    hoverRef.current = -1;
    focusRef.current = -1;
    runnerRef.current?.send({
      type: "start",
      generation: generationRef.current,
      count: graph.nodes.length,
      edges: edgeArray(graph.edges),
      positions: start,
      animate: !reduced,
    });
    requestDraw();
  }, [graph, reduced, requestDraw, signature]);

  useEffect(() => {
    frameState.current = { neighbours, matches, activeIndex };
    requestDraw();
  }, [activeIndex, matches, neighbours, requestDraw]);

  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    canvas.dataset.theme = theme;
    paletteRef.current = { ...readPalette(canvas), labelSize: (LABEL_PX * appFontSize) / BASE_FONT_PX };
    requestDraw();
  }, [appFontSize, requestDraw, theme]);

  useEffect(() => {
    const wrap = wrapRef.current as HTMLDivElement;
    const canvas = canvasRef.current as HTMLCanvasElement;
    if (typeof ResizeObserver === "undefined") return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (!movedRef.current) viewRef.current = fitView(positionsRef.current, graphRef.current.nodes, rect.width, rect.height);
      requestDraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    let density: MediaQueryList | null = null;
    function watchDensity() {
      density?.removeEventListener?.("change", densityChanged);
      density = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
      density?.addEventListener?.("change", densityChanged);
    }
    function densityChanged() {
      resize();
      watchDensity();
    }
    watchDensity();
    return () => {
      observer.disconnect();
      density?.removeEventListener?.("change", densityChanged);
    };
  }, [requestDraw]);

  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number) => {
      const { width, height } = sizeRef.current;
      viewRef.current = zoomAt(viewRef.current, factor, px ?? width / 2, py ?? height / 2);
      movedRef.current = true;
      requestDraw();
    },
    [requestDraw],
  );

  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    let gestureStart = 1;
    const local = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top] as const;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : 1;
      const [px, py] = local(event);
      zoomBy(Math.exp(-event.deltaY * scale * (event.ctrlKey ? 0.01 : 0.0025)), px, py);
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStart = viewRef.current.k;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = (event as unknown as { scale?: number; clientX?: number; clientY?: number }).scale;
      if (typeof scale !== "number" || scale <= 0) return;
      const { width, height } = sizeRef.current;
      zoomBy((gestureStart * scale) / viewRef.current.k, width / 2, height / 2);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart, { passive: false });
    canvas.addEventListener("gesturechange", onGestureChange, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
    };
  }, [zoomBy]);

  const pointAt = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)] as const;
  };

  const open = (index: number, newTab: boolean) => {
    const node = graphRef.current.nodes[index];
    if (node.kind === "note") onOpenNote(node.id, { newTab });
    else onOpenProject?.(node.id);
  };

  const describe = (index: number) => {
    const node = graphRef.current.nodes[index];
    return t(($) => $.notes.graph.focusedNote, { title: node.title, count: node.degree });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const [x, y] = pointAt(event);
    pointersRef.current.set(event.pointerId, { x, y });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      gestureRef.current = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: viewRef.current.k };
      return;
    }
    const hit = hitTest(positionsRef.current, graphRef.current.nodes, viewRef.current, x, y);
    gestureRef.current =
      hit >= 0
        ? { kind: "node", index: hit, x, y, moved: false }
        : { kind: "pan", x, y, viewX: viewRef.current.x, viewY: viewRef.current.y };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const [x, y] = pointAt(event);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x, y });
    const gesture = gestureRef.current;
    if (gesture?.kind === "pinch" && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomBy((gesture.k * distance) / gesture.distance / viewRef.current.k, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (gesture?.kind === "pan") {
      viewRef.current = { ...viewRef.current, x: gesture.viewX + x - gesture.x, y: gesture.viewY + y - gesture.y };
      movedRef.current = true;
      requestDraw();
      return;
    }
    if (gesture?.kind === "node") {
      if (!gesture.moved && Math.hypot(x - gesture.x, y - gesture.y) < DRAG_THRESHOLD_PX) return;
      if (!gesture.moved) {
        gesture.moved = true;
        runnerRef.current?.send({ type: "drag", generation: generationRef.current, active: true });
      }
      const [wx, wy] = toWorld(viewRef.current, x, y);
      const positions = positionsRef.current;
      if (positions && gesture.index * 2 + 1 < positions.length) {
        positions[gesture.index * 2] = wx;
        positions[gesture.index * 2 + 1] = wy;
      }
      runnerRef.current?.send({ type: "pin", generation: generationRef.current, index: gesture.index, x: wx, y: wy });
      requestDraw();
      return;
    }
    const hit = hitTest(positionsRef.current, graphRef.current.nodes, viewRef.current, x, y);
    if (hit !== hoverRef.current) {
      hoverRef.current = hit;
      event.currentTarget.style.cursor = hit >= 0 ? "pointer" : "grab";
      requestDraw();
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.kind !== "node") return;
    if (gesture.moved) {
      runnerRef.current?.send({ type: "drag", generation: generationRef.current, active: false });
      return;
    }
    open(gesture.index, isSelectionModifier(event));
  };

  const onPointerLeave = () => {
    if (gestureRef.current || hoverRef.current < 0) return;
    hoverRef.current = -1;
    requestDraw();
  };

  const moveFocus = (step: 1 | -1) => {
    if (order.length === 0) return;
    const at = order.indexOf(focusRef.current);
    const start = step === 1 ? 0 : order.length - 1;
    const next = order[at < 0 ? start : (at + step + order.length) % order.length];
    focusRef.current = next;
    hoverRef.current = next;
    setAnnouncement(describe(next));
    const positions = positionsRef.current;
    const { width, height } = sizeRef.current;
    if (positions && next * 2 + 1 < positions.length) {
      const sx = positions[next * 2] * viewRef.current.k + viewRef.current.x;
      const sy = positions[next * 2 + 1] * viewRef.current.k + viewRef.current.y;
      if (sx < 24 || sy < 24 || sx > width - 24 || sy > height - 24) {
        viewRef.current = { ...viewRef.current, x: viewRef.current.x + width / 2 - sx, y: viewRef.current.y + height / 2 - sy };
        movedRef.current = true;
      }
    }
    requestDraw();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const mod = isSelectionModifier(event);
    const onCanvas = event.target === canvasRef.current;
    let handled = true;
    if (event.key === "0" && (mod || onCanvas)) {
      movedRef.current = false;
      fitToView();
    } else if ((event.key === "=" || event.key === "+") && (mod || onCanvas)) zoomBy(KEY_ZOOM);
    else if (event.key === "-" && (mod || onCanvas)) zoomBy(1 / KEY_ZOOM);
    else if (onCanvas && (event.key === "ArrowRight" || event.key === "ArrowDown")) moveFocus(1);
    else if (onCanvas && (event.key === "ArrowLeft" || event.key === "ArrowUp")) moveFocus(-1);
    else if (onCanvas && event.key === "Enter" && focusRef.current >= 0) open(focusRef.current, mod);
    else if (onCanvas && event.key === "Escape" && focusRef.current >= 0) {
      focusRef.current = -1;
      hoverRef.current = -1;
      requestDraw();
    } else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const resetLayout = () => {
    savedRef.current = new Map();
    knownRef.current = new Map();
    if (mode === "global") savePositions([], new Float32Array(0), new Map());
    movedRef.current = false;
    generationRef.current += 1;
    positionsRef.current = null;
    runnerRef.current?.send({
      type: "start",
      generation: generationRef.current,
      count: graphRef.current.nodes.length,
      edges: edgeArray(graphRef.current.edges),
      positions: null,
      animate: !reduced,
    });
  };

  const noteCount = graph.nodes.filter((node) => node.kind === "note").length;
  const emptyMessage =
    mode === "local" && !centerId
      ? t(($) => $.notes.graph.noNote)
      : graph.nodes.length === 0
        ? full.nodes.length === 0
          ? t(($) => $.notes.graph.empty)
          : t(($) => $.notes.graph.emptyFiltered)
        : null;
  const helpId = `${baseId}-help`;
  const sortedTags = [...tags].sort((a, b) => b.count - a.count || compareText(a.tag, b.tag));

  return (
    <section
      aria-label={mode === "local" ? t(($) => $.notes.graph.localTitle) : t(($) => $.notes.graph.title)}
      className="flex h-full min-h-0 flex-col"
      onKeyDown={onKeyDown}
      data-note-graph={mode}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1.5">
        <div className="relative min-w-[8rem] max-w-56 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label={t(($) => $.notes.graph.search)}
            placeholder={t(($) => $.notes.graph.search)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 pl-8 text-xs focus-visible:bg-accent/40"
          />
        </div>
        {mode === "global" && sortedTags.length > 0 && (
          <Select value={tag ?? ALL_TAGS} onValueChange={(value) => setTag(value === ALL_TAGS ? null : value)}>
            <SelectTrigger aria-label={t(($) => $.notes.graph.tag)} className="h-7 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TAGS}>{t(($) => $.notes.graph.allTags)}</SelectItem>
              {sortedTags.map((entry) => (
                <SelectItem key={entry.tag} value={entry.tag}>
                  #{entry.label || entry.tag} ({entry.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {mode === "global" && (
          <ControlSwitch
            id={`${baseId}-orphans`}
            label={t(($) => $.notes.graph.orphans)}
            checked={prefs.orphans}
            onChange={(orphans) => updatePrefs({ orphans })}
          />
        )}
        <ControlSwitch
          id={`${baseId}-projects`}
          label={t(($) => $.notes.graph.projects)}
          checked={prefs.projects}
          onChange={(projects) => updatePrefs({ projects })}
        />
        {mode === "local" && (
          <Select value={String(prefs.depth)} onValueChange={(value) => updatePrefs({ depth: value === "2" ? 2 : 1 })}>
            <SelectTrigger aria-label={t(($) => $.notes.graph.depth)} className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t(($) => $.notes.graph.depthLevel, { count: 1 })}</SelectItem>
              <SelectItem value="2">{t(($) => $.notes.graph.depthLevel, { count: 2 })}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label={t(($) => $.notes.graph.zoomOut)} onClick={() => zoomBy(1 / KEY_ZOOM)}>
            <Minus aria-hidden className="size-4" />
          </IconButton>
          <IconButton label={t(($) => $.notes.graph.zoomIn)} onClick={() => zoomBy(KEY_ZOOM)}>
            <Plus aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            label={t(($) => $.notes.graph.fit)}
            onClick={() => {
              movedRef.current = false;
              fitToView();
            }}
          >
            <Maximize aria-hidden className="size-4" />
          </IconButton>
          <IconButton label={t(($) => $.notes.graph.reset)} onClick={resetLayout}>
            <RotateCcw aria-hidden className="size-4" />
          </IconButton>
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: the graph is a keyboard widget, and ARIA's application role tells screen readers to pass its arrow keys through */}
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-label={t(($) => $.notes.graph.canvas, { count: noteCount })}
          aria-describedby={helpId}
          className={cn("absolute inset-0 block size-full cursor-grab touch-none select-none focus-visible:bg-accent/20", emptyMessage && "invisible")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onBlur={() => {
            if (focusRef.current < 0) return;
            focusRef.current = -1;
            hoverRef.current = -1;
            requestDraw();
          }}
        />
        {emptyMessage && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        {(linkRead.failed || tagRead.failed) && (
          <p role="status" className="absolute inset-x-0 bottom-2 mx-auto w-fit max-w-[90%] rounded-md border bg-background px-2 py-1 text-center text-xs text-muted-foreground">
            {linkRead.failed ? t(($) => $.notes.graph.linksFailed) : t(($) => $.notes.graph.tagsFailed)}
          </p>
        )}
        <p id={helpId} className="sr-only">
          {t(($) => $.notes.graph.keyboardHelp)}
        </p>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    </section>
  );
}
