import type { AtomSpec, AtomStyleSpec, GLViewer } from "3dmol";
import { Atom, type LucideIcon, RotateCcw, RotateCw, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { whenNearViewport } from "@/hooks/use-near-viewport";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  BlockFileTooLargeError,
  blockMessage,
  currentTheme,
  dataUrlText,
  type Dispose,
  type NoteBlockKind,
  type NoteFile,
  OPTION_LINE,
  type PaintContext,
  paintBlockCard,
  splitBlockOptions,
} from "./note-blocks";
import { notePath } from "./note-path";

export const MOLECULE_FORMATS = ["pdb", "sdf", "mol", "xyz", "cif", "mol2"] as const;
export const MOLECULE_STYLES = ["cartoon", "stick", "sphere", "line"] as const;
export const MOLECULE_COLORS = ["spectrum", "chain", "element", "residue", "ss"] as const;
export const MOLECULE_MAX_BYTES = 6 * 1024 * 1024;
export const ROTATE_STEP = 20;
export const ZOOM_STEP = 1.25;

export type MoleculeFormat = (typeof MOLECULE_FORMATS)[number];
export type MoleculeStyle = (typeof MOLECULE_STYLES)[number];
export type MoleculeColor = (typeof MOLECULE_COLORS)[number];
export type MoleculeProblem = "path" | "format" | "style" | "color" | "empty";

export interface MoleculeSpec {
  path: string | null;
  format: MoleculeFormat | null;
  style: MoleculeStyle | null;
  color: MoleculeColor | null;
  data: string;
}

export type MoleculeParse = { ok: true; spec: MoleculeSpec } | { ok: false; problem: MoleculeProblem; value: string };

