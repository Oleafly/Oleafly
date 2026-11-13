import type { AtomSpec, AtomStyleSpec, GLViewer } from "3dmol";
import { Atom, type LucideIcon, RotateCcw, RotateCw, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_MESSAGE, BLOCK_SURFACE } from "@/components/ui/block-frame";
import { buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { i18n } from "@/i18n";
import { paintedColorToHex } from "@/lib/css-color";
import { cn } from "@/lib/utils";
import {
  BlockFileTooLargeError,
  blockMessage,
  currentTheme,
  type Dispose,
  element,
  type NoteBlockKind,
  type NoteFile,
  type PaintContext,
  paintAsync,
  paintBlockCard,
} from "./note-blocks";
import {
  MOLECULE_COLORS,
  MOLECULE_STYLES,
  type MoleculeColor,
  MoleculeFileError,
  type MoleculeFormat,
  type MoleculeOption,
  type MoleculeParse,
  type MoleculeStyle,
  moleculeData,
  moleculeText,
  parseMoleculeSource,
  resolveMoleculeFormat,
  withMoleculeOption,
} from "./molecule-source";
import { nodeRoot } from "./node-root";

export const ROTATE_STEP = 20;
export const ZOOM_STEP = 1.25;

const SCHEMES: Record<Exclude<MoleculeColor, "spectrum">, string> = {
  chain: "chain",
  element: "default",
  residue: "amino",
  ss: "ssJmol",
};
const WATER = new Set(["HOH", "WAT", "H2O", "DOD", "SOL"]);

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

const CLEAR = /^transparent$|[,/]\s*0(?:\.0*)?\s*\)$/u;

export function themeBackground(element: HTMLElement): string {
  const color = getComputedStyle(element).backgroundColor;
  return (CLEAR.test(color) ? null : paintedColorToHex(color)) ?? (currentTheme() === "dark" ? "#0a0a0a" : "#ffffff");
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

function atomPaint(style: MoleculeStyle, color: MoleculeColor, range: SpectrumRange) {
  if (color !== "spectrum") return { colorscheme: SCHEMES[color] };
  if (style === "cartoon") return { color: "spectrum" };
  return { colorscheme: { prop: range.prop, gradient: "roygb", min: range.min, max: range.max } };
}

export function atomStyle(style: MoleculeStyle, color: MoleculeColor, range: SpectrumRange): AtomStyleSpec {
  const paint = atomPaint(style, color, range);
  if (style === "stick") return { stick: { ...paint, radius: 0.2 } };
  if (style === "sphere") return { sphere: { ...paint, scale: 0.9 } };
  if (style === "line") return { line: paint };
  return { cartoon: paint };
}

export function chosenLook(
  polymer: boolean,
  style: MoleculeStyle | null,
  color: MoleculeColor | null,
): { style: MoleculeStyle; color: MoleculeColor } {
  const chosen = style ?? (polymer ? "cartoon" : "stick");
  return { style: chosen, color: color ?? (chosen === "cartoon" ? "spectrum" : "element") };
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
        const { style: chosenStyle, color: chosenColor } = chosenLook(current.polymer, initialStyle, initialColor);
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

  let problem: string | null = null;
  if (status === "webgl") problem = t(($) => $.notes.blocks.molecule.noWebgl);
  else if (status === "atoms") problem = t(($) => $.notes.blocks.molecule.noAtoms);
  else if (status === "loadError") problem = t(($) => $.notes.blocks.molecule.loadError);

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
        <p className={BLOCK_MESSAGE}>{problem}</p>
      ) : (
        <div
          ref={frameRef}
          role="img"
          aria-label={t(($) => $.notes.blocks.molecule.viewer)}
          className={cn(BLOCK_SURFACE, "relative h-[22rem] w-full overflow-hidden bg-background")}
        >
          <div ref={hostRef} className="absolute inset-0" />
          {status === "loading" ? (
            <p className={cn(BLOCK_MESSAGE, "absolute inset-0 m-0 flex items-center justify-center")}>
              {t(($) => $.notes.blocks.molecule.loading)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function mountMolecule(host: HTMLElement, props: MoleculeViewProps): Dispose {
  const root = nodeRoot(host);
  root.render(<MoleculeView {...props} />);
  return root.unmount;
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
  if (error instanceof BlockFileTooLargeError) return i18n.t(($) => $.notes.blocks.molecule.tooLarge);
  const shown = { path: written ?? "" };
  if (error instanceof MoleculeFileError && error.problem === "missing") return i18n.t(($) => $.notes.blocks.molecule.missing, shown);
  return i18n.t(($) => $.notes.blocks.molecule.unreadable, shown);
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
  const mode = cachedWebglMode();
  if (!mode) {
    blockMessage(preview, i18n.t(($) => $.notes.blocks.molecule.noWebgl));
    return undefined;
  }
  const frame = element("div", `note-molecule-pending flex h-[22rem] w-full items-center justify-center ${BLOCK_SURFACE}`);
  frame.append(element("p", BLOCK_MESSAGE, i18n.t(($) => $.notes.blocks.molecule.loading)));
  preview.replaceChildren(frame);
  const { rewrite } = context;
  return paintAsync(preview, {
    load: () => moleculeText(spec, context.readFile),
    show: (text) => {
      const format = resolveMoleculeFormat(spec, context.fence, text);
      if (!format) {
        blockMessage(preview, i18n.t(($) => $.notes.blocks.molecule.unknownFormat));
        return undefined;
      }
      const host = element("div", "note-molecule-host w-full min-w-0");
      preview.replaceChildren(host);
      return mountMolecule(host, {
        data: moleculeData(text, format),
        format,
        style: spec.style,
        color: spec.color,
        mode,
        onChoose: rewrite ? (option, value) => rewrite((current) => withMoleculeOption(current, option, value)) : undefined,
      });
    },
    error: (error) => moleculeReadErrorText(error, spec.path),
  });
}

const SNAPSHOT_SIZE = { width: 640, height: 480 };

export async function moleculeSnapshot(source: string, fence: string, readFile: NoteFile | undefined): Promise<string | null> {
  const parsed = parseMoleculeSource(source);
  const mode = cachedWebglMode();
  if (!parsed.ok || !mode) return null;
  const text = await moleculeText(parsed.spec, readFile);
  const format = resolveMoleculeFormat(parsed.spec, fence, text);
  if (!format) return null;
  const library = await import("3dmol");
  const host = element("div", "");
  host.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${SNAPSHOT_SIZE.width}px; height: ${SNAPSHOT_SIZE.height}px`;
  document.body.append(host);
  let opened: OpenedViewer | null = null;
  try {
    opened = openViewer(library, host, "#ffffff", moleculeData(text, format), format, mode);
    const look = chosenLook(opened.polymer, parsed.spec.style, parsed.spec.color);
    applyStyle(opened, look.style, look.color);
    opened.viewer.zoomTo();
    opened.viewer.render();
    return opened.viewer.pngURI().replace(/^data:image\/png;base64,/u, "") || null;
  } catch {
    return null;
  } finally {
    opened?.release();
    host.remove();
  }
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