const OPTIONS: ReadonlySet<string> = new Set(["path", "format", "style", "color", "colour"]);
const FORMAT_NAMES = new Map<string, MoleculeFormat>([
  ["pdb", "pdb"],
  ["ent", "pdb"],
  ["sdf", "sdf"],
  ["sd", "sdf"],
  ["mol", "mol"],
  ["xyz", "xyz"],
  ["cif", "cif"],
  ["mmcif", "cif"],
  ["mcif", "cif"],
  ["mol2", "mol2"],
]);
const SCHEMES: Record<Exclude<MoleculeColor, "spectrum">, string> = {
  chain: "chain",
  element: "default",
  residue: "amino",
  ss: "ssJmol",
};
const WATER = new Set(["HOH", "WAT", "H2O", "DOD", "SOL"]);
const XYZ_ATOM = /^\s*[a-z]{1,3}\s+[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s+[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s+[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/iu;
const COUNTS_LINE = /V[23]000\s*$/u;

function member<T extends string>(values: readonly T[], value: string): T | null {
  const lower = value.trim().toLowerCase();
  return values.find((item) => item === lower) ?? null;
}

export function parseMoleculeSource(source: string): MoleculeParse {
  const { options, body } = splitBlockOptions(source, OPTIONS);
  const formatText = options.get("format");
  const format = formatText === undefined ? null : (FORMAT_NAMES.get(formatText.toLowerCase()) ?? null);
  if (formatText !== undefined && !format) return { ok: false, problem: "format", value: formatText };
  const styleText = options.get("style");
  const style = styleText === undefined ? null : member(MOLECULE_STYLES, styleText);
  if (styleText !== undefined && !style) return { ok: false, problem: "style", value: styleText };
  const colorText = options.get("color") ?? options.get("colour");
  const color = colorText === undefined ? null : member(MOLECULE_COLORS, colorText);
  if (colorText !== undefined && !color) return { ok: false, problem: "color", value: colorText };
  const written = options.get("path");
  const path = written === undefined ? null : notePath(written);
  if (written !== undefined && !path) return { ok: false, problem: "path", value: written };
  if (!path && !body.trim()) return { ok: false, problem: "empty", value: "" };
  return { ok: true, spec: { path, format, style, color, data: path ? "" : body } };
}

export type MoleculeOption = "style" | "color";

const OPTION_NAMES: Readonly<Record<MoleculeOption, readonly string[]>> = {
  style: ["style"],
  color: ["color", "colour"],
};

export function withMoleculeOption(source: string, option: MoleculeOption, value: string): string {
  const lines = source.split(/\r?\n/u);
  let last = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const name = OPTION_LINE.exec(line)?.[1].toLowerCase();
    if (!name || !OPTIONS.has(name)) break;
    if (OPTION_NAMES[option].includes(name)) {
      lines[index] = lines[index].replace(/:.*$/u, `: ${value}`);
      return lines.join("\n");
    }
    last = index;
  }
  lines.splice(last + 1, 0, `${option}: ${value}`);
  return lines.join("\n");
}

function looksLikeXyz(text: string): boolean {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() !== "");
  if (!/^\s*\d+\s*$/u.test(lines[start] ?? "")) return false;
  return XYZ_ATOM.test(lines[start + 2] ?? "");
}

export function sniffMoleculeFormat(text: string): MoleculeFormat | null {
  if (/^@<TRIPOS>MOLECULE/mu.test(text)) return "mol2";
  if (/^data_/mu.test(text) && /^(?:loop_|_atom_site)/mu.test(text)) return "cif";
  if (/^(?:ATOM {2}|HETATM)/mu.test(text)) return "pdb";
  if (/V[23]000/u.test(text) || /^\$\$\$\$/mu.test(text)) return "sdf";
  return looksLikeXyz(text) ? "xyz" : null;
}

export function resolveMoleculeFormat(spec: MoleculeSpec, fence: string | undefined, text: string): MoleculeFormat | null {
  if (spec.format) return spec.format;
  const fromFence = fence ? FORMAT_NAMES.get(fence) : undefined;
  if (fromFence) return fromFence;
  const extension = spec.path ? /\.([a-z0-9]+)$/iu.exec(spec.path)?.[1].toLowerCase() : undefined;
  const fromPath = extension ? FORMAT_NAMES.get(extension) : undefined;
  return fromPath ?? sniffMoleculeFormat(text);
}

export function repairMolHeader(text: string): string {
  const lines = text.split(/\r?\n/u);
  const counts = lines.findIndex((line) => COUNTS_LINE.test(line));
  if (counts < 0 || counts >= 3) return text;
  return [...Array<string>(3 - counts).fill(""), ...lines].join("\n");
}

export function moleculeData(text: string, format: MoleculeFormat): string {
  return format === "sdf" || format === "mol" ? repairMolHeader(text) : text;
}

export class MoleculeFileError extends Error {
  readonly problem: "missing" | "unreadable";

  constructor(problem: "missing" | "unreadable") {
    super(`The molecule file could not be read (${problem}).`);
    this.name = "MoleculeFileError";
    this.problem = problem;
  }
}

export async function moleculeText(spec: MoleculeSpec, readFile: NoteFile | undefined): Promise<string> {
  if (!spec.path) return spec.data;
  const url = readFile ? await readFile(spec.path) : null;
  if (url === null) throw new MoleculeFileError("missing");
  const text = dataUrlText(url, MOLECULE_MAX_BYTES);
  if (text === null) throw new MoleculeFileError("unreadable");
  return text;
}

export type WebglMode = "shared" | "dedicated";

function usable(create: () => RenderingContext | OffscreenRenderingContext | null): boolean {
  try {
    const context = create() as WebGLRenderingContext | null;
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function webglMode(): WebglMode | null {
  if (typeof OffscreenCanvas !== "undefined" && usable(() => new OffscreenCanvas(1, 1).getContext("webgl2"))) {
    return "shared";
  }
  const canvas = () => document.createElement("canvas");
  if (usable(() => canvas().getContext("webgl2") ?? canvas().getContext("webgl"))) return "dedicated";
  return null;
}

let probedWebgl: WebglMode | null = null;

export function cachedWebglMode(): WebglMode | null {
  probedWebgl ??= webglMode();
  return probedWebgl;
}

export function resetWebglModeForTest(): void {
  probedWebgl = null;
}

function ensureOffscreenName(): void {
  if (!("OffscreenCanvas" in globalThis)) {
    Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, writable: true, value: undefined });
  }
}

export function cssColorHex(color: string): string | null {
  if (!color) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = "rgba(0, 0, 0, 0)";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 0) return null;
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function themeBackground(element: HTMLElement): string {
  return cssColorHex(getComputedStyle(element).backgroundColor) ?? (currentTheme() === "dark" ? "#0a0a0a" : "#ffffff");
}

type Listener = [EventTarget, string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined];

export function captureListeners<T>(targets: readonly EventTarget[], run: () => T): { value: T; release: () => void } {
  const added: Listener[] = [];
  const release = () => {
    for (const [target, type, listener, options] of added.splice(0)) target.removeEventListener(type, listener, options);
  };
  const restore = targets.map((target) => {
    const own = Object.getOwnPropertyDescriptor(target, "addEventListener");
    const original = target.addEventListener;
    Object.defineProperty(target, "addEventListener", {
      configurable: true,
      writable: true,
      value(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
        if (listener) added.push([target, type, listener, options]);
        original.call(target, type, listener, options);
      },
    });
    return () => {
      if (own) Object.defineProperty(target, "addEventListener", own);
      else Reflect.deleteProperty(target, "addEventListener");
    };
  });
  try {
    return { value: run(), release };
  } catch (error) {
    release();
    throw error;
  } finally {
    for (const undo of restore) undo();
  }
}

interface ViewerInternals {
  divwatcher?: { disconnect: () => void };
  intwatcher?: { disconnect: () => void };
}

interface RendererInternals {
  context?: WebGLRenderingContext | null;
  getCanvas?: () => HTMLCanvasElement | undefined;
}

const sharedViewers = new Set<GLViewer>();

function attempt(run: () => void): void {
  try {
    run();
  } catch {
    return;
  }
}

function loseContext(context: WebGLRenderingContext | null | undefined): void {
  attempt(() => context?.getExtension("WEBGL_lose_context")?.loseContext());
}

export function releaseViewer(viewer: GLViewer, mode: WebglMode, releaseListeners: () => void): void {
  releaseListeners();
  const internals = viewer as unknown as ViewerInternals;
  internals.divwatcher?.disconnect();
  internals.intwatcher?.disconnect();
  attempt(() => viewer.clear());
  const renderer = viewer.getRenderer() as unknown as RendererInternals;
  if (mode === "dedicated") loseContext(renderer.context);
  else {
    sharedViewers.delete(viewer);
    if (sharedViewers.size === 0) loseContext(renderer.context);
  }
  renderer.getCanvas?.()?.remove();
}

export class MoleculeViewError extends Error {
  readonly problem: "webgl" | "atoms";

  constructor(problem: "webgl" | "atoms") {
    super(`The molecule could not be shown (${problem}).`);
    this.name = "MoleculeViewError";
    this.problem = problem;
  }
}

export interface SpectrumRange {
  prop: "resi" | "index";
  min: number;
  max: number;
}

export interface OpenedViewer {
  viewer: GLViewer;
  polymer: boolean;
  range: SpectrumRange;
  view: number[];
  release: () => void;
}

export function spectrumRange(atoms: readonly AtomSpec[]): SpectrumRange {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const atom of atoms) {
    if (typeof atom.resi !== "number") continue;
    min = Math.min(min, atom.resi);
    max = Math.max(max, atom.resi);
  }
  return max > min ? { prop: "resi", min, max } : { prop: "index", min: 0, max: Math.max(1, atoms.length - 1) };
}

export function isPolymer(atoms: readonly AtomSpec[]): boolean {
  let backbone = 0;
  for (const atom of atoms) {
    if (!atom.hetflag && (atom.atom === "CA" || atom.atom === "P")) backbone += 1;
    if (backbone >= 2) return true;
  }
  return false;
}

export function atomStyle(style: MoleculeStyle, color: MoleculeColor, range: SpectrumRange): AtomStyleSpec {
  const paint =
    color !== "spectrum"
      ? { colorscheme: SCHEMES[color] }
      : style === "cartoon"
        ? { color: "spectrum" }
        : { colorscheme: { prop: range.prop, gradient: "roygb", min: range.min, max: range.max } };
  if (style === "stick") return { stick: { ...paint, radius: 0.2 } };
  if (style === "sphere") return { sphere: { ...paint, scale: 0.9 } };
  if (style === "line") return { line: paint };
  return { cartoon: paint };
}

export function applyStyle(opened: OpenedViewer, style: MoleculeStyle, color: MoleculeColor): void {
  const { viewer, range } = opened;
  viewer.setStyle({}, atomStyle(style, color, range));
  if (style === "cartoon") {
    viewer.addStyle(
      { predicate: (atom: AtomSpec) => Boolean(atom.hetflag) && !WATER.has(atom.resn ?? "") },
      { stick: { colorscheme: color === "spectrum" ? SCHEMES.element : SCHEMES[color], radius: 0.2 } },
    );
  }
  viewer.render();
}

type ThreeDmol = typeof import("3dmol");

export function openViewer(
  library: ThreeDmol,
  host: HTMLElement,
  background: string,
  data: string,
  format: MoleculeFormat,
  mode: WebglMode,
): OpenedViewer {
  if (mode === "dedicated") ensureOffscreenName();
  const grid = mode === "dedicated" ? { rows: 1, cols: 1, row: 0, col: 0 } : {};
  let captured: { value: GLViewer | undefined; release: () => void };
  try {
    captured = captureListeners([window, document.body], () =>
      library.createViewer(host, { backgroundColor: background, antialias: true, ...grid }),
    );
  } catch {
    throw new MoleculeViewError("webgl");
  }
  const viewer = captured.value;
  if (!viewer) {
    captured.release();
    throw new MoleculeViewError("webgl");
  }
  if (mode === "shared") sharedViewers.add(viewer);
  const release = () => releaseViewer(viewer, mode, captured.release);
  try {
    const model = viewer.addModel(data, format === "mol" ? "sdf" : format);
    const atoms = model.selectedAtoms({});
    if (atoms.length === 0) throw new MoleculeViewError("atoms");
    const opened: OpenedViewer = { viewer, polymer: isPolymer(atoms), range: spectrumRange(atoms), view: [], release };
    return opened;
  } catch {
    release();
    throw new MoleculeViewError("atoms");
  }
}

export interface MoleculeViewProps {
  data: string;
  format: MoleculeFormat;
  style: MoleculeStyle | null;
  color: MoleculeColor | null;
  mode: WebglMode;
  onChoose?: (option: MoleculeOption, value: string) => void;
}

type ViewStatus = "loading" | "ready" | MoleculeViewError["problem"] | "loadError";
type ViewAction = "rotateLeft" | "rotateRight" | "zoomIn" | "zoomOut" | "reset";

const ACTIONS: readonly { id: ViewAction; icon: LucideIcon }[] = [
  { id: "rotateLeft", icon: RotateCcw },
  { id: "rotateRight", icon: RotateCw },
  { id: "zoomIn", icon: ZoomIn },
  { id: "zoomOut", icon: ZoomOut },
  { id: "reset", icon: Undo2 },
];

const SELECT_CLASS = "h-6 w-auto gap-1 px-1.5 py-0 text-[0.6875rem] text-foreground hover:bg-accent";

export function runAction(opened: OpenedViewer, action: ViewAction): void {
  const { viewer } = opened;
  if (action === "rotateLeft") viewer.rotate(-ROTATE_STEP, "vy");
  else if (action === "rotateRight") viewer.rotate(ROTATE_STEP, "vy");
  else if (action === "zoomIn") viewer.zoom(ZOOM_STEP);
  else if (action === "zoomOut") viewer.zoom(1 / ZOOM_STEP);
  else {
    viewer.setView(opened.view);
    viewer.render();
  }
}

function useViewLabel(): (action: ViewAction) => string {
  const { t } = useTranslation(["notes"]);
  return (action) => t(($) => $.notes.blocks.molecule[action]);
}

function OptionSelect<T extends string>({
  label,
  value,
  values,
  name,
  onChange,
}: Readonly<{ label: string; value: T; values: readonly T[]; name: (value: T) => string; onChange: (value: T) => void }>) {
  return (
    <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
      <span aria-hidden="true">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger aria-label={label} className={SELECT_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((option) => (
            <SelectItem key={option} value={option} className="text-xs">
              {name(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function MoleculeView({
  data,
  format,
  style: initialStyle,
  color: initialColor,
  mode,
  onChoose,
}: Readonly<MoleculeViewProps>) {
  const { t } = useTranslation(["notes"]);
  const actionLabel = useViewLabel();
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<OpenedViewer | null>(null);
  const [status, setStatus] = useState<ViewStatus>("loading");
  const [style, setStyle] = useState<MoleculeStyle>(initialStyle ?? "stick");
  const [color, setColor] = useState<MoleculeColor>(initialColor ?? "element");

  useEffect(() => {
    const frame = frameRef.current;
    const host = hostRef.current;
    let live = true;
    let current: OpenedViewer | null = null;
    let observer: MutationObserver | null = null;
    const show = (library: ThreeDmol, frameElement: HTMLElement, hostElement: HTMLElement) => {
      try {
        current = openViewer(library, hostElement, themeBackground(frameElement), data, format, mode);
        const chosenStyle = initialStyle ?? (current.polymer ? "cartoon" : "stick");
        const chosenColor = initialColor ?? (chosenStyle === "cartoon" ? "spectrum" : "element");
        applyStyle(current, chosenStyle, chosenColor);
        current.viewer.zoomTo();
        current.viewer.render();
        current.view = current.viewer.getView();
        const viewer = current.viewer;
        observer = new MutationObserver(() => viewer.setBackgroundColor(themeBackground(frameElement), 1));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        setStyle(chosenStyle);
        setColor(chosenColor);
        setOpened(current);
        setStatus("ready");
      } catch (error) {
        current?.release();
        current = null;
        setStatus(error instanceof MoleculeViewError ? error.problem : "atoms");
      }
    };
    import("3dmol").then(
      (library) => {
        if (live && frame && host) show(library, frame, host);
      },
      () => {
        if (live) setStatus("loadError");
      },
    );
    return () => {
      live = false;
      observer?.disconnect();
      current?.release();
    };
  }, [data, format, mode, initialStyle, initialColor]);

  const problem =
    status === "webgl"
      ? t(($) => $.notes.blocks.molecule.noWebgl)
      : status === "atoms"
        ? t(($) => $.notes.blocks.molecule.noAtoms)
        : status === "loadError"
          ? t(($) => $.notes.blocks.molecule.loadError)
          : null;

  return (
    <div className="note-molecule w-full min-w-0">
      {opened ? (
        <fieldset
          aria-label={t(($) => $.notes.blocks.molecule.controls)}
          className="mb-2 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
        >
          <OptionSelect
            label={t(($) => $.notes.blocks.molecule.style)}
            value={style}
            values={MOLECULE_STYLES}
            name={(value) => t(($) => $.notes.blocks.molecule.styles[value])}
            onChange={(next) => {
              setStyle(next);
              applyStyle(opened, next, color);
              onChoose?.("style", next);
            }}
          />
          <OptionSelect
            label={t(($) => $.notes.blocks.molecule.color)}
            value={color}
            values={MOLECULE_COLORS}
            name={(value) => t(($) => $.notes.blocks.molecule.colors[value])}
            onChange={(next) => {
              setColor(next);
              applyStyle(opened, style, next);
              onChoose?.("color", next);
            }}
          />
          <div className="ms-auto flex items-center gap-0.5">
            {ACTIONS.map(({ id, icon: Icon }) => (
              <Tooltip key={id} label={actionLabel(id)}>
                <button
                  type="button"
                  aria-label={actionLabel(id)}
                  onClick={() => runAction(opened, id)}
                  className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "w-6 px-0")}
                >
                  <Icon aria-hidden="true" />
                </button>
              </Tooltip>
            ))}
          </div>
        </fieldset>
      ) : null}
      {problem ? (
        <p className="note-drawn-empty">{problem}</p>
      ) : (
        <div
          ref={frameRef}
          role="img"
          aria-label={t(($) => $.notes.blocks.molecule.viewer)}
          className="relative h-[22rem] w-full overflow-hidden rounded-md border bg-background"
        >
          <div ref={hostRef} className="absolute inset-0" />
          {status === "loading" ? (
            <p className="note-drawn-empty absolute inset-0 m-0 flex items-center justify-center">
              {t(($) => $.notes.blocks.molecule.loading)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function mountMolecule(host: HTMLElement, props: MoleculeViewProps): Dispose {
  const root = createRoot(host);
  root.render(
    <I18nextProvider i18n={i18n}>
      <MoleculeView {...props} />
    </I18nextProvider>,
  );
  return () => queueMicrotask(() => root.unmount());
}

function moleculeLabel(): string {
  return i18n.t(($) => $.notes.blocks.molecule.label);
}

export function moleculeProblemText(parsed: Extract<MoleculeParse, { ok: false }>): string {
  const { problem, value } = parsed;
  if (problem === "format") return i18n.t(($) => $.notes.blocks.molecule.badFormat, { value });
  if (problem === "style") return i18n.t(($) => $.notes.blocks.molecule.badStyle, { value });
  if (problem === "color") return i18n.t(($) => $.notes.blocks.molecule.badColor, { value });
  if (problem === "path") return i18n.t(($) => $.notes.blocks.molecule.badPath);
  return i18n.t(($) => $.notes.blocks.molecule.empty);
}

export function moleculeReadErrorText(error: unknown, written: string | null): string {
  const path = written ?? "";
  if (error instanceof BlockFileTooLargeError) return i18n.t(($) => $.notes.blocks.molecule.tooLarge);
  if (error instanceof MoleculeFileError && error.problem === "missing") {
    return i18n.t(($) => $.notes.blocks.molecule.missing, { path });
  }
  return i18n.t(($) => $.notes.blocks.molecule.unreadable, { path });
}

export function paintMolecule(preview: HTMLElement, source: string, context: PaintContext): Dispose | undefined {
  if (context.still) {
    paintBlockCard(preview, moleculeLabel(), source);
    return undefined;
  }
  const parsed = parseMoleculeSource(source);
  if (!parsed.ok) {
    blockMessage(preview, moleculeProblemText(parsed));
    return undefined;
  }
  const { spec } = parsed;
  if (spec.path && !context.readFile) {
    paintBlockCard(preview, moleculeLabel(), source);
    return undefined;
  }
  const frame = document.createElement("div");
  frame.className = "note-molecule-pending flex h-[22rem] w-full items-center justify-center rounded-md border";
  const waiting = document.createElement("p");
  waiting.className = "note-drawn-empty";
  waiting.textContent = i18n.t(($) => $.notes.blocks.molecule.loading);
  frame.append(waiting);
  preview.replaceChildren(frame);
  let live = true;
  let unmount: Dispose | undefined;
  const start = () => {
    const mode = cachedWebglMode();
    if (!mode) {
      blockMessage(preview, i18n.t(($) => $.notes.blocks.molecule.noWebgl));
      return;
    }
    moleculeText(spec, context.readFile).then(
      (text) => {
        if (!live) return;
        const format = resolveMoleculeFormat(spec, context.fence, text);
        if (!format) {
          blockMessage(preview, i18n.t(($) => $.notes.blocks.molecule.unknownFormat));
          return;
        }
        const host = document.createElement("div");
        host.className = "note-molecule-host w-full min-w-0";
        preview.replaceChildren(host);
        const { rewrite } = context;
        unmount = mountMolecule(host, {
          data: moleculeData(text, format),
          format,
          style: spec.style,
          color: spec.color,
          mode,
          onChoose: rewrite ? (option, value) => rewrite((current) => withMoleculeOption(current, option, value)) : undefined,
        });
      },
      (error: unknown) => {
        if (live) blockMessage(preview, moleculeReadErrorText(error, spec.path));
      },
    );
  };
  const stop = whenNearViewport(frame, start, "0px");
  return () => {
    live = false;
    stop();
    unmount?.();
  };
}

const ETHANOL_XYZ = [
  "9",
  "",
  "C      1.1879   -0.3829    0.0000",
  "C      0.0000    0.5526    0.0000",
  "O     -1.1867   -0.2472    0.0000",
  "H      1.1546   -1.0293    0.8800",
  "H      1.1546   -1.0293   -0.8800",
  "H      2.1094    0.2007    0.0000",
  "H      0.0661    1.1979    0.8835",
  "H      0.0661    1.1979   -0.8835",
  "H     -1.9508    0.3410    0.0000",
];

function templateSource(): string {
  const lines = [...ETHANOL_XYZ];
  lines[1] = i18n.t(($) => $.notes.blocks.molecule.template);
  return ["format: xyz", "style: stick", ...lines].join("\n");
}

export const moleculeBlock: NoteBlockKind = {
  name: "molecule",
  aliases: ["pdb", "mol", "sdf", "xyz", "cif", "mol2"],
  label: moleculeLabel,
  icon: Atom,
  paint: paintMolecule,
  still: "card",
  interactive: true,
  template: () => ({ info: "molecule", source: templateSource() }),
};
